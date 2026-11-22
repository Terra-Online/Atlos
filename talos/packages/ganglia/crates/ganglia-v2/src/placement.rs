use crate::{geometry::*, types::*, world::World};
use std::collections::HashSet;

const EPS: f64 = 1e-5;
const LIMIT: usize = 4;
const FACES: [[usize; 4]; 6] = [
    [0, 4, 6, 2],
    [1, 3, 7, 5],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 2, 3, 1],
    [4, 5, 7, 6],
];
type Body = [Point; 8];
type Polygon = Vec<[f64; 2]>;

fn source_body(points: &[Point]) -> Option<Body> {
    let body: Body = points.try_into().ok()?;
    if body.iter().flatten().any(|v| !v.is_finite()) {
        return None;
    }
    let axes = [1, 2, 4].map(|i| sub(body[i], body[0]));
    if axes.iter().any(|a| dot(*a, *a) < EPS * EPS) {
        return None;
    }
    for i in 0..3 {
        for j in i + 1..3 {
            if dot(axes[i], axes[j]).abs()
                > distance([0.; 3], axes[i]) * distance([0.; 3], axes[j]) * EPS
            {
                return None;
            }
        }
    }
    for (bits, p) in body.iter().enumerate() {
        let expected = axes.iter().enumerate().fold(body[0], |p, (i, a)| {
            if bits & (1 << i) != 0 { add(p, *a) } else { p }
        });
        if distance(*p, expected) > EPS {
            return None;
        }
    }
    let bounds = Bounds::points(&body);
    if body
        .iter()
        .filter(|p| (p[1] - bounds.min[1]).abs() < EPS)
        .count()
        != 4
        || body
            .iter()
            .filter(|p| (p[1] - bounds.max[1]).abs() < EPS)
            .count()
            != 4
    {
        return None;
    }
    Some(body)
}
fn bodies(support: &FollowingSupport, position: Point) -> Option<Vec<Body>> {
    if support.geometry_kind != "box" {
        return None;
    }
    let delta = sub(position, support.spawn);
    support
        .bodies
        .iter()
        .map(|b| source_body(b).map(|b| b.map(|p| add(p, delta))))
        .collect()
}
fn faces(body: Body) -> Vec<[Point; 4]> {
    let center = scale(add(body[0], body[7]), 0.5);
    FACES
        .iter()
        .map(|ids| {
            let mut face = ids.map(|i| body[i]);
            let normal = cross(sub(face[1], face[0]), sub(face[2], face[0]));
            if dot(normal, sub(face[0], center)) < 0. {
                face.reverse();
            }
            face
        })
        .collect()
}
fn picked(s: &FollowingSupport, placements: &[Placement]) -> Point {
    placements
        .iter()
        .find(|p| p.device == s.id)
        .map_or(s.spawn, |p| p.position)
}

