use crate::{flight::hit, geometry::distance, types::*, world::World};

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
