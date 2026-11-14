//! Navigation mesh geometry shared by coarse proposals and physical support.
//! These operations project/stitch faces; they do not certify body motion.
use crate::geometry::distance;
use crate::geometry::{Index, cross, dot, mix, sub};
use crate::model::{Bounds, Extra, Interaction, Portal, Surface, Vec3};
#[derive(Clone, Debug)]
pub struct Projection {
    pub surface: String,
    pub position: Vec3,
    pub distance: f64,
}

use std::collections::BTreeMap;
fn finite(p: Vec3) -> bool {
    p.into_iter().all(f64::is_finite)
}

fn clip(mut poly: Vec<Vec3>, plane: impl Fn(Vec3) -> f64) -> Vec<Vec3> {
    let mut out = vec![];
    if poly.is_empty() {
        return out;
    }
    for i in 0..poly.len() {
        let a = poly[i];
        let b = poly[(i + 1) % poly.len()];
        let x = plane(a);
        let y = plane(b);
        if x >= 0. {
            out.push(a)
        }
        if (x >= 0.) != (y >= 0.) {
            out.push(mix(a, b, x / (x - y)))
        }
    }
    poly.clear();
    out
}
pub(crate) fn clip_to_bounds(mut poly: Vec<Vec3>, b: Option<&Bounds>) -> Vec<Vec3> {
    if let Some(b) = b {
        for a in 0..2 {
            let axis = if a == 0 { 0 } else { 2 };
            poly = clip(poly, |p| p[axis] - b.min[a]);
            poly = clip(poly, |p| b.max[a] - p[axis]);
        }
    }
    poly
}
fn nearest_edge(p: Vec3, a: Vec3, b: Vec3) -> Vec3 {
    let d = sub(b, a);
    let len = dot(d, d);
    mix(
        a,
        b,
        if len == 0. {
            0.
        } else {
            (dot(sub(p, a), d) / len).clamp(0., 1.)
        },
    )
}
fn closest(p: Vec3, t: [Vec3; 3]) -> Vec3 {
    let ab = sub(t[1], t[0]);
    let ac = sub(t[2], t[0]);
    let at = sub(p, t[0]);
    let aa = dot(ab, ab);
    let bb = dot(ac, ac);
    let c = dot(ab, ac);
    let det = aa * bb - c * c;
    if det > 1e-20 {
        let u = (bb * dot(at, ab) - c * dot(at, ac)) / det;
        let v = (aa * dot(at, ac) - c * dot(at, ab)) / det;
        if u >= 0. && v >= 0. && u + v <= 1. {
            return std::array::from_fn(|i| t[0][i] + u * ab[i] + v * ac[i]);
        }
    }
    (0..3)
        .map(|i| nearest_edge(p, t[i], t[(i + 1) % 3]))
        .min_by(|&a, &b| distance(p, a).total_cmp(&distance(p, b)))
        .unwrap()
}
pub(crate) fn closest_on_surface(surface: &Surface, p: Vec3) -> Option<Vec3> {
    let vertices = &surface.vertices;
    (1..vertices.len() - 1)
        .filter_map(|i| {
            let triangle = [vertices[0], vertices[i], vertices[i + 1]];
            // Match the support index's fan eligibility; vertical faces cannot
            // supply landing support even when their 3D area is nonzero.
            (cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]))[1].abs() > 1e-12)
                .then(|| closest(p, triangle))
        })
        .min_by(|&a, &b| distance(p, a).total_cmp(&distance(p, b)))
}
pub(crate) fn project(
    index: &Index,
    owners: &[usize],
    surfaces: &[Surface],
    p: Vec3,
    tolerance: f64,
    interaction: Option<&Interaction>,
) -> Result<Vec<Projection>, String> {
    if !finite(p) || !tolerance.is_finite() || tolerance < 0. {
        return Err("Invalid projection".into());
    }
    if let Some(i) = interaction
        && (!i.radius.is_finite()
            || i.radius < 0.
            || i.max_vertical.is_some_and(|v| !v.is_finite() || v < 0.)
            || i.half_angle
                .is_some_and(|v| !v.is_finite() || v <= 0. || v > 90.)
            || i.facing.is_some() != i.half_angle.is_some()
            || i.facing
                .is_some_and(|v| !finite(v) || v[0].hypot(v[2]) == 0.))
    {
        return Err("Invalid interaction".into());
    }
    let vertical = interaction.map_or(tolerance, |i| i.max_vertical.unwrap_or(i.radius));
    let radius = interaction.map_or(1e-7, |i| i.radius);
    let query = [
        p[0] - radius,
        p[1] - vertical,
        p[2] - radius,
        p[0] + radius,
        p[1] + vertical,
        p[2] + radius,
    ];
    let mut best: BTreeMap<usize, Projection> = BTreeMap::new();
    for id in index.candidates(query) {
        let t = index.faces[id];
        let mut poly = t.to_vec();
        poly = clip(poly, |q| q[1] - (p[1] - vertical));
        poly = clip(poly, |q| p[1] + vertical - q[1]);
        if let Some(i) = interaction
            && let (Some(f), Some(angle)) = (i.facing, i.half_angle)
            && angle <= 90.
        {
            let len = f[0].hypot(f[2]);
            if len == 0. {
                return Err("Invalid facing".into());
            }
            let x = f[0] / len;
            let z = f[2] / len;
            let sin = angle.to_radians().sin();
            let cos = angle.to_radians().cos();
            poly = clip(poly, |q| {
                (q[0] - p[0]) * (sin * x + cos * z) + (q[2] - p[2]) * (sin * z - cos * x)
            });
            poly = clip(poly, |q| {
                (q[0] - p[0]) * (sin * x - cos * z) + (q[2] - p[2]) * (sin * z + cos * x)
            });
        }
        if poly.is_empty() {
            continue;
        }
        let q = if interaction.is_none() {
            let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
            let q = [
                p[0],
                t[0][1] - (n[0] * (p[0] - t[0][0]) + n[2] * (p[2] - t[0][2])) / n[1],
                p[2],
            ];
            if closest(q, t)
                .iter()
                .zip(q)
                .any(|(a, b)| (a - b).abs() > 1e-7)
            {
                continue;
            }
            q
        } else if poly.len() < 3 {
            nearest_edge(p, poly[0], *poly.last().unwrap())
        } else {
            (1..poly.len() - 1)
                .map(|i| closest(p, [poly[0], poly[i], poly[i + 1]]))
                .min_by(|&a, &b| distance(p, a).total_cmp(&distance(p, b)))
                .unwrap()
        };
        if let Some(i) = interaction {
            if distance(p, q) > i.radius + 1e-9 {
                continue;
            }
            if let (Some(f), Some(a)) = (i.facing, i.half_angle) {
                let dx = q[0] - p[0];
                let dz = q[2] - p[2];
                if dx * f[0] + dz * f[2]
                    < dx.hypot(dz) * f[0].hypot(f[2]) * a.to_radians().cos() - 1e-9
                {
                    continue;
                }
            }
        }
        let owner = owners[id];
        let hit = Projection {
            surface: surfaces[owner].id.clone(),
            position: q,
            distance: distance(p, q),
        };
        if best.get(&owner).is_none_or(|v| hit.distance < v.distance) {
            best.insert(owner, hit);
        }
    }
    let mut out: Vec<_> = best.into_values().collect();
    out.sort_by(|a, b| {
        a.distance
            .total_cmp(&b.distance)
            .then_with(|| a.surface.cmp(&b.surface))
    });
    Ok(out)
}
// Exact XZ edge keys avoid quadratic mesh stitching. Each edge can own multiple
// heights; direction and step limits determine which links are admissible.
pub(crate) fn portals(surfaces: &[Surface], step_up: f64, step_down: f64) -> Vec<Portal> {
    type Key = ((i64, i64), (i64, i64));
    let mut edges: BTreeMap<Key, Vec<(usize, Vec3, Vec3)>> = BTreeMap::new();
    let key = |p: Vec3| ((p[0] * 1e7).round() as i64, (p[2] * 1e7).round() as i64);
    for (id, s) in surfaces.iter().enumerate() {
        for i in 0..s.vertices.len() {
            if s.portals.as_ref().is_some_and(|edges| !edges.contains(&i)) {
                continue;
            }
            let mut a = s.vertices[i];
            let mut b = s.vertices[(i + 1) % s.vertices.len()];
            let mut x = key(a);
            let mut y = key(b);
            if x > y {
                std::mem::swap(&mut x, &mut y);
                std::mem::swap(&mut a, &mut b);
            }
            edges.entry((x, y)).or_default().push((id, a, b));
        }
    }
    let mut out = vec![];
    let mut unmatched = vec![];
    for list in edges.values() {
        if list.len() == 1 {
            unmatched.push(list[0]);
        }
        for &(i, a, b) in list {
            for &(j, c, d) in list {
                if i == j {
                    continue;
                }
                let dy = (c[1] - a[1]).max(d[1] - b[1]);
                let low = (c[1] - a[1]).min(d[1] - b[1]);
                if dy > step_up + 1e-7 || low < -step_down - 1e-7 {
                    continue;
                }
                out.push(Portal {
                    from: surfaces[i].id.clone(),
                    to: surfaces[j].id.clone(),
                    points: [mix(a, b, 0.5), mix(c, d, 0.5)],
                    entry: Some([a, b]),
                    exit: Some([c, d]),
                    extra: Extra::new(),
                });
            }
        }
    }
    // Tile boundaries may split one long edge into several shorter intervals.
    // Only unmatched edges enter this pass; shared full edges keep their exact
    // pairing and point contacts never create passage.
    type Line = (i64, i64, i64);
    type Boundary = (usize, Vec3, Vec3, f64, f64);
    let mut lines: BTreeMap<Line, Vec<Boundary>> = BTreeMap::new();
    for (id, a, b) in unmatched {
        let length = (b[0] - a[0]).hypot(b[2] - a[2]);
        if length <= 1e-9 {
            continue;
        }
        let mut dx = (b[0] - a[0]) / length;
        let mut dz = (b[2] - a[2]) / length;
        if dx < -1e-12 || (dx.abs() <= 1e-12 && dz < 0.) {
            dx = -dx;
            dz = -dz;
        }
        let key = (
            (dx * 1e8).round() as i64,
            (dz * 1e8).round() as i64,
            ((-dz * a[0] + dx * a[2]) * 1e6).round() as i64,
        );
        let u = a[0] * dx + a[2] * dz;
        let v = b[0] * dx + b[2] * dz;
        lines
            .entry(key)
            .or_default()
            .push((id, a, b, u.min(v), u.max(v)));
    }
    for list in lines.values_mut() {
        list.sort_by(|a, b| a.3.total_cmp(&b.3));
        for i in 0..list.len() {
            let (from, a, b, low, high) = list[i];
            let length = (b[0] - a[0]).hypot(b[2] - a[2]);
            let dx = (b[0] - a[0]) / length;
            let dz = (b[2] - a[2]) / length;
            let u = |p: Vec3| p[0] * dx + p[2] * dz;
            let at = |x: Vec3, y: Vec3, t: f64| mix(x, y, (t - u(x)) / (u(y) - u(x)));
            for &(to, c, d, next_low, next_high) in &list[i + 1..] {
                if next_low >= high - 1e-9 {
                    break;
                }
                if from == to || high.min(next_high) - low.max(next_low) <= 1e-7 {
                    continue;
                }
                let lo = u(a).min(u(b)).max(u(c).min(u(d)));
                let hi = u(a).max(u(b)).min(u(c).max(u(d)));
                if hi - lo <= 1e-7 {
                    continue;
                }
                let entry = [at(a, b, lo), at(a, b, hi)];
                let exit = [at(c, d, lo), at(c, d, hi)];
                if (0..2).any(|j| (entry[j][0] - exit[j][0]).hypot(entry[j][2] - exit[j][2]) > 1e-7)
                {
                    continue;
                }
                for (source, target, entry, exit) in
                    [(from, to, entry, exit), (to, from, exit, entry)]
                {
                    let delta = [exit[0][1] - entry[0][1], exit[1][1] - entry[1][1]];
                    if delta
                        .iter()
                        .any(|&y| y > step_up + 1e-7 || y < -step_down - 1e-7)
                    {
                        continue;
                    }
                    out.push(Portal {
                        from: surfaces[source].id.clone(),
                        to: surfaces[target].id.clone(),
                        points: [mix(entry[0], entry[1], 0.5), mix(exit[0], exit[1], 0.5)],
                        entry: Some(entry),
                        exit: Some(exit),
                        extra: Extra::new(),
                    });
                }
            }
        }
    }
    out
}
