use crate::{geometry::*, types::*, world::World};

// Circular surfaces are narrow, phase-free contact patches. They are never
// collision solids or a filled disk; all external collision still applies.
pub const CLEARANCE: f64 = 0.01;

pub fn validate(shape: &Circular) -> Result<(), String> {
    if !shape
        .center
        .iter()
        .chain(shape.axis.iter())
        .all(|v| v.is_finite())
        || ![shape.radius, shape.half_width, shape.sagitta]
            .iter()
            .all(|v| v.is_finite() && *v > 0.)
        || (dot(shape.axis, shape.axis) - 1.).abs() > 1e-6
        || shape.axis[1].abs() > 1e-6
        || shape.sagitta > 0.005 + 1e-9
        || shape.sagitta >= shape.radius
    {
        return Err("Invalid circular support".into());
    }
    Ok(())
}

pub fn rides(world: &World, support: &MovingSupport) -> Vec<Segment> {
    let Some(shape) = &support.circular else {
        return Vec::new();
    };
    let mut actions = Vec::new();
    // Parallel rim lanes allow boarding beside braces without removing those
    // braces from collision. Each lane stays within the authored contact width.
    for (lane, fraction) in [-1., -0.5, 0., 0.5, 1.].into_iter().enumerate() {
        let offset = add(
            scale(shape.axis, fraction * shape.half_width),
            [0., CLEARANCE, 0.],
        );
        for (index, transfer) in support.transfers.iter().enumerate() {
            let Some(speed) = transfer.speed.filter(|v| v.is_finite() && *v > 0.) else {
                continue;
            };
            let from = sub(transfer.from, shape.center);
            let to = sub(transfer.to, shape.center);
            if [from, to].iter().any(|p| {
                dot(*p, shape.axis).abs() > 1e-5
                    || (distance(*p, [0.; 3]) - shape.radius).abs() > 1e-5
            }) {
                continue;
            }
            let chord = distance(transfer.from, transfer.to);
            if chord <= 1e-9 || chord > 2. * shape.radius {
                continue;
            }
            let angle = 2. * (chord / (2. * shape.radius)).asin();
            if shape.radius * (1. - (angle / 2.).cos()) > shape.sagitta + 1e-8 {
                continue;
            }
            let a = add(transfer.from, offset);
            let b = add(transfer.to, offset);
            if world.blocked(a, b, shape.sagitta) {
                continue;
            }
            for (start, end, suffix) in [(a, b, ""), (b, a, "/reverse")] {
                actions.push(Segment {
                    boost: None,
                    mode: "rope",
                    traversal: Some("moving-support"),
                    points: vec![start, end],
                    times: vec![0., shape.radius * angle / speed],
                    connection: Some(format!(
                        "moving-ride/{}/{index}/lane{lane}{suffix}",
                        support.id
                    )),
                    flight: None,
                    gait: None,
                });
            }
        }
    }
    actions
}
