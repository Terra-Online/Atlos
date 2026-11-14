use super::collision::mix;
use super::*;
use std::collections::{BTreeMap, BinaryHeap};
struct NavWork {
    remaining: usize,
    used: usize,
    exhausted: bool,
}
fn nav_charge(work: &mut Option<NavWork>) -> bool {
    let Some(work) = work else {
        return true;
    };
    if work.remaining == 0 {
        work.exhausted = true;
        return false;
    }
    work.remaining -= 1;
    work.used += 1;
    true
}
// Clip the entire segment against every candidate support triangle. Checking the
// resulting intervals prevents even sub-sample cracks from becoming walkable.
fn support_intervals(
    w: &World,
    a: Vec3,
    b: Vec3,
    height_clip: bool,
    work: &mut Option<NavWork>,
) -> Option<Vec<(f64, f64, usize)>> {
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
        if !nav_charge(work) {
            return None;
        }
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
        if good && height_clip {
            let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
            let offset = |p: Vec3| {
                p[1] - t[0][1] + (n[0] * (p[0] - t[0][0]) + n[2] * (p[2] - t[0][2])) / n[1]
            };
            let first = offset(a);
            let last = offset(b);
            for (x, y) in [(v - first, v - last), (v + first, v + last)] {
                if x < 0. && y < 0. {
                    good = false;
                    break;
                }
                if x < 0. {
                    lo = lo.max(x / (x - y));
                }
                if y < 0. {
                    hi = hi.min(x / (x - y));
                }
            }
        }
        if good && lo <= hi {
            out.push((lo, hi, w.owners[id]));
        }
    }
    out.sort_by(|a, b| a.0.total_cmp(&b.0));
    Some(out)
}
// Navigation authorizes directed passage; physical inputs additionally need
// continuous capsule support from raw terrain or eligible device roofs.
fn physical_support(w: &World, a: Vec3, b: Vec3) -> bool {
    if w.snapshot["kind"] != "physical" {
        return true;
    }
    let tolerance =
        (number(&w.snapshot["input"]["ground"]["build"], "cellHeight", 0.1) * 3. + 0.01).max(0.02);
    let radius = w.movement.profile.radius;
    let query = [
        a[0].min(b[0]) - radius,
        a[1].min(b[1]) - tolerance,
        a[2].min(b[2]) - radius,
        a[0].max(b[0]) + radius,
        a[1].max(b[1]) + 2. * radius + tolerance,
        a[2].max(b[2]) + radius,
    ];
    let mut intervals = Vec::new();
    for index in [&w.collision, &w.moving_support] {
        for id in index.candidates(query) {
            let face = index.faces[id];
            let normal = index.normal(id);
            if normal[1] < w.movement.max_slope.to_radians().cos() {
                continue;
            }
            super::support::intervals(a, b, face, normal, radius, tolerance, &mut intervals);
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
struct Permission {
    cuts: Vec<f64>,
    intervals: Vec<(f64, f64, usize)>,
    entered: Vec<f64>,
    by_owner: BTreeMap<usize, Vec<usize>>,
}
// The direct physical proof and proposal visibility share directed authorization.
// Visibility also clips every admitted interval by affine navigation height;
// it must not erase a height-changing turn before physical probes inspect it.
fn navigation_permission(
    w: &World,
    a: Vec3,
    b: Vec3,
    height_clip: bool,
    work: &mut Option<NavWork>,
) -> Result<Option<Permission>, String> {
    let Some(intervals) = support_intervals(w, a, b, height_clip, work) else {
        return Ok(None);
    };
    let mut end = 0.;
    let mut cuts = vec![0., 1.];
    for &(lo, hi, _) in &intervals {
        if !nav_charge(work) {
            return Ok(None);
        }
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
        if !nav_charge(work) {
            return Ok(None);
        }
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
        if !nav_charge(work) {
            return Ok(None);
        }
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
        if !nav_charge(work) {
            return Ok(None);
        }
        let (_, end, owner) = intervals[i];
        let mut successors = vec![(owner, entered[i], end)];
        successors.extend(outgoing.get(&owner).into_iter().flatten().copied());
        for (to, low, high) in successors {
            for &j in by_owner.get(&to).into_iter().flatten() {
                if !nav_charge(work) {
                    return Ok(None);
                }
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
    Ok(Some(Permission {
        cuts,
        intervals,
        entered,
        by_owner,
    }))
}
pub(super) fn probe(w: &World, a: Vec3, b: Vec3) -> Result<GroundProbe, String> {
    let mut failure = GroundFailure::Navigation;
    match direct_with_failure(w, a, b, &mut failure) {
        Ok(Some(points)) => {
            let length = path_length(&points);
            Ok(GroundProbe::Supported(GroundPath {
                points,
                length,
                cost: length / w.movement.speed,
            }))
        }
        Ok(None) => {
            // When both proposals fail, retain the missing NAV chord as the
            // feedback cause so discovery follows its directed detour first.
            if navigation_permission(w, a, b, false, &mut None)?.is_none() {
                failure = GroundFailure::Navigation;
            }
            Ok(GroundProbe::Rejected(failure))
        }
        Err(_) if matches!(failure, GroundFailure::ProofBudget { .. }) => {
            Ok(GroundProbe::Rejected(failure))
        }
        Err(error) => Err(error),
    }
}
pub(super) fn direct(w: &World, a: Vec3, b: Vec3) -> Result<Option<Vec<Vec3>>, String> {
    direct_with_failure(w, a, b, &mut GroundFailure::Navigation)
}
fn direct_with_failure(
    w: &World,
    a: Vec3,
    b: Vec3,
    failure: &mut GroundFailure,
) -> Result<Option<Vec<Vec3>>, String> {
    if !finite(a) || !finite(b) {
        return Err("Invalid ground path".into());
    }
    let permission = navigation_permission(w, a, b, false, &mut None)?;
    if permission.is_none() {
        if w.snapshot["kind"] != "physical" {
            return Ok(None);
        }
        let Some(intervals) = support_intervals(w, a, b, false, &mut None) else {
            return Ok(None);
        };
        if intervals
            .iter()
            .any(|(_, _, owner)| w.authored_navigation.contains(owner))
        {
            return Ok(None);
        }
    }
    // Imported navigation is a proposal in physical worlds. Missing mesh
    // connectivity cannot reject a walk that raw support and capsule replay
    // prove. Explicit masks/portals and surface-only inputs remain authoritative.
    let mut cuts = permission
        .as_ref()
        .map_or_else(|| vec![0., 1.], |p| p.cuts.clone());
    let span = distance(a, b);
    let n = (span / 0.15).ceil() as usize;
    if n > 100_000 {
        *failure = GroundFailure::ProofBudget { span: [a, b] };
        return Err("Ground path exceeds validation budget".into());
    }
    for i in 1..n {
        cuts.push(i as f64 / n as f64)
    }
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-10);
    // A nearby portal cut can sort before 1 and absorb that exact endpoint.
    // Preserve supplied feet at both ends before joining independent proofs.
    cuts[0] = 0.;
    *cuts.last_mut().unwrap() = 1.;
    let mut out: Vec<Vec3> = vec![];
    for t in cuts {
        let seed = mix(a, b, t);
        let support_seed = if let Some(permission) = &permission {
            let hits = w.project_with_tolerance(seed, w.movement.max_vertical, None)?;
            let Some(hit) = hits.iter().find(|hit| {
                let owner = w.surface_ids[&hit.surface];
                permission
                    .by_owner
                    .get(&owner)
                    .into_iter()
                    .flatten()
                    .any(|&i| {
                        permission.entered[i] <= t + 1e-8 && permission.intervals[i].1 >= t - 1e-8
                    })
            }) else {
                return Ok(None);
            };
            hit.position
        } else {
            seed
        };
        let Some((ground, mesh_support)) = w.ground_support(
            support_seed,
            w.movement.max_vertical,
            w.movement.max_vertical,
            w.movement.profile.radius,
        )?
        else {
            *failure = GroundFailure::PhysicalSupport {
                span: [out.last().copied().unwrap_or(seed), seed],
            };
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
                || !w.walk_clear(previous, p)?
            {
                *failure = GroundFailure::Clearance {
                    span: [previous, p],
                };
                return Ok(None);
            }
        } else if !w.walk_clear(p, p)? {
            *failure = GroundFailure::Clearance { span: [p, p] };
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
        if !refine_supported_chord(w, pair[0], pair[1], 0, &mut budget, &mut refined, failure)? {
            return Ok(None);
        }
    }
    compact(&mut refined);
    Ok(Some(refined))
}
// Proof sampling is not route representation. Remove collinear proof knots
// before caching/compiling resource clocks: the geometric path is unchanged,
// while flat walking no longer carries one allocation/phase per few centimetres.
fn compact(points: &mut Vec<Vec3>) {
    let mut length = 0;
    for read in 0..points.len() {
        let point = points[read];
        while length >= 2 {
            let first = sub(points[length - 1], points[length - 2]);
            let second = sub(point, points[length - 1]);
            let normal = cross(first, second);
            if collision::dot(first, second) < 0.
                || collision::dot(normal, normal)
                    > 1e-20 * collision::dot(first, first) * collision::dot(second, second)
            {
                break;
            }
            length -= 1;
        }
        points[length] = point;
        length += 1;
    }
    points.truncate(length);
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
    // The walking representation may approximate a rounded support face by
    // a chord. Keep it clear and within 2 cm of support, below the independent
    // verifier's 2.5 cm walking allowance; artificial 5 mm lift is not physics.
    let low = 0.;
    let high = 0.02;
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
            let normal = index.normal(id);
            if normal[1] < w.movement.max_slope.to_radians().cos() {
                continue;
            }
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
fn replay_foot(w: &World, p: Vec3, failure: &mut GroundFailure) -> Result<Option<Vec3>, String> {
    let Some((ground, mesh_support)) = w.ground_support(
        p,
        w.movement.max_vertical,
        w.movement.max_vertical,
        w.movement.profile.radius,
    )?
    else {
        *failure = GroundFailure::PhysicalSupport { span: [p, p] };
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
    if !w.walk_clear(foot, foot)? {
        *failure = GroundFailure::Clearance { span: [p, foot] };
        return Ok(None);
    }
    Ok(Some(foot))
}
fn refine_supported_chord(
    w: &World,
    a: Vec3,
    b: Vec3,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<Vec3>,
    failure: &mut GroundFailure,
) -> Result<bool, String> {
    // Match the independent standing trace's sampling density. Refinement is
    // bounded; exhaustion rejects this proposal rather than returning an
    // unverified chord. Every accepted pair is swept with its actual feet.
    if depth >= 16 || *budget == 0 {
        *failure = GroundFailure::ProofBudget { span: [a, b] };
        return Ok(false);
    }
    let step = (w.movement.profile.radius / 4.).max(0.025) * 0.9;
    let count = (distance(a, b) / step).ceil().max(1.) as usize;
    if count > *budget {
        *failure = GroundFailure::ProofBudget { span: [a, b] };
        return Ok(false);
    }
    *budget -= count;
    if depth == 0 {
        for endpoint in [a, b] {
            let Some(foot) = replay_foot(w, endpoint, failure)? else {
                return Ok(false);
            };
            if distance(foot, endpoint) > 1e-5 {
                *failure = GroundFailure::PhysicalSupport {
                    span: [endpoint, endpoint],
                };
                return Ok(false);
            }
        }
    }
    if count == 1 {
        if !physical_support(w, a, b) {
            *failure = GroundFailure::PhysicalSupport { span: [a, b] };
            return Ok(false);
        }
        if !w.walk_clear(a, b)? {
            *failure = GroundFailure::Clearance { span: [a, b] };
            return Ok(false);
        }
        if stable_clearance(w, a, b) {
            out.push(b);
            return Ok(true);
        }
        let seed = mix(a, b, 0.5);
        let Some(mut foot) = replay_foot(w, seed, failure)? else {
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
                *failure = GroundFailure::PhysicalSupport { span: [seed, seed] };
                return Ok(false);
            };
            foot[1] = hit.position[1] + 0.0075;
            if !w.walk_clear(foot, foot)? {
                *failure = GroundFailure::Clearance { span: [seed, foot] };
                return Ok(false);
            }
        }
        return Ok(
            refine_supported_chord(w, a, foot, depth + 1, budget, out, failure)?
                && refine_supported_chord(w, foot, b, depth + 1, budget, out, failure)?,
        );
    }
    let mut trace = vec![a];
    for i in 1..count {
        let seed = mix(a, b, i as f64 / count as f64);
        let Some(foot) = replay_foot(w, seed, failure)? else {
            return Ok(false);
        };
        trace.push(foot);
    }
    trace.push(b);
    // Canonicalization can increase 3D span length, so subdivision is checked
    // again on actual feet rather than assuming planar spacing is sufficient.
    for pair in trace.windows(2) {
        if !refine_supported_chord(w, pair[0], pair[1], depth + 1, budget, out, failure)? {
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

/// Feedback uses the existing directed portal-representative graph, but reads
/// no physical proof cache and performs exactly one optimistic A* traversal.
/// Ordinary ground search retains its independent detour/repair policy.
pub(super) fn probe_route(
    w: &World,
    a: Vec3,
    b: Vec3,
    limits: GroundRouteLimits,
) -> Result<GroundRouteProbe, String> {
    use std::collections::HashMap;
    if !finite(a) || !finite(b) {
        return Err("Invalid navigation probe endpoints".into());
    }
    let mut result = GroundRouteProbe {
        navigation: None,
        supported: None,
        failures: vec![],
        expanded: 0,
        probed: 0,
        truncated: false,
    };
    if limits.max_expansions == 0 {
        result.truncated = true;
        return Ok(result);
    }
    let starts = w.project(a, None)?;
    let goals = w.project(b, None)?;
    let (Some(start), Some(goal)) = (starts.first(), goals.first()) else {
        result.failures.push(GroundFailure::Navigation);
        return Ok(result);
    };
    let from = w.surface_ids[&start.surface];
    let to = w.surface_ids[&goal.surface];
    if w.components[from] != w.components[to] {
        result.failures.push(GroundFailure::Navigation);
        return Ok(result);
    }
    let graph = w.ground_graph.get_or_init(|| Graph::new(w));
    let base = graph.points.len();
    let point = |i: usize| {
        if i < base {
            graph.points[i]
        } else if i == base {
            a
        } else {
            b
        }
    };
    let owner = |i: usize| {
        if i < base {
            graph.owners[i]
        } else if i == base {
            from
        } else {
            to
        }
    };
    // Weighted A* is finite candidate ranking only. It deliberately trades
    // shortest-proposal guarantees for goal direction; physical proofs and
    // ordinary ground search retain their independent costs and authority.
    let heuristic = |i: usize| 2. * distance(point(i), b);
    let mut costs = HashMap::from([(base, 0.)]);
    let mut previous = HashMap::new();
    let mut pending = BinaryHeap::from([Label(heuristic(base), base)]);
    let mut reached = false;
    while let Some(Label(priority, i)) = pending.pop() {
        crate::cancel::check()?;
        let cost = costs[&i];
        if priority > cost + heuristic(i) + 1e-9 {
            continue;
        }
        if result.expanded >= limits.max_expansions {
            result.truncated = true;
            break;
        }
        result.expanded += 1;
        if i == base + 1 {
            reached = true;
            break;
        }
        let mut successors = graph.by_surface[owner(i)].clone();
        if owner(i) == from {
            successors.push(base);
        }
        if owner(i) == to {
            successors.push(base + 1);
        }
        // Only the source representative can cross this directed portal.
        if i < base && i % 2 == 0 {
            successors.push(i + 1);
        }
        successors.sort_unstable();
        successors.dedup();
        for j in successors {
            if i == j {
                continue;
            }
            let next = cost + distance(point(i), point(j));
            if costs.get(&j).is_none_or(|&old| next < old) {
                costs.insert(j, next);
                previous.insert(j, i);
                pending.push(Label(next + heuristic(j), j));
            }
        }
    }
    if !reached {
        if !result.truncated {
            result.failures.push(GroundFailure::Navigation);
        }
        return Ok(result);
    }
    let mut nodes = vec![base + 1];
    while *nodes.last().unwrap() != base {
        let Some(&parent) = previous.get(nodes.last().unwrap()) else {
            return Err("Broken navigation proposal".into());
        };
        nodes.push(parent);
        if nodes.len() > result.expanded + 1 {
            return Err("Cyclic navigation proposal".into());
        }
    }
    nodes.reverse();
    // Coincident entry/exit representatives need no separate physical unit.
    let mut navigation = vec![];
    for node in nodes {
        let p = point(node);
        if navigation.last() != Some(&p) {
            navigation.push(p);
        }
    }
    if navigation.len() == 1 {
        navigation.push(b);
    }
    // Greedy farthest/halving visibility is proposal geometry only. Each
    // accepted shortcut has full directed and continuous-height permission.
    // Triangle, interval and portal visits share the node-expansion allowance.
    let mut work = Some(NavWork {
        remaining: limits.max_expansions - result.expanded,
        used: 0,
        exhausted: false,
    });
    let mut reduced = vec![navigation[0]];
    let mut at = 0;
    'visibility: while at + 1 < navigation.len() {
        let mut end = navigation.len() - 1;
        while end > at + 1 {
            if !nav_charge(&mut work) {
                result.truncated = true;
                reduced.extend_from_slice(&navigation[at + 1..]);
                break 'visibility;
            }
            let permission =
                navigation_permission(w, navigation[at], navigation[end], true, &mut work)?;
            if work.as_ref().unwrap().exhausted {
                result.truncated = true;
                reduced.extend_from_slice(&navigation[at + 1..]);
                break 'visibility;
            }
            if permission.is_some() {
                break;
            }
            end = (at + end) / 2;
        }
        reduced.push(navigation[end]);
        at = end;
    }
    result.expanded += work.unwrap().used;
    navigation = reduced;
    let mut canonical: Vec<Vec3> = vec![];
    for pair in navigation.windows(2) {
        if result.probed >= limits.max_legs {
            result.truncated = true;
            break;
        }
        result.probed += 1;
        // Canonicalize shared raw portal feet consistently so separately
        // proved legs join exactly, without inventing a connector afterward.
        let start = w.standing_foot(pair[0])?.unwrap_or(pair[0]);
        let end = w.standing_foot(pair[1])?.unwrap_or(pair[1]);
        match probe(w, start, end)? {
            GroundProbe::Supported(_) if !result.failures.is_empty() => {}
            GroundProbe::Supported(path) => {
                if let Some(&last) = canonical.last() {
                    if path.points.first() != Some(&last) {
                        result.failures.push(GroundFailure::PhysicalSupport {
                            span: [last, path.points[0]],
                        });
                    } else {
                        canonical.extend(path.points.into_iter().skip(1));
                    }
                } else {
                    canonical = path.points;
                }
            }
            GroundProbe::Rejected(failure) => {
                let exhausted = matches!(failure, GroundFailure::ProofBudget { .. });
                result.failures.push(failure);
                if exhausted {
                    result.truncated = true;
                    break;
                }
            }
        }
    }
    // Visibility is optional: exhaustion retains the full directed proposal.
    // Its truncated flag does not invalidate a route whose every retained leg
    // and exact canonical join has subsequently passed physical proof.
    if result.probed == navigation.len() - 1 && result.failures.is_empty() {
        let length = path_length(&canonical);
        result.supported = Some(GroundPath {
            points: canonical,
            length,
            cost: length / w.movement.speed,
        });
    }
    result.navigation = Some(navigation);
    Ok(result)
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
    if let Some(points) = direct(w, a, b)? {
        return Ok(Some(make(points)));
    }
    if w.components[from] != w.components[to] {
        return Ok(None);
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
    enum State {
        Unknown,
        Invalid,
        Valid(Proof),
    }
    impl State {
        fn known(proof: Proof) -> Self {
            if proof.path.is_none() {
                Self::Invalid
            } else {
                Self::Valid(proof)
            }
        }
    }
    struct Edge {
        to: usize,
        optimistic: f64,
        state: State,
    }
    // Node IDs are dense and stable throughout repairs. Generations avoid
    // clearing the global arrays or rebuilding hash tables for each search.
    let count = base + local.len();
    let mut costs = vec![0.; count];
    let mut previous = vec![usize::MAX; count];
    let mut previous_edge = vec![usize::MAX; count];
    let mut generations = vec![0_u16; count];
    // Adjacency and proof slots exist only for visited sources. The finite
    // directed graph is unchanged; sorting and shared-cache lookup happen once
    // per source, including memoized shared misses, across all repairs.
    let mut adjacency: Vec<Option<Vec<Edge>>> = (0..count).map(|_| None).collect();
    // Optimistic topology chooses a path before expensive support/capsule replay.
    // Failed chords reject that witness only; an exhausted repair budget leaves
    // this finite ground proposal unresolved, not physically impossible.
    for generation in 1..=512 {
        crate::cancel::check()?;
        let mut pending = BinaryHeap::new();
        costs[base] = 0.;
        generations[base] = generation;
        pending.push(Label(heuristic(base), base));
        let mut reached = false;
        while let Some(Label(priority, i)) = pending.pop() {
            crate::cancel::check()?;
            let cost = costs[i];
            if priority > cost + heuristic(i) + 1e-9 {
                continue;
            }
            if i == base + 1 {
                reached = true;
                break;
            }
            if adjacency[i].is_none() {
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
                // A single batch lookup resolves each eligible edge once.
                // Later concurrent cache fills need not change local Unknown
                // slots: selected edges still obtain their own physical proof.
                let cache = if i < base && successors.iter().any(|&j| j < base && j != i) {
                    Some(
                        graph
                            .proofs
                            .lock()
                            .map_err(|_| "Ground proof cache poisoned")?,
                    )
                } else {
                    None
                };
                adjacency[i] = Some(
                    successors
                        .into_iter()
                        .filter(|&j| j != i)
                        .map(|j| {
                            let state = cache
                                .as_ref()
                                .and_then(|cache| cache.get(&(i, j)))
                                .cloned()
                                .map_or(State::Unknown, State::known);
                            Edge {
                                to: j,
                                optimistic: (point(i)[0] - point(j)[0])
                                    .hypot(point(i)[2] - point(j)[2]),
                                state,
                            }
                        })
                        .collect(),
                );
            }
            for (edge_index, edge) in adjacency[i].as_ref().unwrap().iter().enumerate() {
                let j = edge.to;
                let length = match &edge.state {
                    State::Invalid => continue,
                    State::Valid(proof) => proof.length,
                    State::Unknown => edge.optimistic,
                };
                let next = cost + length;
                if generations[j] != generation || next < costs[j] {
                    generations[j] = generation;
                    costs[j] = next;
                    previous[j] = i;
                    previous_edge[j] = edge_index;
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
            let edge = &mut adjacency[pair[0]].as_mut().unwrap()[previous_edge[pair[1]]];
            if matches!(edge.state, State::Unknown) {
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
                edge.state = State::known(proof);
            }
            let State::Valid(proof) = &edge.state else {
                rejected = true;
                continue;
            };
            let path = proof.path.as_ref().unwrap();
            actual_cost += proof.length;
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
