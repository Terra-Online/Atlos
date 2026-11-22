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

pub struct Launches {
    pub edges: Vec<Segment>,
    pub terminals: Vec<(usize, Segment)>,
}

fn launch_model(world: &World, height: f64) -> Model {
    let mut model = world.physical.movement.model.clone();
    model.max_jump_height = height;
    model.start_horizontal_speed = None;
    model.air_acceleration = None;
    model.air_deceleration = None;
    model.air_overspeed_deceleration = None;
    model
}

fn launch_action(mut action: Segment, device: &Device, suffix: &str) -> Segment {
    action.mode = "launch";
    action.connection = Some(format!("launch/{}{suffix}", device.id));
    action
}

/// Resolve device actions before queries. Free pads select supported landing
/// candidates; fixed pads preserve the horizontal velocity through their aim.
pub fn launches(world: &World, nodes: &[Point], marks: &[Mark]) -> Launches {
    let mut result = Launches {
        edges: Vec::new(),
        terminals: Vec::new(),
    };
    for device in world
        .physical
        .devices
        .iter()
        .flat_map(|facts| &facts.devices)
    {
        if !device.unit_scale || (!device.fixed_launch && !device.free_launch) {
            continue;
        }
        let Some(height) = device.height.filter(|h| *h >= 0.) else {
            continue;
        };
        let Some(goal) = &device.goal else {
            continue;
        };
        let starts = endpoints(world, device, goal);
        if starts.is_empty() {
            continue;
        }
        if device.fixed_launch {
            let Some(aim) = device.aim else {
                continue;
            };
            let Some(clearance) = device.aim_clearance.filter(|c| *c >= 0.) else {
                continue;
            };
            if let Some(end) = world
                .project(aim, 0.5)
                .filter(|&end| !world.blocked(end, end, 0.))
            {
                if let Some(action) = starts.iter().find_map(|&start| {
                    let mut model = launch_model(world, height.max(end[1] + clearance - start[1]));
                    model.max_horizontal_speed =
                        horizontal(start, end) / crate::flight::duration(&model, start[1], end[1])?;
                    world.flight(start, end, None, model)
                }) {
                    result.edges.push(launch_action(action, device, ""));
                }
            }
            // A target can be above empty space. Infer possible landing heights
            // from nearby prepared supports, then intersect the authored ray
            // with actual support instead of treating the aim as a platform.
            for &start in starts.iter().take(16) {
                let mut model = launch_model(world, height.max(aim[1] + clearance - start[1]));
                let Some(aim_time) = crate::flight::duration(&model, start[1], aim[1]) else {
                    continue;
                };
                let velocity = [
                    (aim[0] - start[0]) / aim_time,
                    (aim[2] - start[2]) / aim_time,
                ];
                model.max_horizontal_speed = velocity[0].hypot(velocity[1]);
                let at_height = |y| {
                    crate::flight::duration(&model, start[1], y).map(|time| {
                        [
                            start[0] + velocity[0] * time,
                            y,
                            start[2] + velocity[1] * time,
                        ]
                    })
                };
                let mut heights = std::collections::BTreeMap::new();
                for &node in nodes {
                    if let Some(point) = at_height(node[1]) {
                        if horizontal(point, node) < 3. {
                            heights
                                .entry((node[1] * 2.).floor() as i64)
                                .or_insert(node[1]);
                        }
                    }
                }
                for y in heights.into_values() {
                    let Some(mut end) = at_height(y) else {
                        continue;
                    };
                    let mut landed = false;
                    for _ in 0..6 {
                        let Some(feet) = world.project(end, 0.5) else {
                            break;
                        };
                        if (feet[1] - end[1]).abs() < 1e-6 {
                            landed = true;
                            break;
                        }
                        let Some(next) = at_height(feet[1]) else {
                            break;
                        };
                        end = next;
                    }
                    if !landed || world.blocked(end, end, 0.) {
                        continue;
                    }
                    if result.edges.iter().any(|edge| {
                        edge.connection.as_deref() == Some(&format!("launch/{}", device.id))
                            && distance(edge.end(), end) < 0.25
                    }) {
                        continue;
                    }
                    if let Some(action) = world.flight(start, end, None, model.clone()) {
                        result.edges.push(launch_action(action, device, ""));
                    }
                }
                for (index, mark) in marks.iter().enumerate() {
                    let y = (mark.position[1] - mark.interaction.radius).min(aim[1]);
                    let Some(end) = at_height(y) else {
                        continue;
                    };
                    if let Some(action) = world.flight(
                        start,
                        end,
                        Some((&mark.position, &mark.interaction)),
                        model.clone(),
                    ) {
                        if !result.terminals.iter().any(|(i, a)| {
                            *i == index
                                && a.connection.as_deref() == Some(&format!("launch/{}", device.id))
                        }) {
                            result
                                .terminals
                                .push((index, launch_action(action, device, "")));
                        }
                    }
                }
            }
        } else if device.resolved {
            let mut model = launch_model(world, height);
            model.max_horizontal_speed = world.physical.movement.run_air_speed;
            let mut landings = std::collections::BTreeMap::new();
            for &end in nodes {
                let start = starts[0];
                let Some(time) = crate::flight::duration(&model, start[1], end[1]) else {
                    continue;
                };
                if horizontal(start, end)
                    <= time * model.max_horizontal_speed + goal.interaction.radius
                    && time <= 60.
                {
                    let key = [
                        (end[0] / 2.).floor() as i64,
                        (end[1] * 2.).floor() as i64,
                        (end[2] / 2.).floor() as i64,
                    ];
                    landings.entry(key).or_insert(end);
                }
            }
            for (index, end) in landings.into_values().enumerate() {
                if let Some(action) = starts
                    .iter()
                    .take(16)
                    .find_map(|&start| world.flight(start, end, None, model.clone()))
                {
                    result
                        .edges
                        .push(launch_action(action, device, &format!("/{index}")));
                }
            }
            for (index, mark) in marks.iter().enumerate() {
                if let Some(action) = starts.iter().take(16).find_map(|&start| {
                    world.collect_with_model(start, mark.position, &mark.interaction, model.clone())
                }) {
                    result.terminals.push((
                        index,
                        launch_action(action, device, &format!("/terminal/{index}")),
                    ));
                }
            }
        }
    }
    result
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
