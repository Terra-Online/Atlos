use super::collision::{dot, mix};
use super::*;
use std::collections::BTreeSet;

// Imported portals use the same world-space boundary tolerance as the shared
// TypeScript geometry contract. Only collinear entry intervals subtract length.
const PORTAL_TOLERANCE: f64 = 1e-4;
const MIN_LENGTH: f64 = 1e-9;

fn aperture(a: Vec3, b: Vec3, points: [Vec3; 2]) -> Option<(f64, f64)> {
    let delta = sub(b, a);
    let squared = dot(delta, delta);
    let at = |point| {
        let t = dot(sub(point, a), delta) / squared;
        (distance(point, mix(a, b, t)) <= PORTAL_TOLERANCE).then_some(t)
    };
    let x = at(points[0])?;
    let y = at(points[1])?;
    let low = x.min(y).max(0.);
    let high = x.max(y).min(1.);
    (low < high && distance(mix(a, b, low), mix(a, b, high)) > MIN_LENGTH).then_some((low, high))
}

fn clip_segment(a: Vec3, b: Vec3, bounds: &Bounds) -> Option<[Vec3; 2]> {
    let mut low: f64 = 0.;
    let mut high: f64 = 1.;
    for (axis, horizontal) in [(0, 0), (2, 1)] {
        let delta = b[axis] - a[axis];
        if delta == 0. {
            if a[axis] < bounds.min[horizontal] || a[axis] > bounds.max[horizontal] {
                return None;
            }
        } else {
            let x = (bounds.min[horizontal] - a[axis]) / delta;
            let y = (bounds.max[horizontal] - a[axis]) / delta;
            low = low.max(x.min(y));
            high = high.min(x.max(y));
        }
    }
    if low >= high {
        return None;
    }
    let points = [mix(a, b, low), mix(a, b, high)];
    (distance(points[0], points[1]) > MIN_LENGTH).then_some(points)
}

pub(super) fn query(world: &World, bounds: Bounds) -> Result<Vec<Boundary>, String> {
    if (0..2).any(|i| {
        !bounds.min[i].is_finite() || !bounds.max[i].is_finite() || bounds.min[i] > bounds.max[i]
    }) {
        return Err("Invalid support boundary bounds".into());
    }
    // The support index selects owning polygons; fans contribute no artificial
    // boundary edges. Sorted owners preserve source order across BVH traversal.
    let owners: BTreeSet<_> = world
        .support
        .candidates([
            bounds.min[0],
            f64::NEG_INFINITY,
            bounds.min[1],
            bounds.max[0],
            f64::INFINITY,
            bounds.max[1],
        ])
        .into_iter()
        .map(|triangle| world.owners[triangle])
        .collect();
    let mut result = vec![];
    for owner in owners {
        let surface = &world.surfaces[owner];
        let vertices = &surface.vertices;
        let origin = vertices[0];
        let signed_area: f64 = vertices
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let b = vertices[(i + 1) % vertices.len()];
                (a[0] - origin[0]) * (b[2] - origin[2]) - (b[0] - origin[0]) * (a[2] - origin[2])
            })
            .sum();
        if signed_area == 0. {
            continue;
        }
        for (i, &a) in vertices.iter().enumerate() {
            let b = vertices[(i + 1) % vertices.len()];
            let dx = b[0] - a[0];
            let dz = b[2] - a[2];
            let length = dx.hypot(dz);
            if length <= MIN_LENGTH || clip_segment(a, b, &bounds).is_none() {
                continue;
            }
            let winding = signed_area.signum();
            let inward = [-winding * dz / length, 0., winding * dx / length];
            let mut covered: Vec<_> = world.portal_owners[owner]
                .iter()
                .filter_map(|&id| {
                    // Point transfers authorize only their point, never the
                    // surrounding boundary or an inferred reverse aperture.
                    world.portals[id]
                        .entry
                        .and_then(|entry| aperture(a, b, entry))
                })
                .collect();
            covered.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
            let mut end: f64 = 0.;
            let mut emit = |low, high| {
                if let Some(points) = clip_segment(mix(a, b, low), mix(a, b, high), &bounds) {
                    result.push(Boundary {
                        surface: surface.id.clone(),
                        points,
                        inward,
                    });
                }
            };
            for (low, high) in covered {
                if low > end {
                    emit(end, low);
                }
                end = end.max(high);
            }
            if end < 1. {
                emit(end, 1.);
            }
        }
    }
    Ok(result)
}