fn enclosing(points: &[Point]) -> Body {
    let b = Bounds::points(points);
    std::array::from_fn(|bits| {
        std::array::from_fn(|axis| {
            if bits & (1 << axis) != 0 {
                b.max[axis]
            } else {
                b.min[axis]
            }
        })
    })
}
pub(super) fn contains(body: Body, p: Point) -> bool {
    [1, 2, 4].into_iter().all(|i| {
        let axis = sub(body[i], body[0]);
        let t = dot(sub(p, body[0]), axis);
        t > EPS && t < dot(axis, axis) - EPS
    })
}
pub(super) fn geometry(
    physical: &Physical,
    placements: &[Placement],
) -> (Vec<[Point; 3]>, Vec<Surface>, Vec<Body>) {
    let mut triangles = Vec::new();
    let mut roofs = Vec::new();
    let mut solids = Vec::new();
    for support in physical.devices.iter().flat_map(|d| &d.following_supports) {
        let Some(bodies) = bodies(support, picked(support, placements)) else {
            // Unsupported authored bodies remain conservative solid obstacles.
            // They cannot contribute candidate placements or navigable roofs.
            for source in &support.bodies {
                let body = enclosing(source);
                solids.push(body);
                for f in faces(body) {
                    triangles.extend([[f[0], f[1], f[2]], [f[0], f[2], f[3]]]);
                }
            }
            continue;
        };
        for body in bodies {
            solids.push(body);
            let top = Bounds::points(&body).max[1];
            for face in faces(body) {
                if face.iter().all(|p| (p[1] - top).abs() < EPS) {
                    roofs.push(Surface {
                        vertices: face.to_vec(),
                    });
                }
                triangles.extend([[face[0], face[1], face[2]], [face[0], face[2], face[3]]]);
            }
        }
    }
    (triangles, roofs, solids)
}
fn side(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
}
fn area(poly: &Polygon) -> f64 {
    (0..poly.len())
        .map(|i| {
            let a = poly[i];
            let b = poly[(i + 1) % poly.len()];
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        .abs()
        / 2.
}
fn clip(poly: &Polygon, a: [f64; 2], b: [f64; 2], inside: bool) -> Polygon {
    let mut result = Vec::new();
    for i in 0..poly.len() {
        let p = poly[i];
        let q = poly[(i + 1) % poly.len()];
        let from = side(a, b, p);
        let to = side(a, b, q);
        let kp = if inside { from >= 0. } else { from <= 0. };
        let kq = if inside { to >= 0. } else { to <= 0. };
        if kp {
            result.push(p);
        }
        if kp != kq {
            let t = from / (from - to);
            result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
    }
    result
}
// Subtract supporting triangles from the whole footprint. Point samples cannot
// prove support across narrow holes or add overlapping triangles only once.
fn supported(body: Body, triangles: &[[Point; 3]]) -> bool {
    let floor = Bounds::points(&body).min[1];
    let center = scale(add(body[0], body[7]), 0.5);
    let mut roof: Polygon = body
        .iter()
        .filter(|p| (p[1] - floor).abs() < EPS)
        .map(|p| [p[0], p[2]])
        .collect();
    roof.sort_by(|a, b| {
        (a[1] - center[2])
            .atan2(a[0] - center[0])
            .total_cmp(&(b[1] - center[2]).atan2(b[0] - center[0]))
    });
    let mut uncovered = vec![roof];
    for t in triangles {
        if t.iter().any(|p| (p[1] - floor).abs() > EPS) {
            continue;
        }
        let mut ring = t.map(|p| [p[0], p[2]]);
        if side(ring[0], ring[1], ring[2]) >= -1e-9 {
            continue;
        }
        ring.reverse();
        let mut next = Vec::new();
        for mut remainder in uncovered {
            for i in 0..3 {
                if remainder.is_empty() {
                    break;
                }
                let outside = clip(&remainder, ring[i], ring[(i + 1) % 3], false);
                if area(&outside) > 1e-9 {
                    next.push(outside);
                }
                remainder = clip(&remainder, ring[i], ring[(i + 1) % 3], true);
            }
        }
        uncovered = next;
        if uncovered.is_empty() {
            return true;
        }
        if uncovered.len() > 256 {
            return false;
        }
    }
    false
}
fn blocked(body: Body, triangles: &[[Point; 3]]) -> bool {
    let bounds = Bounds::points(&body);
    let center = scale(add(body[0], body[7]), 0.5);
    let axes = [1, 2, 4].map(|i| sub(body[i], body[0]));
    let half = axes.map(|a| distance([0.; 3], a) / 2.);
    let axes = std::array::from_fn::<_, 3, _>(|i| scale(axes[i], 1. / (2. * half[i])));
    let dimensions = [[1., 0., 0.], [0., 1., 0.], [0., 0., 1.]];
    triangles.iter().any(|t| {
        let other = Bounds::points(t);
        if other.max[1] <= bounds.min[1] + EPS || !bounds.overlaps(other) {
            return false;
        }
        let local = t.map(|p| axes.map(|a| dot(sub(p, center), a)));
        let edges = [0, 1, 2].map(|i| sub(local[(i + 1) % 3], local[i]));
        dimensions
            .into_iter()
            .chain([cross(edges[0], edges[1])])
            .chain(
                edges
                    .into_iter()
                    .flat_map(|e| dimensions.map(|d| cross(e, d))),
            )
            .all(|axis| {
                let magnitude = distance([0.; 3], axis);
                if magnitude < 1e-12 {
                    return true;
                }
                let radius = dot(half, axis.map(f64::abs)) + magnitude * EPS;
                let projections = local.map(|p| dot(p, axis));
                projections.into_iter().fold(f64::INFINITY, f64::min) <= radius
                    && projections.into_iter().fold(f64::NEG_INFINITY, f64::max) >= -radius
            })
    })
}
fn valid(world: &World, placements: &[Placement]) -> bool {
    let supports: Vec<_> = world
        .physical
        .devices
        .iter()
        .flat_map(|d| &d.following_supports)
        .collect();
    let mut ids = HashSet::new();
    for placement in placements {
        if !ids.insert(&placement.device) || !supports.iter().any(|s| s.id == placement.device) {
            return false;
        }
    }
    let mut placed = Vec::new();
    for support in supports {
        let position = picked(support, placements);
        if position.iter().any(|v| !v.is_finite())
            || distance(position, support.spawn) > support.max_distance + EPS
        {
            return false;
        }
        let moved = distance(position, support.spawn) > EPS;
        let supplied = placements.iter().any(|p| p.device == support.id);
        let Some(bodies) = bodies(support, position) else {
            if supplied {
                return false;
            }
            for source in &support.bodies {
                placed.push((support.id.clone(), enclosing(source), false));
            }
            continue;
        };
        for (index, body) in bodies.into_iter().enumerate() {
            let bounds = Bounds::points(&body);
            if supplied {
                if !world.coverage_contains(bounds) || world.excluded(bounds) {
                    return false;
                }
                let triangles = world.static_triangles(bounds.expand(EPS));
                if !supported(body, &triangles) || blocked(body, &triangles) {
                    return false;
                }
            }
            if moved {
                let source = source_body(&support.bodies[index]).unwrap();
                let original = Bounds::points(&source);
                if !world.coverage_contains(original)
                    || blocked(source, &world.static_triangles(original.expand(EPS)))
                {
                    return false;
                }
            }
            placed.push((support.id.clone(), body, supplied));
        }
    }
    for i in 0..placed.len() {
        for j in i + 1..placed.len() {
            if placed[i].0 == placed[j].0 || !(placed[i].2 || placed[j].2) {
                continue;
            }
            let a = Bounds::points(&placed[i].1);
            let b = Bounds::points(&placed[j].1);
            // Conservative joint separation, including unselected boxes at spawn.
            if (0..3).all(|k| a.max[k].min(b.max[k]) - a.min[k].max(b.min[k]) > EPS) {
                return false;
            }
        }
    }
    true
}
pub(super) fn prepare(
    world: &World,
    hints: Vec<Vec<Placement>>,
) -> Result<Vec<Vec<Placement>>, String> {
    let supports: Vec<_> = world
        .physical
        .devices
        .iter()
        .flat_map(|d| &d.following_supports)
        .collect();
    let mut ids = HashSet::new();
    for support in &supports {
        if !ids.insert(&support.id)
            || support.assumption != "placement-within-activity-range"
            || !support.max_distance.is_finite()
            || support.max_distance < 0.
            || support.spawn.iter().any(|v| !v.is_finite())
            || support.bodies.is_empty()
            || support
                .bodies
                .iter()
                .any(|b| b.is_empty() || b.iter().flatten().any(|v| !v.is_finite()))
        {
            return Err("Invalid following support facts".into());
        }
    }
    if hints.len() >= LIMIT {
        return Err("At most three prepared placement layouts are supported".into());
    }
    let mut result = vec![Vec::new()];
    for hint in hints {
        if !valid(world, &hint) {
            return Err("Invalid prepared placement layout".into());
        }
        result.push(hint);
    }
    if result.len() > 1 || supports.is_empty() {
        return Ok(result);
    }
    // Fixed directions/radii around source spawns, never request endpoints.
    // Retain only three complete joint layouts; no Cartesian-product expansion.
    for radius in [4., 8., 16., 32., 48.] {
        for [dx, dz] in [[1., 0.], [0., 1.], [-1., 0.], [0., -1.]] {
            let mut layout = Vec::new();
            for support in &supports {
                let Some(bodies) = bodies(support, support.spawn) else {
                    continue;
                };
                let base = bodies
                    .iter()
                    .map(|b| Bounds::points(b).min[1])
                    .fold(f64::INFINITY, f64::min);
                let x = support.spawn[0] + dx * radius;
                let z = support.spawn[2] + dz * radius;
                let bounds = Bounds {
                    min: [x - EPS, support.spawn[1] - support.max_distance, z - EPS],
                    max: [x + EPS, support.spawn[1] + support.max_distance, z + EPS],
                };
                let mut heights: Vec<_> = world
                    .static_triangles(bounds)
                    .into_iter()
                    .filter(|t| cross(sub(t[1], t[0]), sub(t[2], t[0]))[1] > EPS)
                    .filter_map(|t| triangle_height([x, 0., z], t))
                    .collect();
                heights.sort_by(|a, b| (a - base).abs().total_cmp(&(b - base).abs()));
                for floor in heights.into_iter().take(4) {
                    let position = [x, floor - (base - support.spawn[1]), z];
                    let mut proposal = layout.clone();
                    proposal.push(Placement {
                        device: support.id.clone(),
                        position,
                    });
                    if valid(world, &proposal) {
                        layout = proposal;
                        break;
                    }
                }
            }
            if !layout.is_empty() && valid(world, &layout) {
                result.push(layout);
                if result.len() == LIMIT {
                    return Ok(result);
                }
            }
        }
    }
    Ok(result)
}
