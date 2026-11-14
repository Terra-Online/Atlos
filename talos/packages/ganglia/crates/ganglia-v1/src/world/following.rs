//! Following-body ownership stays separate from raw static collision. A pose
//! binding replaces the body's default geometry and survives window clipping.
use super::devices::{convex_faces, footprint_supported, hull};
use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Placement {
    device: String,
    position: Vec3,
}
pub(super) fn merge_placements(
    snapshot: &Value,
    devices: &Devices,
    extra: &[Value],
) -> Result<Vec<Placement>, String> {
    let previous: Vec<Placement> =
        optional(&snapshot["placements"], "placements")?.unwrap_or_default();
    let mut bound = BTreeMap::new();
    for p in previous
        .into_iter()
        .map(Ok)
        .chain(extra.iter().map(|p| decode(p, "placement")))
    {
        let p: Placement = p?;
        if !finite(p.position) || !devices.following_supports.iter().any(|d| d.id == p.device) {
            return Err("Invalid or unknown following placement".into());
        }
        if let Some(old) = bound.insert(p.device, p.position)
            && old != p.position
        {
            return Err("Conflicting following placements".into());
        }
    }
    Ok(bound
        .into_iter()
        .map(|(device, position)| Placement { device, position })
        .collect())
}
pub(super) struct Geometry {
    pub surfaces: Vec<Surface>,
    pub faces: Vec<[Vec3; 3]>,
    pub walls: Vec<Wall>,
}
#[derive(Clone, Copy)]
struct BodyBounds {
    min: Vec3,
    max: Vec3,
}
fn bounds(points: &[Vec3]) -> BodyBounds {
    BodyBounds {
        min: std::array::from_fn(|i| points.iter().map(|p| p[i]).fold(f64::INFINITY, f64::min)),
        max: std::array::from_fn(|i| {
            points
                .iter()
                .map(|p| p[i])
                .fold(f64::NEG_INFINITY, f64::max)
        }),
    }
}
fn overlaps(a: BodyBounds, b: BodyBounds) -> bool {
    (0..3).all(|i| a.min[i] <= b.max[i] && a.max[i] >= b.min[i])
}
fn flat_box(body: &[Vec3]) -> bool {
    if body.len() != 8 || body.iter().any(|&p| !finite(p)) {
        return false;
    }
    let axes = [
        sub(body[1], body[0]),
        sub(body[2], body[0]),
        sub(body[4], body[0]),
    ];
    if axes.iter().any(|&a| hypot(a) < 1e-5) {
        return false;
    }
    for i in 0..3 {
        for j in i + 1..3 {
            if collision::dot(axes[i], axes[j]).abs() > hypot(axes[i]) * hypot(axes[j]) * 1e-5 {
                return false;
            }
        }
    }
    for (bits, &p) in body.iter().enumerate() {
        let expected = std::array::from_fn(|a| {
            body[0][a]
                + (0..3)
                    .filter(|i| bits & (1 << i) != 0)
                    .map(|i| axes[i][a])
                    .sum::<f64>()
        });
        if distance(p, expected) > 1e-5 {
            return false;
        }
    }
    let b = bounds(body);
    body.iter()
        .filter(|p| (p[1] - b.min[1]).abs() < 1e-5)
        .count()
        == 4
        && body
            .iter()
            .filter(|p| (p[1] - b.max[1]).abs() < 1e-5)
            .count()
            == 4
}
fn on_face(triangle: &[Vec3; 3], body: &[Vec3]) -> bool {
    let axes = [
        sub(body[1], body[0]),
        sub(body[2], body[0]),
        sub(body[4], body[0]),
    ];
    let coordinates: [[f64; 3]; 3] = triangle.map(|p| {
        std::array::from_fn(|i| {
            collision::dot(axes[i], sub(p, body[0])) / collision::dot(axes[i], axes[i])
        })
    });
    coordinates
        .iter()
        .flatten()
        .all(|&v| (-1e-5..=1. + 1e-5).contains(&v))
        && (0..3).any(|i| {
            coordinates.iter().all(|p| p[i].abs() < 1e-5)
                || coordinates.iter().all(|p| (p[i] - 1.).abs() < 1e-5)
        })
}
// Return whether any loaded part intersects this body and whether all of its
// footprint is loaded. Unloaded bodies retain their bindings without geometry.
fn loaded(coverage: &Coverage, raw: &Index, body: BodyBounds) -> (bool, bool) {
    let mut low = [body.min[0], body.min[2]];
    let mut high = [body.max[0], body.max[2]];
    let mut complete = true;
    for scope in [coverage.bounds.as_ref(), raw.scope.as_ref()]
        .into_iter()
        .flatten()
    {
        for i in 0..2 {
            if high[i] < scope.min[i] || low[i] > scope.max[i] {
                return (false, false);
            }
            complete &= low[i] >= scope.min[i] && high[i] <= scope.max[i];
            low[i] = low[i].max(scope.min[i]);
            high[i] = high[i].min(scope.max[i]);
        }
    }
    if let Some(tiles) = &coverage.tiles {
        let span = coverage.tile_span;
        let intersects = tiles.iter().any(|&(x, z)| {
            low[0] <= (x + 1) as f64 * span
                && high[0] >= x as f64 * span
                && low[1] <= (z + 1) as f64 * span
                && high[1] >= z as f64 * span
        });
        if !intersects {
            return (false, false);
        }
        let x0 = (body.min[0] / span).floor() as i64;
        let x1 = (body.max[0] / span).floor() as i64;
        let z0 = (body.min[2] / span).floor() as i64;
        let z1 = (body.max[2] / span).floor() as i64;
        if (x1 - x0 + 1) as i128 * (z1 - z0 + 1) as i128 > 1_000_000 {
            return (true, false);
        }
        complete &= (x0..=x1).all(|x| (z0..=z1).all(|z| tiles.contains(&(x, z))));
    }
    (true, complete)
}
pub(super) fn materialize(
    snapshot: &Value,
    devices: &Devices,
    raw: &Index,
    walls: &[Wall],
    coverage: &Coverage,
    max_slope: f64,
) -> Result<Option<Geometry>, String> {
    let placements = merge_placements(snapshot, devices, &[])?;
    let bound: BTreeMap<_, _> = placements
        .into_iter()
        .map(|p| (p.device, p.position))
        .collect();
    let mut out = Geometry {
        surfaces: vec![],
        faces: vec![],
        walls: vec![],
    };
    let mut ids = HashSet::new();
    // Bounds are based on all selected poses, avoiding sequential A-moved vs
    // B-default rejection when the caller moves both bodies in one transaction.
    let mut selected = BTreeMap::new();
    for d in &devices.following_supports {
        if !ids.insert(&d.id)
            || d.bodies.is_empty()
            || d.bodies
                .iter()
                .any(|b| b.is_empty() || b.iter().any(|&p| !finite(p)))
        {
            return Err("Invalid following body or duplicate device".into());
        }
        let position = bound.get(&d.id).copied().unwrap_or(d.spawn);
        if !finite(d.spawn)
            || !d.max_distance.is_finite()
            || d.max_distance < 0.
            || d.assumption != "placement-within-activity-range"
            || distance(position, d.spawn) > d.max_distance + 1e-6
        {
            return Ok(None);
        }
        let delta = sub(position, d.spawn);
        let bodies: Vec<Vec<Vec3>> = d
            .bodies
            .iter()
            .map(|b| {
                b.iter()
                    .map(|&p| std::array::from_fn(|i| p[i] + delta[i]))
                    .collect()
            })
            .collect();
        selected.insert(
            d.id.clone(),
            bounds(&bodies.iter().flatten().copied().collect::<Vec<_>>()),
        );
    }
    for d in &devices.following_supports {
        let position = bound.get(&d.id).copied().unwrap_or(d.spawn);
        let explicit = bound.contains_key(&d.id);
        let delta = sub(position, d.spawn);
        if explicit && (d.geometry_kind != "box" || d.bodies.iter().any(|b| !flat_box(b))) {
            return Ok(None);
        }
        for (i, source) in d.bodies.iter().enumerate() {
            let body: Vec<Vec3> = source
                .iter()
                .map(|&p| std::array::from_fn(|a| p[a] + delta[a]))
                .collect();
            let b = bounds(&body);
            let (intersects, complete) = loaded(coverage, raw, b);
            if !intersects {
                continue;
            }
            let box_body = d.geometry_kind == "box" && flat_box(source);
            if explicit {
                if !complete {
                    return Ok(None);
                }
                let bottom = hull(
                    body.iter()
                        .filter(|p| (p[1] - b.min[1]).abs() < 1e-5)
                        .copied()
                        .collect(),
                );
                let candidates =
                    raw.candidates([b.min[0], -f64::MAX, b.min[2], b.max[0], f64::MAX, b.max[2]]);
                let faces: Vec<_> = candidates.iter().map(|&i| raw.faces[i]).collect();
                if !footprint_supported(&bottom, b.min[1], &faces) {
                    return Ok(None);
                }
                let initial = distance(position, d.spawn) <= 1e-5;
                if faces.iter().any(|t| {
                    (!initial || !on_face(t, source))
                        && bounds(t).max[1] > b.min[1] + 1e-5
                        && overlaps(b, bounds(t))
                }) {
                    return Ok(None);
                }
                if !initial {
                    let original = bounds(&d.bodies.iter().flatten().copied().collect::<Vec<_>>());
                    let (original_loaded, original_complete) = loaded(coverage, raw, original);
                    if original_loaded
                        && (!original_complete
                            || raw
                                .candidates([
                                    original.min[0],
                                    -f64::MAX,
                                    original.min[2],
                                    original.max[0],
                                    f64::MAX,
                                    original.max[2],
                                ])
                                .into_iter()
                                .any(|i| {
                                    bounds(&raw.faces[i]).max[1] > original.min[1] + 1e-5
                                        && overlaps(original, bounds(&raw.faces[i]))
                                }))
                    {
                        return Ok(None);
                    }
                }
                if walls.iter().any(|w| {
                    w.state != "inactive"
                        && overlaps(
                            b,
                            BodyBounds {
                                min: w.min,
                                max: w.max,
                            },
                        )
                }) {
                    return Ok(None);
                }
                if selected.iter().any(|(id, other)| {
                    id != &d.id
                        && (0..3)
                            .all(|a| b.max[a].min(other.max[a]) - b.min[a].max(other.min[a]) > 1e-5)
                }) {
                    return Ok(None);
                }
                let tolerance =
                    number(&snapshot["input"]["ground"]["build"], "cellHeight", 0.1) * 3. + 0.01;
                let Some(hit) = raw.ground(
                    [position[0], b.min[1], position[2]],
                    tolerance.max(0.02),
                    tolerance.max(0.02),
                    max_slope,
                    0.,
                )?
                else {
                    return Ok(None);
                };
                if (hit.position[1] - b.min[1]).abs() > tolerance.max(0.02) {
                    return Ok(None);
                }
            }
            let mut extra = Extra::new();
            extra.insert("followingDevice".into(), Value::String(d.id.clone()));
            out.walls.push(Wall {
                min: b.min,
                max: b.max,
                state: "active".into(),
                padding: 0.,
                sphere: None,
                points: None,
                polygon: None,
                extra,
            });
            if box_body {
                out.faces.extend(convex_faces(&body));
                let top = hull(
                    body.iter()
                        .filter(|p| (p[1] - b.max[1]).abs() < 1e-5)
                        .copied()
                        .collect(),
                );
                let mut extra = Extra::new();
                extra.insert("supportDevice".into(), Value::String(d.id.clone()));
                extra.insert("followingDevice".into(), Value::String(d.id.clone()));
                extra.insert(
                    "placement".into(),
                    serde_json::json!({"device":d.id,"position":position}),
                );
                out.surfaces.push(Surface {
                    id: format!("following/{}/{i}", d.id),
                    vertices: top,
                    portals: None,
                    extra,
                });
            }
        }
    }
    Ok(Some(out))
}