// Clip an edge to another triangle's projected coverage at matching physical
// height. Only coverage extending outside the owner removes its boundary;
// duplicate or same-side faces cannot erase an exposed edge.
fn raw_coverage(a: Vec3, b: Vec3, inward: Vec3, triangle: [Vec3; 3]) -> Option<(f64, f64)> {
    if !triangle.iter().any(|&p| dot(sub(p, a), inward) < -1e-8) {
        return None;
    }
    let u = sub(triangle[1], triangle[0]);
    let v = sub(triangle[2], triangle[0]);
    let determinant = u[0] * v[2] - u[2] * v[0];
    if determinant.abs() < 1e-12 {
        return None;
    }
    let weights = |p: Vec3| {
        let d = sub(p, triangle[0]);
        let b = (d[0] * v[2] - d[2] * v[0]) / determinant;
        let c = (u[0] * d[2] - u[2] * d[0]) / determinant;
        [1. - b - c, b, c]
    };
    let first = weights(a);
    let last = weights(b);
    let mut lo: f64 = 0.;
    let mut hi: f64 = 1.;
    let mut clip = |x: f64, y: f64| {
        if x < 0. && y < 0. {
            return false;
        }
        if x < 0. {
            lo = lo.max(x / (x - y));
        }
        if y < 0. {
            hi = hi.min(x / (x - y));
        }
        lo <= hi
    };
    for i in 0..3 {
        if !clip(first[i] + 1e-9, last[i] + 1e-9) {
            return None;
        }
    }
    let first_y = (0..3).map(|i| first[i] * triangle[i][1]).sum::<f64>();
    let last_y = (0..3).map(|i| last[i] * triangle[i][1]).sum::<f64>();
    let x = a[1] - first_y;
    let y = b[1] - last_y;
    if !clip(1e-5 - x, 1e-5 - y) || !clip(1e-5 + x, 1e-5 + y) {
        return None;
    }
    (hi - lo > 1e-9).then_some((lo, hi))
}
pub(super) fn raw(world: &World, bounds: Bounds) -> Result<Vec<RawBoundary>, String> {
    if (0..2).any(|i| {
        !bounds.min[i].is_finite() || !bounds.max[i].is_finite() || bounds.min[i] > bounds.max[i]
    }) {
        return Err("Invalid raw support boundary bounds".into());
    }
    if world.snapshot["kind"] != "physical" {
        return Ok(vec![]);
    }
    let query = [
        bounds.min[0],
        f64::NEG_INFINITY,
        bounds.min[1],
        bounds.max[0],
        f64::INFINITY,
        bounds.max[1],
    ];
    let indices = [&world.collision, &world.moving_support];
    let eligible = |t: [Vec3; 3]| {
        let normal = cross(sub(t[1], t[0]), sub(t[2], t[0]));
        normal[1] > 0. && normal[1] / hypot(normal) >= world.movement.max_slope.to_radians().cos()
    };
    let mut result = vec![];
    let mut seen = HashSet::new();
    let mut work = 0_usize;
    for index in indices {
        let candidates = index.candidates(query);
        if candidates.len() > 100_000 {
            return Err("Raw boundary query exceeds geometry budget".into());
        }
        for id in candidates {
            let triangle = index.faces[id];
            if !eligible(triangle) {
                continue;
            }
            for i in 0..3 {
                let Some([a, b]) = clip_segment(triangle[i], triangle[(i + 1) % 3], &bounds) else {
                    continue;
                };
                let dx = b[0] - a[0];
                let dz = b[2] - a[2];
                let length = dx.hypot(dz);
                if length < 1e-9 {
                    continue;
                }
                // Upward triangles are clockwise in XZ.
                let inward = [dz / length, 0., -dx / length];
                let neighbors = [
                    a[0].min(b[0]) - 1e-8,
                    a[1].min(b[1]) - 1e-5,
                    a[2].min(b[2]) - 1e-8,
                    a[0].max(b[0]) + 1e-8,
                    a[1].max(b[1]) + 1e-5,
                    a[2].max(b[2]) + 1e-8,
                ];
                let mut covered = vec![];
                for other in indices {
                    for id in other.candidates(neighbors) {
                        work += 1;
                        if work > 100_000 {
                            return Err("Raw boundary query exceeds geometry budget".into());
                        }
                        let face = other.faces[id];
                        if eligible(face)
                            && let Some(interval) = raw_coverage(a, b, inward, face)
                        {
                            covered.push(interval);
                        }
                    }
                }
                covered.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.total_cmp(&b.1)));
                let mut end: f64 = 0.;
                let mut emit = |low: f64, high: f64| {
                    if high - low <= 1e-9 {
                        return;
                    }
                    let points = [mix(a, b, low), mix(a, b, high)];
                    // Repeated raw faces retain one proposal without changing
                    // geometry or approximating coordinates onto a grid.
                    let key = serde_json::to_string(&(points, inward)).unwrap();
                    if seen.insert(key) {
                        result.push(RawBoundary { points, inward });
                    }
                };
                for (low, high) in covered {
                    if low > end {
                        emit(end, low);
                    }
                    end = end.max(high);
                }
                if end < 1. {
                    emit(end, 1.);
                }
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn world(surfaces: Value, portals: Value) -> World {
        World::new(json!({"kind":"surfaces","input":{
            "surfaces":surfaces,"portals":portals,
            "collision":{"positions":[],"indices":[]},"walls":[],
            "movement":{"speed":4.,"maxVertical":0.5,
                "profile":{"radius":0.2,"height":1.8},"maxSlope":45.,
                "model":{"gravity":10.,"fallingGravity":20.,"maxJumpHeight":2.,
                    "maxFallingSpeed":12.,"apexTime":0.1,"maxHorizontalSpeed":6.}}
        }}))
        .unwrap()
    }
    fn seam() -> Bounds {
        Bounds {
            min: [-0.1, -1.5],
            max: [0.1, 1.5],
        }
    }
    fn z_intervals(boundaries: &[Boundary], surface: &str) -> Vec<[f64; 2]> {
        let mut intervals: Vec<_> = boundaries
            .iter()
            .filter(|b| b.surface == surface)
            .map(|b| {
                [
                    b.points[0][2].min(b.points[1][2]),
                    b.points[0][2].max(b.points[1][2]),
                ]
            })
            .collect();
        intervals.sort_by(|a, b| a[0].total_cmp(&b[0]));
        intervals
    }

    #[test]
    fn split_shared_edge_has_no_unconnected_interval() {
        let world = world(
            json!([
                {"id":"left","vertices":[[-2.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-2.,0.,2.]]},
                {"id":"right-low","vertices":[[0.,0.,-2.],[2.,0.,-2.],[2.,0.,0.],[0.,0.,0.]]},
                {"id":"right-high","vertices":[[0.,0.,0.],[2.,0.,0.],[2.,0.,2.],[0.,0.,2.]]}
            ]),
            json!([]),
        );
        assert!(world.support_boundaries(seam()).unwrap().is_empty());
    }

    #[test]
    fn partial_outgoing_aperture_preserves_masks_and_direction() {
        let world = world(
            json!([
                {"id":"left","vertices":[[-2.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-2.,0.,2.]],"portals":[]},
                {"id":"right","vertices":[[0.,0.,-2.],[2.,0.,-2.],[2.,0.,2.],[0.,0.,2.]],"portals":[]}
            ]),
            json!([{
                "from":"left","to":"right","points":[[0.,0.,0.],[0.,0.,0.]],
                "entry":[[0.,0.,-0.5],[0.,0.,0.5]],"exit":[[0.,0.,-0.5],[0.,0.,0.5]]
            }]),
        );
        let boundaries = world.support_boundaries(seam()).unwrap();
        assert_eq!(
            z_intervals(&boundaries, "left"),
            vec![[-1.5, -0.5], [0.5, 1.5]]
        );
        assert_eq!(z_intervals(&boundaries, "right"), vec![[-1.5, 1.5]]);
        assert!(boundaries.iter().all(|b| b.inward
            == if b.surface == "left" {
                [-1., 0., 0.]
            } else {
                [1., 0., 0.]
            }));
    }

    #[test]
    fn overlapping_apertures_are_unioned_and_point_portals_remove_no_length() {
        let world = world(
            json!([
                {"id":"left","vertices":[[-2.,0.,-2.],[0.,0.,-2.],[0.,0.,2.],[-2.,0.,2.]],"portals":[]},
                {"id":"right","vertices":[[0.,0.,-2.],[2.,0.,-2.],[2.,0.,2.],[0.,0.,2.]],"portals":[]}
            ]),
            json!([
                {"from":"left","to":"right","points":[[0.,0.,-0.5],[0.,0.,-0.5]],
                    "entry":[[0.,0.,-1.],[0.,0.,0.]],"exit":[[0.,0.,-1.],[0.,0.,0.]]},
                {"from":"left","to":"right","points":[[0.,0.,0.5],[0.,0.,0.5]],
                    "entry":[[0.,0.,-0.25],[0.,0.,1.]],"exit":[[0.,0.,-0.25],[0.,0.,1.]]},
                {"from":"right","to":"left","points":[[0.,0.,0.],[0.,0.,0.]]}
            ]),
        );
        let boundaries = world.support_boundaries(seam()).unwrap();
        assert_eq!(
            z_intervals(&boundaries, "left"),
            vec![[-1.5, -1.], [1., 1.5]]
        );
        assert_eq!(z_intervals(&boundaries, "right"), vec![[-1.5, 1.5]]);
    }

    #[test]
    fn clipping_interpolates_sloped_heights_and_winding_independent_inward() {
        for vertices in [
            json!([[0., 0., 0.], [2., 2., 0.], [2., 2., 2.], [0., 0., 2.]]),
            json!([[0., 0., 2.], [2., 2., 2.], [2., 2., 0.], [0., 0., 0.]]),
        ] {
            let world = world(
                json!([{"id":"slope","vertices":vertices,"portals":[]}]),
                json!([]),
            );
            let bounds = Bounds {
                min: [0.5, -0.1],
                max: [1.5, 0.1],
            };
            let boundaries = world.support_boundaries(bounds).unwrap();
            assert_eq!(boundaries.len(), 1);
            let edge = &boundaries[0];
            assert_eq!(edge.inward, [0., 0., 1.]);
            for point in edge.points {
                assert!((point[1] - point[0]).abs() < 1e-10);
                assert!((0.5..=1.5).contains(&point[0]));
            }
        }
    }

    #[test]
    fn malformed_query_bounds_are_rejected() {
        let world = world(json!([]), json!([]));
        assert!(
            world
                .support_boundaries(Bounds {
                    min: [1., 0.],
                    max: [0., 1.]
                })
                .is_err()
        );
        assert!(
            world
                .support_boundaries(Bounds {
                    min: [f64::NAN, 0.],
                    max: [1., 1.]
                })
                .is_err()
        );
    }
}
