use crate::{geometry::*, types::*};

pub(super) struct Walls {
    records: Vec<Record>,
    index: Index,
}

struct Record {
    bounds: Bounds,
    wall: Wall,
}

impl Walls {
    pub(super) fn new(walls: Vec<Wall>) -> Result<Self, String> {
        let mut records = Vec::new();
        for wall in walls {
            validate(&wall)?;
            if wall.state != "inactive" {
                records.push(Record {
                    bounds: bounds(&wall),
                    wall,
                });
            }
        }
        let index = Index::new(
            &records
                .iter()
                .map(|record| record.bounds)
                .collect::<Vec<_>>(),
        );
        Ok(Self { records, index })
    }

    pub(super) fn blocked(&self, axis: [Point; 4], capsule_bounds: Bounds, radius: f64) -> bool {
        self.index.query(capsule_bounds, |i| {
            let record = &self.records[i];
            record.bounds.overlaps(capsule_bounds) && touches(&record.wall, axis, radius)
        })
    }
}

fn validate(wall: &Wall) -> Result<(), String> {
    if wall.min.iter().chain(&wall.max).any(|v| !v.is_finite())
        || (0..3).any(|i| wall.min[i] > wall.max[i])
        || !matches!(wall.state.as_str(), "active" | "inactive" | "unknown")
        || !wall.padding.is_finite()
        || wall.padding < 0.
    {
        return Err("Invalid wall".into());
    }
    if [
        wall.points.is_some(),
        wall.polygon.is_some(),
        wall.sphere.is_some(),
    ]
    .into_iter()
    .filter(|present| *present)
    .count()
        > 1
    {
        return Err("Conflicting wall shapes".into());
    }
    for (ring, minimum) in [(&wall.points, 2), (&wall.polygon, 3)] {
        if let Some(ring) = ring
            && (ring.len() < minimum || ring.iter().flatten().any(|v| !v.is_finite()))
        {
            return Err("Invalid wall ring".into());
        }
    }
    if let Some(sphere) = &wall.sphere
        && (sphere.center.iter().any(|v| !v.is_finite())
            || !sphere.radius.is_finite()
            || sphere.radius <= 0.)
    {
        return Err("Invalid wall sphere".into());
    }
    Ok(())
}

fn bounds(wall: &Wall) -> Bounds {
    if let Some(sphere) = &wall.sphere {
        return Bounds::points(&[sphere.center]).expand(sphere.radius + wall.padding);
    }
    let mut bounds = Bounds {
        min: wall.min,
        max: wall.max,
    };
    if let Some(ring) = wall.polygon.as_ref().or(wall.points.as_ref()) {
        for [x, z] in ring {
            bounds.min[0] = bounds.min[0].min(*x);
            bounds.min[2] = bounds.min[2].min(*z);
            bounds.max[0] = bounds.max[0].max(*x);
            bounds.max[2] = bounds.max[2].max(*z);
        }
    }
    for horizontal in [0, 2] {
        bounds.min[horizontal] -= wall.padding;
        bounds.max[horizontal] += wall.padding;
    }
    bounds
}

fn clip(range: &mut (f64, f64), a: f64, b: f64, min: f64, max: f64) -> bool {
    let delta = b - a;
    if delta == 0. {
        return a >= min && a <= max;
    }
    let enter = (min - a) / delta;
    let exit = (max - a) / delta;
    range.0 = range.0.max(enter.min(exit));
    range.1 = range.1.min(enter.max(exit));
    range.0 <= range.1
}

fn touches(wall: &Wall, axis: [Point; 4], radius: f64) -> bool {
    let margin = radius + wall.padding;
    let [a, upper_a, upper_b, b] = axis;
    if let Some(sphere) = &wall.sphere {
        // The translating capsule spine sweeps the union of two triangles.
        return point_triangle(sphere.center, [a, upper_a, upper_b])
            .min(point_triangle(sphere.center, [a, upper_b, b]))
            <= sphere.radius + margin;
    }

    // Wall footprints extrude vertically. Restrict the XZ sweep to the times
    // when the body's vertical extent overlaps the authored wall height.
    let mut range = (0., 1.);
    let spine_height = upper_a[1] - a[1];
    if !clip(
        &mut range,
        a[1],
        b[1],
        wall.min[1] - spine_height - radius,
        wall.max[1] + radius,
    ) {
        return false;
    }
    let Some(ring) = wall.polygon.as_ref().or(wall.points.as_ref()) else {
        return [0, 2].into_iter().all(|i| {
            clip(
                &mut range,
                a[i],
                b[i],
                wall.min[i] - margin,
                wall.max[i] + margin,
            )
        });
    };

    let xz = |[x, _, z]: Point| [x, 0., z];
    let start = xz(lerp(a, b, range.0));
    let end = xz(lerp(a, b, range.1));
    let filled = wall.polygon.is_some();
    if filled && (inside(start, ring) || inside(end, ring)) {
        return true;
    }
    let edge_count = if filled { ring.len() } else { ring.len() - 1 };
    (0..edge_count).any(|i| {
        let [x, z] = ring[i];
        let [next_x, next_z] = ring[(i + 1) % ring.len()];
        touches_edge(start, end, [x, 0., z], [next_x, 0., next_z], margin)
    })
}

fn inside(p: Point, ring: &[[f64; 2]]) -> bool {
    let mut inside = false;
    for (i, &[x, z]) in ring.iter().enumerate() {
        let [next_x, next_z] = ring[(i + 1) % ring.len()];
        if (z > p[2]) != (next_z > p[2]) && p[0] < x + (next_x - x) * (p[2] - z) / (next_z - z) {
            inside = !inside;
        }
    }
    inside
}

fn touches_edge(a: Point, b: Point, c: Point, d: Point, margin: f64) -> bool {
    let turn = |p, q, r| cross(sub(q, p), sub(r, p))[1];
    let opposite = |p, q| (p < 0. && q > 0.) || (p > 0. && q < 0.);
    (opposite(turn(a, b, c), turn(a, b, d)) && opposite(turn(c, d, a), turn(c, d, b)))
        || point_segment(a, c, d)
            .min(point_segment(b, c, d))
            .min(point_segment(c, a, b))
            .min(point_segment(d, a, b))
            <= margin + 1e-9
}
