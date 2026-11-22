use crate::{
    flight::hit,
    geometry::{distance, horizontal},
    types::*,
    world::World,
};

fn endpoints(world: &World, device: &Device, goal: &Mark) -> Vec<Point> {
    // A trigger can straddle coverage or a ledge. Its nearest navigation edge
    // may leave the body outside coverage even though an interior contact fits.
    let radial = [0.5, 0.85, 0.98].into_iter().flat_map(|fraction| {
        (0..32).map(move |i| {
            let angle = std::f64::consts::TAU * i as f64 / 32.;
            [
                goal.position[0] + angle.cos() * goal.interaction.radius * fraction,
                goal.position[1],
                goal.position[2] + angle.sin() * goal.interaction.radius * fraction,
            ]
        })
    });
    let mut points: Vec<_> = std::iter::once(goal.position)
        .chain(device.seeds.iter().copied())
        .chain(radial)
        .filter_map(|seed| world.project(seed, world.physical.ground.options.max_vertical))
        .filter(|&point| {
            hit(point, point, goal.position, &goal.interaction).is_some()
                && !world.blocked(point, point, 0.)
        })
        .collect();
    points.extend(world.goals(&Query {
        starts: Vec::new(),
        goal: goal.position,
        interaction: Some(goal.interaction.clone()),
    }));
    points.sort_by(|a, b| distance(*a, goal.position).total_cmp(&distance(*b, goal.position)));
    points.dedup_by(|a, b| distance(*a, *b) <= 1e-6);
    points
}

fn climb(world: &World, lower: &Device, upper: &Device) -> Option<Segment> {
    let speed = lower.speed?;
    let overhead = lower.overhead?;
    if !lower.resolved
        || !upper.resolved
        || !lower.unit_scale
        || !upper.unit_scale
        || speed <= 0.
        || overhead < 0.
    {
        return None;
    }
    let starts = endpoints(world, lower, lower.goal.as_ref()?);
    let ends = endpoints(world, upper, upper.goal.as_ref()?);
    for start in starts {
        for &end in &ends {
            // The authored ascent pauses on entry, clears the upper support,
            // then crosses above it before stepping down onto the exit.
            let clear = end[1] + 0.1;
            let points = vec![
                start,
                start,
                [start[0], clear, start[2]],
                [end[0], clear, end[2]],
                end,
            ];
            if points.windows(2).any(|p| world.blocked(p[0], p[1], 0.)) {
                continue;
            }
            let mut elapsed = overhead;
            let mut times = vec![0., elapsed];
            for pair in points[1..].windows(2) {
                elapsed += distance(pair[0], pair[1]) / speed;
                times.push(elapsed);
            }
            return Some(Segment {
                mode: "rope",
                points,
                times,
                connection: Some(format!("rope/{}/{}", lower.id, upper.id)),
                flight: None,
                gait: None,
                traversal: None,
            });
        }
    }
    None
}

pub fn ropes(world: &World) -> Vec<Segment> {
    let Some(facts) = &world.physical.devices else {
        return Vec::new();
    };
    facts
        .ropes
        .iter()
        .filter_map(|rope| {
            let lower = facts.devices.iter().find(|d| d.id == rope.bottom)?;
            let upper = facts.devices.iter().find(|d| d.id == rope.top)?;
            climb(world, lower, upper)
        })
        .collect()
}

pub fn launches(world: &World) -> Vec<Segment> {
    let Some(facts) = &world.physical.devices else {
        return Vec::new();
    };
    facts
        .devices
        .iter()
        .filter_map(|device| {
            if !device.fixed_launch || !device.unit_scale {
                return None;
            }
            let aim = device.aim?;
            let height = device.height?;
            let clearance = device.aim_clearance?;
            if height < 0. || clearance < 0. {
                return None;
            }
            let end = world.project(aim, 0.5)?;
            if world.blocked(end, end, 0.) {
                return None;
            }
            endpoints(world, device, device.goal.as_ref()?)
                .into_iter()
                .find_map(|start| {
                    // Fixed pads set a uniform horizontal trajectory and their own
                    // jump height. Character acceleration and launch impulse do not apply.
                    let mut model = world.physical.movement.model.clone();
                    model.max_jump_height = height.max(end[1] + clearance - start[1]);
                    let fall = start[1] + model.max_jump_height - end[1];
                    let terminal_time = model.max_falling_speed / model.falling_gravity;
                    let terminal_distance = model.max_falling_speed * terminal_time / 2.;
                    let duration = (2. * model.max_jump_height / model.gravity).sqrt()
                        + model.apex_time
                        + (2. * fall / model.falling_gravity)
                            .sqrt()
                            .min(terminal_time)
                        + (fall - terminal_distance).max(0.) / model.max_falling_speed;
                    if !duration.is_finite() || duration <= 0. {
                        return None;
                    }
                    model.max_horizontal_speed = horizontal(start, end) / duration;
                    model.start_horizontal_speed = None;
                    model.air_acceleration = None;
                    model.air_deceleration = None;
                    model.air_overspeed_deceleration = None;
                    let mut action = world.flight(start, end, None, model)?;
                    action.mode = "launch";
                    action.connection = Some(format!("launch/{}", device.id));
                    Some(action)
                })
        })
        .collect()
}

pub fn rides(world: &World) -> Vec<Segment> {
    let mut actions = Vec::new();
    for support in world
        .physical
        .devices
        .iter()
        .flat_map(|facts| &facts.moving_supports)
    {
        if support.assumption != "phase-free-swept-support" || support.circular.is_some() {
            continue;
        }
        for (index, transfer) in support.transfers.iter().enumerate() {
            let Some(speed) = transfer.speed.filter(|speed| *speed > 0.) else {
                continue;
            };
            let Some(start) = world.moving_standing(support, transfer.from) else {
                continue;
            };
            let Some(end) = world.moving_standing(support, transfer.to) else {
                continue;
            };
            let duration = distance(transfer.from, transfer.to) / speed;
            if duration <= 0. || world.blocked(start, end, 0.) {
                continue;
            }
            for (from, to, suffix) in [(start, end, ""), (end, start, "/reverse")] {
                actions.push(Segment {
                    mode: "rope",
                    traversal: Some("moving-support"),
                    points: vec![from, to],
                    times: vec![0., duration],
                    connection: Some(format!("moving-ride/{}/{index}{suffix}", support.id)),
                    flight: None,
                    gait: None,
                });
            }
        }
    }
    actions
}

pub fn used_supports(world: &World, segments: &[Segment]) -> Vec<serde_json::Value> {
    let mut boxes = Vec::new();
    for support in world
        .physical
        .devices
        .iter()
        .flat_map(|facts| &facts.moving_supports)
    {
        for (index, transfer) in support.transfers.iter().enumerate() {
            let id = format!("moving-ride/{}/{index}", support.id);
            for segment in segments {
                let reverse = segment.connection.as_deref() == Some(&format!("{id}/reverse"));
                if segment.connection.as_deref() != Some(&id) && !reverse {
                    continue;
                }
                let poses = if reverse {
                    [transfer.to_pose, transfer.from_pose]
                } else {
                    [transfer.from_pose, transfer.to_pose]
                };
                for (pose, role) in poses.into_iter().zip(["board", "leave"]) {
                    if let Some(pose) = pose.and_then(|i| support.poses.get(i)) {
                        boxes.push(serde_json::json!({"min":pose.min,"max":pose.max,"device":support.id,"family":support.family,"role":role}));
                    }
                }
            }
        }
    }
    boxes
}
