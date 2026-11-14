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
pub(super) fn closest_on_surface(surface: &Surface, p: Vec3) -> Option<Vec3> {
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
                        .any(|&y| y > m.step_up + 1e-7 || y < -m.step_down - 1e-7)
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
// Clip the entire segment against every candidate support triangle. Checking the
// resulting intervals prevents even sub-sample cracks from becoming walkable.
fn support_intervals(w: &World, a: Vec3, b: Vec3) -> Vec<(f64, f64, usize)> {
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
            out.push((lo, hi, w.owners[id]));
        }
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    out
}
// Navigation authorizes directed passage; physical inputs additionally need
// continuous centerline support from raw terrain or eligible device roofs.
// Capsule-radius support alone can bridge a crack with no surface underfoot.
fn physical_support(w: &World, a: Vec3, b: Vec3) -> bool {
    if w.snapshot["kind"] != "physical" {
        return true;
    }
    let tolerance =
        (number(&w.snapshot["input"]["ground"]["build"], "cellHeight", 0.1) * 3. + 0.01).max(0.02);
    let query = [
        a[0].min(b[0]),
        a[1].min(b[1]) - tolerance,
        a[2].min(b[2]),
        a[0].max(b[0]),
        a[1].max(b[1]) + tolerance,
        a[2].max(b[2]),
    ];
    let mut intervals = vec![];
    for index in [&w.collision, &w.moving_support] {
        for id in index.candidates(query) {
            let t = index.faces[id];
            let u = sub(t[1], t[0]);
            let v = sub(t[2], t[0]);
            let normal = cross(u, v);
            if normal[1] <= 0.
                || normal[1] / hypot(normal) < w.movement.max_slope.to_radians().cos()
            {
                continue;
            }
            let determinant = u[0] * v[2] - u[2] * v[0];
            if determinant.abs() < 1e-12 {
                continue;
            }
            let weights = |p: Vec3| {
                let x = p[0] - t[0][0];
                let z = p[2] - t[0][2];
                let b = (x * v[2] - z * v[0]) / determinant;
                let c = (u[0] * z - u[2] * x) / determinant;
                [1. - b - c, b, c]
            };
            let first = weights(a);
            let last = weights(b);
            let mut near: f64 = 0.;
            let mut far: f64 = 1.;
            let mut clip = |x: f64, y: f64| {
                if x < 0. && y < 0. {
                    far = -1.;
                } else {
                    if x < 0. {
                        near = near.max(x / (x - y));
                    }
                    if y < 0. {
                        far = far.min(x / (x - y));
                    }
                }
            };
            for i in 0..3 {
                clip(first[i] + 1e-9, last[i] + 1e-9);
            }
            let low = a[1] - (0..3).map(|i| first[i] * t[i][1]).sum::<f64>();
            let high = b[1] - (0..3).map(|i| last[i] * t[i][1]).sum::<f64>();
            clip(tolerance - low, tolerance - high);
            clip(tolerance + low, tolerance + high);
            if near <= far {
                intervals.push((near, far));
            }
        }
    }
    intervals.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut end: f64 = 0.;
    for (near, far) in intervals {
        if near > end + 1e-8 {
            return false;
        }
        end = end.max(far);
        if end >= 1. - 1e-8 {
            return true;
        }
    }
    false
}
fn crossing(a: Vec3, b: Vec3, aperture: [Vec3; 2]) -> Option<(f64, f64)> {
    let cross = |x: [f64; 2], y: [f64; 2]| x[0] * y[1] - x[1] * y[0];
    let r = [b[0] - a[0], b[2] - a[2]];
    let s = [
        aperture[1][0] - aperture[0][0],
        aperture[1][2] - aperture[0][2],
    ];
    let q = [aperture[0][0] - a[0], aperture[0][2] - a[2]];
    let length = r[0] * r[0] + r[1] * r[1];
    if length < 1e-20 {
        return Some((0., 1.));
    }
    let det = cross(r, s);
    if det.abs() > 1e-12 {
        let t = cross(q, s) / det;
        let u = cross(q, r) / det;
        return ((-1e-8..=1. + 1e-8).contains(&t) && (-1e-8..=1. + 1e-8).contains(&u))
            .then_some((t.clamp(0., 1.), t.clamp(0., 1.)));
    }
    if cross(q, r).abs() > 1e-7 * length.sqrt() {
        return None;
    }
    let t = (q[0] * r[0] + q[1] * r[1]) / length;
    let u = t + (s[0] * r[0] + s[1] * r[1]) / length;
    let lo = t.min(u).max(0.);
    let hi = t.max(u).min(1.);
    (lo <= hi + 1e-9).then_some((lo, hi))
}
pub(super) fn direct(w: &World, a: Vec3, b: Vec3) -> Result<Option<Vec<Vec3>>, String> {
    if !finite(a) || !finite(b) {
        return Err("Invalid ground path".into());
    }
    let intervals = support_intervals(w, a, b);
    let mut end = 0.;
    let mut cuts = vec![0., 1.];
    for &(lo, hi, _) in &intervals {
        if lo > end + 1e-9 {
            return Ok(None);
        }
        end = end.max(hi);
        cuts.extend([lo, hi]);
    }
    if end < 1. - 1e-9 {
        return Ok(None);
    }
    // Geometric support alone cannot authorize a masked or reverse passage.
    // Propagate along the chord through the actual directed portal intervals.
    let starts = w.project(a, None)?;
    let mut entered = vec![f64::INFINITY; intervals.len()];
    let mut pending = std::collections::VecDeque::new();
    let mut by_owner: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, &(lo, _, owner)) in intervals.iter().enumerate() {
        by_owner.entry(owner).or_default().push(i);
        if lo <= 1e-9
            && starts.iter().any(|p| {
                p.surface == w.surfaces[owner].id && p.distance <= starts[0].distance + 1e-7
            })
        {
            entered[i] = 0.;
            pending.push_back(i);
        }
    }
    let mut outgoing: BTreeMap<usize, Vec<(usize, f64, f64)>> = BTreeMap::new();
    for &index in by_owner
        .keys()
        .flat_map(|&owner| w.portal_owners[owner].iter())
    {
        let portal = &w.portals[index];
        let from = w.surface_ids[&portal.from];
        let to = w.surface_ids[&portal.to];
        if !by_owner.contains_key(&from) || !by_owner.contains_key(&to) {
            continue;
        }
        let entry = portal.entry.unwrap_or([portal.points[0]; 2]);
        let exit = portal.exit.unwrap_or([portal.points[1]; 2]);
        if let (Some((lo, hi)), Some((x, y))) = (crossing(a, b, entry), crossing(a, b, exit)) {
            let low = lo.max(x);
            let high = hi.min(y);
            if low <= high + 1e-8 {
                outgoing.entry(from).or_default().push((to, low, high));
            }
        }
    }
    while let Some(i) = pending.pop_front() {
        let (_, end, owner) = intervals[i];
        let mut successors = vec![(owner, entered[i], end)];
        successors.extend(outgoing.get(&owner).into_iter().flatten().copied());
        for (to, low, high) in successors {
            for &j in by_owner.get(&to).into_iter().flatten() {
                let t = entered[i].max(intervals[j].0).max(low);
                if t <= end.min(intervals[j].1).min(high) + 1e-8 && t < entered[j] - 1e-10 {
                    entered[j] = t;
                    pending.push_back(j);
                }
            }
        }
    }
    if !intervals
        .iter()
        .enumerate()
        .any(|(i, p)| entered[i].is_finite() && p.1 >= 1. - 1e-9)
    {
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
        let Some(hit) = hits.iter().find(|hit| {
            let owner = w.surface_ids[&hit.surface];
            by_owner
                .get(&owner)
                .into_iter()
                .flatten()
                .any(|&i| entered[i] <= t + 1e-8 && intervals[i].1 >= t - 1e-8)
        }) else {
            return Ok(None);
        };
        let Some((ground, mesh_support)) = w.ground_support(
            hit.position,
            w.movement.max_vertical,
            w.movement.max_vertical,
            w.movement.profile.radius,
        )?
        else {
            return Ok(None);
        };
        let mut p = ground.position;
        p[1] = standing_height(seed[1], p[1], mesh_support);
        // Support projection may introduce roundoff in XZ. Keep already valid
        // supplied endpoints exact so walking joins retain their witnesses.
        if t == 0. && distance(p, a) <= 1e-6 {
            p = a;
        } else if t == 1. && distance(p, b) <= 1e-6 {
            p = b;
        }
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
    // Ground samples are proposals until their interpolated chords replay on
    // raw capsule support. Rounded triangle edges can bend the supported feet
    // between two valid endpoints; retain those bends before computing cost.
    let mut refined = vec![out[0]];
    let mut budget = 100_000;
    for pair in out.windows(2) {
        if !refine_supported_chord(w, pair[0], pair[1], 0, &mut budget, &mut refined)? {
            return Ok(None);
        }
    }
    Ok(Some(refined))
}
// A triangle rounded by a sphere is convex; its upper support height is
// concave over XZ. One face supporting both endpoints within the upper
// clearance bound therefore supports the entire chord within that bound.
// The lowered sphere sweep proves the complementary lower bound for all faces.
fn stable_clearance(w: &World, a: Vec3, b: Vec3) -> bool {
    if w.snapshot["kind"] != "physical" {
        return true;
    }
    let radius = w.movement.profile.radius;
    let tolerance =
        (number(&w.snapshot["input"]["ground"]["build"], "cellHeight", 0.1) * 3. + 0.01).max(0.02);
    let low = 0.005 - 0.5e-6;
    let high = 0.01 + 0.5e-6;
    let center = |p: Vec3| [p[0], p[1] + radius - low, p[2]];
    let query = [
        a[0].min(b[0]) - radius,
        a[1].min(b[1]) - tolerance - radius,
        a[2].min(b[2]) - radius,
        a[0].max(b[0]) + radius,
        a[1].max(b[1]) + tolerance + radius,
        a[2].max(b[2]) + radius,
    ];
    let mut upper = false;
    for index in [&w.collision, &w.moving_support] {
        for id in index.candidates(query) {
            let face = index.faces[id];
            let normal = cross(sub(face[1], face[0]), sub(face[2], face[0]));
            let length = hypot(normal);
            if normal[1] <= 0. || normal[1] / length < w.movement.max_slope.to_radians().cos() {
                continue;
            }
            let normal = normal.map(|v| v / length);
            let ha = collision::sphere_support(a, face, normal, radius);
            let hb = collision::sphere_support(b, face, normal, radius);
            // Phase-free roofs outside the ground query's upper range are
            // support alternatives, not solids. Concavity proves this face
            // stays outside that range for the entire chord.
            if ha > a[1] + tolerance && hb > b[1] + tolerance {
                continue;
            }
            if collision::segment_triangle(center(a), center(b), face) <= radius * radius {
                return false;
            }
            let ca = a[1] - ha;
            let cb = b[1] - hb;
            upper |= (low..=high).contains(&ca) && (low..=high).contains(&cb);
        }
    }
    upper
}
fn replay_foot(w: &World, p: Vec3) -> Result<Option<Vec3>, String> {
    let Some((ground, mesh_support)) = w.ground_support(
        p,
        w.movement.max_vertical,
        w.movement.max_vertical,
        w.movement.profile.radius,
    )?
    else {
        return Ok(None);
    };
    let mut foot = ground.position;
    let clearance = p[1] - foot[1];
    foot[1] = if (mesh_support && clearance.abs() <= 1e-6)
        || (0.005 - 1e-6..=0.01 + 1e-6).contains(&clearance)
    {
        p[1]
    } else {
        foot[1] + 0.005
    };
    Ok(w.clear(foot, foot, 0.)?.then_some(foot))
}
fn refine_supported_chord(
    w: &World,
    a: Vec3,
    b: Vec3,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<Vec3>,
) -> Result<bool, String> {
    // Match the independent standing trace's sampling density. Refinement is
    // bounded; exhaustion rejects this proposal rather than returning an
    // unverified chord. Every accepted pair is swept with its actual feet.
    if depth >= 16 || *budget == 0 {
        return Ok(false);
    }
    let step = (w.movement.profile.radius / 4.).max(0.025) * 0.9;
    let count = (distance(a, b) / step).ceil().max(1.) as usize;
    if count > *budget {
        return Ok(false);
    }
    *budget -= count;
    if depth == 0 {
        for endpoint in [a, b] {
            let Some(foot) = replay_foot(w, endpoint)? else {
                return Ok(false);
            };
            if distance(foot, endpoint) > 1e-5 {
                return Ok(false);
            }
        }
    }
    if count == 1 {
        if !physical_support(w, a, b) || !w.clear(a, b, 0.)? {
            return Ok(false);
        }
        if stable_clearance(w, a, b) {
            out.push(b);
            return Ok(true);
        }
        let seed = mix(a, b, 0.5);
        let Some(mut foot) = replay_foot(w, seed)? else {
            return Ok(false);
        };
        if w.snapshot["kind"] == "physical" {
            let Some(hit) = w.ground_at(
                seed,
                w.movement.max_vertical,
                w.movement.max_vertical,
                w.movement.profile.radius,
            )?
            else {
                return Ok(false);
            };
            foot[1] = hit.position[1] + 0.0075;
            if !w.clear(foot, foot, 0.)? {
                return Ok(false);
            }
        }
        return Ok(refine_supported_chord(w, a, foot, depth + 1, budget, out)?
            && refine_supported_chord(w, foot, b, depth + 1, budget, out)?);
    }
    let mut trace = vec![a];
    for i in 1..count {
        let seed = mix(a, b, i as f64 / count as f64);
        let Some(foot) = replay_foot(w, seed)? else {
            return Ok(false);
        };
        trace.push(foot);
    }
    trace.push(b);
    // Canonicalization can increase 3D span length, so subdivision is checked
    // again on actual feet rather than assuming planar spacing is sufficient.
    for pair in trace.windows(2) {
        if !refine_supported_chord(w, pair[0], pair[1], depth + 1, budget, out)? {
            return Ok(false);
        }
    }
    Ok(true)
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
fn detour_points(w: &World, a: Vec3, b: Vec3) -> Result<Vec<Projection>, String> {
    let radius = w.movement.profile.radius + 0.02;
    let margin = distance(a, b).max(4.);
    let low = [a[0].min(b[0]) - margin, a[2].min(b[2]) - margin];
    let high = [a[0].max(b[0]) + margin, a[2].max(b[2]) + margin];
    let mut seeds = vec![];
    let mut around = |x: f64, z: f64| {
        for dx in [-radius, 0., radius] {
            for dz in [-radius, 0., radius] {
                if dx != 0. || dz != 0. {
                    seeds.push([x + dx, a[1], z + dz]);
                }
            }
        }
    };
    let query = [
        low[0],
        a[1].min(b[1]) - w.movement.max_vertical,
        low[1],
        high[0],
        a[1].max(b[1]) + w.movement.profile.height,
        high[1],
    ];
    for id in w.collision.candidates(query) {
        let triangle = w.collision.faces[id];
        let normal = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
        if normal[1].abs() >= hypot(normal) * w.movement.max_slope.to_radians().cos() {
            continue;
        }
        for p in triangle {
            if p[0] >= low[0] && p[0] <= high[0] && p[2] >= low[1] && p[2] <= high[1] {
                around(p[0], p[2]);
            }
        }
    }
    for wall in &w.walls {
        if wall.state == "inactive" {
            continue;
        }
        if let Some(ring) = wall.polygon.as_ref().or(wall.points.as_ref()) {
            for p in ring {
                around(p[0], p[1]);
            }
        } else if wall.sphere.is_none() {
            for x in [wall.min[0] - wall.padding, wall.max[0] + wall.padding] {
                for z in [wall.min[2] - wall.padding, wall.max[2] + wall.padding] {
                    around(x, z);
                }
            }
        }
    }
    for wall in &w.walls {
        if wall.state == "inactive" {
            continue;
        }
        if let Some(sphere) = &wall.sphere {
            let r = (sphere.radius + wall.padding + radius) / (std::f64::consts::PI / 16.).cos();
            for i in 0..16 {
                let angle = i as f64 * std::f64::consts::TAU / 16.;
                seeds.push([
                    sphere.center[0] + r * angle.cos(),
                    a[1],
                    sphere.center[2] + r * angle.sin(),
                ]);
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut out = vec![];
    for seed in seeds {
        if seed[0] < low[0] || seed[0] > high[0] || seed[2] < low[1] || seed[2] > high[1] {
            continue;
        }
        let key = (
            (seed[0] * 1e6).round() as i64,
            (seed[2] * 1e6).round() as i64,
        );
        if !seen.insert(key) {
            continue;
        }
        if !w.in_coverage(seed, w.movement.profile.radius) {
            continue;
        }
        let Some(foot) = w.standing_foot(seed)? else {
            continue;
        };
        for mut projection in w.project(foot, None)? {
            projection.position = foot;
            out.push(projection);
        }
        // Visibility vertices are proposals; every selected chord still needs
        // support, directed passage and a full capsule sweep. This finite set
        // is not a certificate that an unavailable route is impossible.
        if out.len() >= 512 {
            break;
        }
    }
    Ok(out)
}
#[derive(Clone, Debug)]
pub(super) struct Graph {
    points: Vec<Vec3>,
    owners: Vec<usize>,
    by_surface: Vec<Vec<usize>>,
    proofs: std::sync::Arc<std::sync::Mutex<Proofs>>,
}
// Frontier expansion needs a scalar cost; replay points are shared only when
// a selected path needs them. Repeated repairs never copy whole proof traces.
#[derive(Clone, Debug)]
struct Proof {
    path: Option<std::sync::Arc<Vec<Vec3>>>,
    length: f64,
}
impl Proof {
    fn new(path: Option<Vec<Vec3>>) -> Self {
        let length = path
            .as_ref()
            .map_or(f64::INFINITY, |points| path_length(points));
        Self {
            path: path.map(std::sync::Arc::new),
            length,
        }
    }
}
type Proofs = BTreeMap<(usize, usize), Proof>;
impl Graph {
    fn new(w: &World) -> Self {
        let mut points = vec![];
        let mut owners = vec![];
        let mut by_surface = vec![vec![]; w.surfaces.len()];
        for portal in &w.portals {
            // Only materialize representatives whose full standing footprint is
            // loaded. Coverage is eligibility, never a substitute for a proof.
            if portal
                .points
                .iter()
                .any(|&point| !w.in_coverage(point, w.movement.profile.radius))
            {
                continue;
            }
            for (point, owner) in [
                (portal.points[0], w.surface_ids[&portal.from]),
                (portal.points[1], w.surface_ids[&portal.to]),
            ] {
                by_surface[owner].push(points.len());
                points.push(point);
                owners.push(owner);
            }
        }
        Self {
            points,
            owners,
            by_surface,
            proofs: Default::default(),
        }
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
    let starts = w.project(a, None)?;
    let goals = w.project(b, None)?;
    if starts.is_empty() || goals.is_empty() {
        return Ok(None);
    }
    let from = w.surface_ids[&starts[0].surface];
    let to = w.surface_ids[&goals[0].surface];
    // Connectivity only rejects disconnected support; it never certifies a
    // route, substitutes for directed passage, or skips collision validation.
    if w.components[from] != w.components[to] {
        return Ok(None);
    }
    if let Some(points) = direct(w, a, b)? {
        return Ok(Some(make(points)));
    }
    let graph = w.ground_graph.get_or_init(|| Graph::new(w));
    if let Some(points) = search_ground(w, graph, a, b, from, to, &[])? {
        return Ok(Some(make(points)));
    }
    let proposals = detour_points(w, a, b)?;
    Ok(search_ground(w, graph, a, b, from, to, &proposals)?.map(make))
}

#[allow(clippy::too_many_arguments)]
fn search_ground(
    w: &World,
    graph: &Graph,
    a: Vec3,
    b: Vec3,
    from: usize,
    to: usize,
    detours: &[Projection],
) -> Result<Option<Vec<Vec3>>, String> {
    use std::collections::HashMap;
    let base = graph.points.len();
    let mut local = vec![a, b];
    let mut local_owners = vec![from, to];
    for p in detours {
        local.push(p.position);
        local_owners.push(w.surface_ids[&p.surface]);
    }
    let point = |i: usize| {
        if i < base {
            graph.points[i]
        } else {
            local[i - base]
        }
    };
    let owner = |i: usize| {
        if i < base {
            graph.owners[i]
        } else {
            local_owners[i - base]
        }
    };
    let heuristic = |i: usize| {
        let p = point(i);
        (p[0] - b[0]).hypot(p[2] - b[2])
    };
    let mut locals: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, &surface) in local_owners.iter().enumerate() {
        locals.entry(surface).or_default().push(base + i);
    }
    let mut proofs: HashMap<(usize, usize), Proof> = HashMap::new();
    // Node IDs are dense and stable throughout repairs. Generations avoid
    // clearing the global arrays or rebuilding hash tables for each search.
    let count = base + local.len();
    let mut costs = vec![0.; count];
    let mut previous = vec![usize::MAX; count];
    let mut generations = vec![0_u16; count];
    // Optimistic topology chooses a path before expensive support/capsule replay.
    // Failed chords reject that witness only; an exhausted repair budget leaves
    // this finite ground proposal unresolved, not physically impossible.
    for generation in 1..=512 {
        let mut pending = BinaryHeap::new();
        costs[base] = 0.;
        generations[base] = generation;
        pending.push(Label(heuristic(base), base));
        let mut reached = false;
        while let Some(Label(priority, i)) = pending.pop() {
            let cost = costs[i];
            if priority > cost + heuristic(i) + 1e-9 {
                continue;
            }
            if i == base + 1 {
                reached = true;
                break;
            }
            let mut successors = graph.by_surface[owner(i)].clone();
            successors.extend(locals.get(&owner(i)).into_iter().flatten().copied());
            if i < base && i % 2 == 0 {
                successors.push(i + 1);
            }
            if i >= base && !detours.is_empty() {
                successors.extend(base..base + local.len());
            }
            successors.sort_unstable();
            successors.dedup();
            for j in successors {
                if i == j {
                    continue;
                }
                let key = (i, j);
                if !proofs.contains_key(&key)
                    && i < base
                    && j < base
                    && let Some(proof) = graph
                        .proofs
                        .lock()
                        .map_err(|_| "Ground proof cache poisoned")?
                        .get(&key)
                        .cloned()
                {
                    proofs.insert(key, proof);
                }
                let length = match proofs.get(&key) {
                    Some(proof) if proof.path.is_none() => continue,
                    Some(proof) => proof.length,
                    None => (point(i)[0] - point(j)[0]).hypot(point(i)[2] - point(j)[2]),
                };
                let next = cost + length;
                if generations[j] != generation || next < costs[j] {
                    generations[j] = generation;
                    costs[j] = next;
                    previous[j] = i;
                    pending.push(Label(next + heuristic(j), j));
                }
            }
        }
        if !reached {
            return Ok(None);
        }
        let mut nodes = vec![base + 1];
        while *nodes.last().unwrap() != base {
            let parent = previous[*nodes.last().unwrap()];
            if parent == usize::MAX {
                return Err("Broken ground frontier".into());
            }
            nodes.push(parent);
        }
        nodes.reverse();
        let mut points = vec![];
        let mut actual_cost = 0.;
        let mut rejected = false;
        for pair in nodes.windows(2) {
            let key = (pair[0], pair[1]);
            if let std::collections::hash_map::Entry::Vacant(entry) = proofs.entry(key) {
                let proof = Proof::new(direct(w, point(pair[0]), point(pair[1]))?);
                if pair[0] < base && pair[1] < base {
                    let mut cache = graph
                        .proofs
                        .lock()
                        .map_err(|_| "Ground proof cache poisoned")?;
                    if cache.len() < 65_536 {
                        cache.insert(key, proof.clone());
                    }
                }
                entry.insert(proof);
            }
            let Some(path) = proofs[&key].path.as_ref() else {
                rejected = true;
                continue;
            };
            actual_cost += proofs[&key].length;
            for &p in path.iter() {
                if points.last() != Some(&p) {
                    points.push(p);
                }
            }
        }
        // Validate every selected chord before repairing topology. Otherwise
        // each obstructed chord restarts the same global search while leaving
        // later failures on that path unknown. No rejected path is returned.
        if rejected {
            continue;
        }
        // Successful replay can increase an optimistic horizontal edge length.
        // Repair those costs as well: a collision-free path is eligible to return
        // only after the optimistic frontier agrees with its verified cost.
        let lower = costs[base + 1];
        if actual_cost > lower + 1e-9 * lower.abs().max(1.) {
            continue;
        }
        // Collapse tessellation turns only after tracing the replacement chords.
        let mut simplified = vec![points[0]];
        let mut at = 0;
        while at + 1 < points.len() {
            let mut end = points.len() - 1;
            let mut trace = None;
            while end > at + 1 {
                if let Some(path) = direct(w, points[at], points[end])? {
                    trace = Some(path);
                    break;
                }
                end = (at + end) / 2;
            }
            if let Some(path) = trace {
                simplified.extend(path.into_iter().skip(1));
            } else {
                end = at + 1;
                simplified.push(points[end]);
            }
            at = end;
        }
        return Ok(Some(simplified));
    }
    Ok(None)
}
