use super::collision::{dot, mix};
use super::*;
use std::collections::{BTreeMap, BinaryHeap};
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
pub(super) fn clip_to_bounds(mut poly: Vec<Vec3>, b: Option<&Bounds>) -> Vec<Vec3> {
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
pub(super) fn project(
    w: &World,
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
                .is_some_and(|v| !v.is_finite() || !(0. ..=180.).contains(&v))
            || i.facing.is_some_and(|v| !finite(v)))
    {
        return Err("Invalid interaction".into());
    }
    let vertical = interaction
        .and_then(|i| i.max_vertical)
        .unwrap_or(tolerance);
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
    for id in w.support.candidates(query) {
        let t = w.support.faces[id];
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
        let owner = w.owners[id];
        let hit = Projection {
            surface: w.surfaces[owner].id.clone(),
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
pub(super) fn portals(surfaces: &[Surface], m: &Movement) -> Vec<Portal> {
    type Key = ((i64, i64), (i64, i64));
    let mut edges: BTreeMap<Key, Vec<(usize, Vec3, Vec3)>> = BTreeMap::new();
    let key = |p: Vec3| ((p[0] * 1e7).round() as i64, (p[2] * 1e7).round() as i64);
    for (id, s) in surfaces.iter().enumerate() {
        for i in 0..s.vertices.len() {
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
    for list in edges.values() {
        for &(i, a, b) in list {
            for &(j, c, d) in list {
                if i == j {
                    continue;
                }
                let dy = (c[1] - a[1]).max(d[1] - b[1]);
                let low = (c[1] - a[1]).min(d[1] - b[1]);
                if dy > m.step_up + 1e-7 || low < -m.step_down - 1e-7 {
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
    out
}
// Clip the entire segment against every candidate support triangle. Checking the
// resulting intervals prevents even sub-sample cracks from becoming walkable.
fn support_intervals(w: &World, a: Vec3, b: Vec3) -> Vec<(f64, f64)> {
    let v = w.movement.max_vertical;
    let query = [
        a[0].min(b[0]),
        a[1].min(b[1]) - v,
        a[2].min(b[2]),
        a[0].max(b[0]),
        a[1].max(b[1]) + v,
        a[2].max(b[2]),
    ];
    let mut out = vec![];
    for id in w.support.candidates(query) {
        let t = w.support.faces[id];
        let mut lo: f64 = 0.;
        let mut hi: f64 = 1.;
        let mut good = true;
        for i in 0..3 {
            let p = t[i];
            let q = t[(i + 1) % 3];
            let side = |x: Vec3| -(q[0] - p[0]) * (x[2] - p[2]) + (q[2] - p[2]) * (x[0] - p[0]);
            let x = side(a) + 1e-12;
            let y = side(b) + 1e-12;
            if x < 0. && y < 0. {
                good = false;
                break;
            }
            if (x >= 0.) != (y >= 0.) {
                let cut = x / (x - y);
                if x < 0. {
                    lo = lo.max(cut)
                } else {
                    hi = hi.min(cut)
                }
            }
        }
        if good && lo <= hi {
            out.push((lo, hi));
        }
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}
pub(super) fn direct(w: &World, a: Vec3, b: Vec3) -> Result<Option<Vec<Vec3>>, String> {
    if !finite(a) || !finite(b) {
        return Err("Invalid ground path".into());
    }
    let intervals = support_intervals(w, a, b);
    let mut end = 0.;
    let mut cuts = vec![0., 1.];
    for (lo, hi) in intervals {
        if lo > end + 1e-9 {
            return Ok(None);
        }
        end = end.max(hi);
        cuts.extend([lo, hi]);
    }
    if end < 1. - 1e-9 {
        return Ok(None);
    }
    let span = distance(a, b);
    let n = (span / 0.15).ceil() as usize;
    if n > 100_000 {
        return Err("Ground path exceeds validation budget".into());
    }
    for i in 1..n {
        cuts.push(i as f64 / n as f64)
    }
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
    let mut out: Vec<Vec3> = vec![];
    for t in cuts {
        let seed = mix(a, b, t);
        let hits = w.project_with_tolerance(seed, w.movement.max_vertical, None)?;
        let Some(hit) = hits.first() else {
            return Ok(None);
        };
        let mut p = hit.position;
        p[1] += 0.01;
        if let Some(&previous) = out.last() {
            let delta = p[1] - previous[1];
            if delta
                > w.movement.step_up
                    + distance(previous, p) * w.movement.max_slope.to_radians().tan()
                    + 1e-7
                || delta
                    < -w.movement.step_down
                        - distance(previous, p) * w.movement.max_slope.to_radians().tan()
                        - 1e-7
                || !w.clear(previous, p, 0.)?
            {
                return Ok(None);
            }
        } else if !w.clear(p, p, 0.)? {
            return Ok(None);
        }
        out.push(p);
    }
    Ok(Some(out))
}
#[derive(Clone)]
struct Label(f64, usize);
impl PartialEq for Label {
    fn eq(&self, o: &Self) -> bool {
        self.0 == o.0 && self.1 == o.1
    }
}
impl Eq for Label {}
impl PartialOrd for Label {
    fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for Label {
    fn cmp(&self, o: &Self) -> std::cmp::Ordering {
        o.0.total_cmp(&self.0).then_with(|| o.1.cmp(&self.1))
    }
}
pub(super) fn path(w: &World, a: Vec3, b: Vec3) -> Result<Option<GroundPath>, String> {
    let make = |points: Vec<Vec3>| {
        let length = path_length(&points);
        GroundPath {
            cost: length / w.movement.speed,
            length,
            points,
        }
    };
    if let Some(p) = direct(w, a, b)? {
        return Ok(Some(make(p)));
    }
    let starts = w.project(a, None)?;
    let goals = w.project(b, None)?;
    if starts.is_empty() || goals.is_empty() {
        return Ok(None);
    }
    let mut points = vec![a, b];
    let mut owners: Vec<String> = vec![starts[0].surface.clone(), goals[0].surface.clone()];
    let mut edges: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for p in &w.portals {
        let i = points.len();
        points.extend(p.points);
        owners.extend([p.from.clone(), p.to.clone()]);
        edges.entry(i).or_default().push(i + 1);
    }
    let mut by_surface: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, s) in owners.iter().enumerate() {
        by_surface.entry(s.as_str()).or_default().push(i);
    }
    for ids in by_surface.values() {
        for &i in ids {
            for &j in ids {
                if i != j {
                    edges.entry(i).or_default().push(j);
                }
            }
        }
    }
    let mut costs = vec![f64::INFINITY; points.len()];
    let mut prev: Vec<Option<(usize, Vec<Vec3>)>> = vec![None; points.len()];
    let mut queue = BinaryHeap::new();
    costs[0] = 0.;
    queue.push(Label(0., 0));
    while let Some(Label(cost, i)) = queue.pop() {
        if cost > costs[i] {
            continue;
        }
        if i == 1 {
            let mut chunks = vec![];
            let mut at = 1;
            while at != 0 {
                let Some((p, path)) = prev[at].clone() else {
                    return Ok(None);
                };
                chunks.push(path);
                at = p;
            }
            chunks.reverse();
            let mut result = vec![];
            for chunk in chunks {
                for p in chunk {
                    if result.last() != Some(&p) {
                        result.push(p)
                    }
                }
            }
            return Ok(Some(make(result)));
        }
        for &j in edges.get(&i).into_iter().flatten() {
            let optimistic = cost + distance(points[i], points[j]);
            if optimistic >= costs[j] {
                continue;
            }
            if let Some(path) = direct(w, points[i], points[j])? {
                let next = cost + path_length(&path);
                if next < costs[j] {
                    costs[j] = next;
                    prev[j] = Some((i, path));
                    queue.push(Label(next, j));
                }
            }
        }
    }
    Ok(None)
}
