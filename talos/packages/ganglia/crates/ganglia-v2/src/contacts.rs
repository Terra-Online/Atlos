use super::*;
use std::collections::{BTreeMap, BTreeSet};

fn union(mut intervals: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    intervals.retain(|span| span[0] <= span[1]);
    intervals.sort_unstable_by(|a, b| a[0].total_cmp(&b[0]));
    let mut result: Vec<[f64; 2]> = Vec::new();
    for [lo, hi] in intervals {
        if let Some(last) = result.last_mut()
            && lo <= last[1]
        {
            last[1] = last[1].max(hi);
        } else {
            result.push([lo, hi]);
        }
    }
    result
}

pub(crate) type Contact = Option<usize>;
struct Cap {
    support: usize,
    pose: usize,
    triangles: Vec<[Point; 3]>,
    index: Index,
}
struct Translation {
    support: usize,
    from: usize,
    to: usize,
    delta: Point,
    triangles: Vec<[Point; 3]>,
    bounds: Bounds,
}
impl Translation {
    fn prepare(support: usize, facts: &MovingSupport) -> Vec<Self> {
        // A conveyor may admit a fixed pose between its sampled endpoints even
        // when its speed is unknown. This certifies contact, never a timed ride.
        if facts.family != "conveyor" {
            return Vec::new();
        }
        let mut result = Vec::new();
        for transfer in &facts.transfers {
            let (Some(from), Some(to), Some(body)) =
                (transfer.from_pose, transfer.to_pose, transfer.body)
            else {
                continue;
            };
            let (Some(a), Some(b)) = (facts.poses.get(from), facts.poses.get(to)) else {
                continue;
            };
            let delta = sub(transfer.to, transfer.from);
            if distance(transfer.from, transfer.to) < 1e-9
                || distance(add(a.min, delta), b.min) > 1e-6
                || distance(add(a.max, delta), b.max) > 1e-6
            {
                continue;
            }
            let cap = |surface: usize, pose| {
                facts.surface_poses.get(surface).is_some_and(|spans| {
                    spans.iter().any(|span| {
                        span.body == body && span.from_pose == pose && span.to_pose == pose
                    })
                })
            };
            for (i, face) in facts.surfaces.iter().enumerate() {
                if !cap(i, from) || face.vertices.len() < 3 {
                    continue;
                }
                // Box translation alone is not proof that the actual body roof
                // translates rigidly. Match both authored cap vertex sets.
                if !facts.surfaces.iter().enumerate().any(|(j, end)| {
                    cap(j, to)
                        && end.vertices.len() == face.vertices.len()
                        && face.vertices.iter().all(|&p| {
                            end.vertices
                                .iter()
                                .any(|&q| distance(add(p, delta), q) <= 1e-6)
                        })
                        && end.vertices.iter().all(|&q| {
                            face.vertices
                                .iter()
                                .any(|&p| distance(add(p, delta), q) <= 1e-6)
                        })
                }) {
                    continue;
                }
                let triangles = (1..face.vertices.len() - 1)
                    .map(|k| [face.vertices[0], face.vertices[k], face.vertices[k + 1]])
                    .collect();
                let bounds = Bounds::points(
                    &face
                        .vertices
                        .iter()
                        .copied()
                        .chain(face.vertices.iter().map(|&p| add(p, delta)))
                        .collect::<Vec<_>>(),
                );
                result.push(Self {
                    support,
                    from,
                    to,
                    delta,
                    triangles,
                    bounds,
                });
            }
        }
        result
    }
}
pub(super) struct Catalog {
    caps: Vec<Cap>,
    translations: Vec<Translation>,
    enabled: bool,
    empty: Index,
}
impl Catalog {
    pub(super) fn new(physical: &Physical) -> Self {
        let mut caps = Vec::new();
        let mut translations = Vec::new();
        let mut enabled = false;
        for (support, facts) in physical
            .devices
            .iter()
            .flat_map(|d| &d.moving_supports)
            .enumerate()
        {
            if facts.circular.is_some() || facts.assumption != "phase-free-swept-support" {
                continue;
            }
            enabled |= !facts.surfaces.is_empty();
            translations.extend(Translation::prepare(support, facts));
            let mut poses: BTreeMap<usize, Vec<[Point; 3]>> = BTreeMap::new();
            for (surface, face) in facts.surfaces.iter().enumerate() {
                let triangles: Vec<_> = (1..face.vertices.len().saturating_sub(1))
                    .map(|i| [face.vertices[0], face.vertices[i], face.vertices[i + 1]])
                    .collect();
                // Missing pose provenance cannot distinguish a rigid cap from
                // a swept hull. Only authored cap associations certify walking.
                for span in facts.surface_poses.get(surface).into_iter().flatten() {
                    if span.from_pose == span.to_pose && span.from_pose < facts.poses.len() {
                        poses
                            .entry(span.from_pose)
                            .or_default()
                            .extend(triangles.iter().copied());
                    }
                }
            }
            for (pose, triangles) in poses {
                caps.push(Cap {
                    support,
                    pose,
                    index: Index::new(
                        &triangles
                            .iter()
                            .map(|t| Bounds::points(t))
                            .collect::<Vec<_>>(),
                    ),
                    triangles,
                });
            }
        }
        Self {
            caps,
            translations,
            enabled,
            empty: Index::new(&[]),
        }
    }
}
impl World {
    fn translated_receipts(&self, segments: &[Segment]) -> Option<Vec<serde_json::Value>> {
        // Keep one continuous parameter for the entire candidate, including
        // gait splits. Mixed walk/ride episodes require parameter-aware search
        // labels and remain outside this conservative whole-walk fallback.
        if segments.is_empty() || segments.iter().any(|s| s.mode != "walk") {
            return None;
        }
        let points: Vec<_> = segments
            .iter()
            .flat_map(|s| s.points.iter().copied())
            .collect();
        let bounds = Bounds::points(&points);
        let radius = self.physical.ground.options.profile.radius;
        let up = self.physical.movement.max_slope.to_radians().cos();
        let facts: Vec<_> = self
            .physical
            .devices
            .iter()
            .flat_map(|d| &d.moving_supports)
            .collect();
        for translation in &self.contacts.translations {
            let swept = translation.bounds.expand(radius + 0.03);
            if (0..3).any(|axis| {
                bounds.min[axis] < swept.min[axis] || bounds.max[axis] > swept.max[axis]
            }) {
                continue;
            }
            let faces: Vec<_> = translation
                .triangles
                .iter()
                .filter_map(|&triangle| {
                    support_normal(triangle, up, true).map(|normal| (triangle, normal))
                })
                .collect();
            let mut feasible: Vec<[f64; 2]> = vec![[0., 1.]];
            for &point in &points {
                // Moving the roof by t*delta is equivalent to moving the feet
                // by -t*delta against its original cap. The existing capsule
                // support envelope supplies continuous candidate intervals,
                // including finite edge contact and face-normal roundoff. The
                // selected concrete pose still needs the full chord proof.
                let mut intervals = Vec::new();
                for &(triangle, normal) in &faces {
                    support_intervals(
                        [point, sub(point, translation.delta)],
                        triangle,
                        normal,
                        radius,
                        0.02,
                        &mut intervals,
                    );
                }
                let intervals = union(intervals);
                feasible = union(
                    feasible
                        .iter()
                        .flat_map(|a| {
                            intervals
                                .iter()
                                .map(move |b| [a[0].max(b[0]), a[1].min(b[1])])
                        })
                        .collect(),
                );
                if feasible.is_empty() {
                    break;
                }
            }
            for [lo, hi] in feasible {
                let t = (lo + hi) * 0.5;
                let delta = scale(translation.delta, t);
                let triangles: Vec<_> = translation
                    .triangles
                    .iter()
                    .map(|face| face.map(|p| add(p, delta)))
                    .collect();
                let index = Index::new(
                    &triangles
                        .iter()
                        .map(|face| Bounds::points(face))
                        .collect::<Vec<_>>(),
                );
                // The interval proposes one concrete cap. Recheck every chord
                // with the ordinary continuous support proof before accepting it.
                if !segments.iter().all(|s| {
                    s.points
                        .windows(2)
                        .all(|p| self.contact_span_with([p[0], p[1]], &index, &triangles))
                }) {
                    continue;
                }
                let source = facts[translation.support];
                let a = &source.poses[translation.from];
                let b = &source.poses[translation.to];
                return Some(vec![
                    serde_json::json!({"device":source.id,"family":source.family,"min":lerp(a.min,b.min,t),"max":lerp(a.max,b.max,t),"role":"use"}),
                ]);
            }
        }
        None
    }
    pub(crate) fn has_contacts(&self) -> bool {
        self.contacts.enabled
    }

    fn contact_span(&self, path: [Point; 2], choice: Contact) -> bool {
        let (index, triangles) = choice.map_or((&self.contacts.empty, &[][..]), |i| {
            let cap = &self.contacts.caps[i];
            (&cap.index, cap.triangles.as_slice())
        });
        self.contact_span_with(path, index, triangles)
    }
    fn contact_span_with(&self, path: [Point; 2], index: &Index, triangles: &[[Point; 3]]) -> bool {
        if self.support_span_with(path, true, index, triangles) {
            return true;
        }
        if !self.support_span_with(path, false, index, triangles) {
            return false;
        }
        let radius = self.physical.ground.options.profile.radius;
        let up = self.physical.movement.max_slope.to_radians().cos();
        let count = (distance(path[0], path[1]) / (radius / 8.).max(WALK_SAMPLE_MIN))
            .ceil()
            .max(2.) as usize;
        (0..=count).all(|i| {
            let point = lerp(path[0], path[1], i as f64 / count as f64);
            let bounds = Bounds::points(&[point]).expand(radius + 0.31);
            let mut supported = false;
            for (index, triangles) in [
                (self.collision_index.as_ref(), self.collision.as_slice()),
                (self.box_support_index.as_ref(), self.box_support.as_slice()),
                (self.circular_index.as_ref(), self.circular.as_slice()),
                (index, triangles),
            ] {
                index.query(bounds, |j| {
                    let triangle = triangles[j];
                    if let Some(normal) = support_normal(triangle, up, true)
                        && let Some(height) = sphere_support(point, triangle, normal, radius)
                    {
                        let gap = point[1] - height;
                        if (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&gap)
                            || (height + STANDING_OFFSET - point[1]).abs() <= WALK_TRACE_TOLERANCE
                        {
                            supported = true;
                            return true;
                        }
                    }
                    false
                });
                if supported {
                    break;
                }
            }
            supported
        })
    }
    fn cap_contact(&self, point: Point, key: usize) -> bool {
        let cap = &self.contacts.caps[key];
        let radius = self.physical.ground.options.profile.radius;
        let up = self.physical.movement.max_slope.to_radians().cos();
        cap.index
            .query(Bounds::points(&[point]).expand(radius + 0.03), |i| {
                let triangle = cap.triangles[i];
                let Some(normal) = support_normal(triangle, up, true) else {
                    return false;
                };
                let Some(height) = sphere_support(point, triangle, normal, radius) else {
                    return false;
                };
                (-1e-6..=WALK_CLEARANCE + 1e-6).contains(&(point[1] - height))
                    || (height + STANDING_OFFSET - point[1]).abs() <= WALK_TRACE_TOLERANCE
            })
    }
    fn static_contact(&self, point: Point) -> bool {
        self.contact_span([point, point], None)
    }

    pub(crate) fn contact_next(&self, active: Contact, segment: &Segment) -> Vec<Contact> {
        let mut next: Vec<_> = self
            .contact_steps(active, segment)
            .into_iter()
            .map(|(next, _)| next)
            .collect();
        next.sort_unstable();
        next.dedup();
        next
    }
    fn contact_steps(&self, active: Contact, segment: &Segment) -> Vec<(Contact, Contact)> {
        if !self.has_contacts() {
            return vec![(None, None)];
        }
        if segment.traversal == Some("moving-support") {
            if let Some(connection) = segment.connection.as_deref() {
                for (support, facts) in self
                    .physical
                    .devices
                    .iter()
                    .flat_map(|d| &d.moving_supports)
                    .enumerate()
                {
                    for (i, transfer) in facts.transfers.iter().enumerate() {
                        let id = format!("moving-ride/{}/{i}", facts.id);
                        let reverse = connection == format!("{id}/reverse");
                        if connection != id && !reverse {
                            continue;
                        }
                        let (from, to) = if reverse {
                            (transfer.to_pose, transfer.from_pose)
                        } else {
                            (transfer.from_pose, transfer.to_pose)
                        };
                        if active.is_some_and(|key| {
                            let cap = &self.contacts.caps[key];
                            cap.support != support || Some(cap.pose) != from
                        }) {
                            return vec![];
                        }
                        let source = self
                            .contacts
                            .caps
                            .iter()
                            .position(|cap| cap.support == support && Some(cap.pose) == from);
                        let target = self
                            .contacts
                            .caps
                            .iter()
                            .position(|cap| cap.support == support && Some(cap.pose) == to);
                        if !source.is_some_and(|key| self.cap_contact(segment.start(), key)) {
                            return vec![];
                        }
                        if self.static_contact(segment.end()) {
                            return vec![(None, None)];
                        }
                        let Some(target) =
                            target.filter(|&key| self.cap_contact(segment.end(), key))
                        else {
                            return vec![];
                        };
                        return vec![(Some(target), None)];
                    }
                }
            }
            return vec![(None, None)];
        }
        // Flight/rope contact phase remains the existing phase-free policy.
        // This slice prevents pose changes during an uninterrupted walk.
        if segment.mode != "walk" {
            return vec![(None, None)];
        }
        let bounds = Bounds::points(&segment.points)
            .expand(self.physical.ground.options.profile.radius + 0.03);
        if !self.moving_index.query(bounds, |_| true) {
            return vec![(None, None)];
        }
        if segment
            .points
            .windows(2)
            .all(|p| self.contact_span([p[0], p[1]], None))
        {
            return vec![(None, None)];
        }
        let may_change = active.is_none() || self.static_contact(segment.start());
        let end_static = self.static_contact(segment.end());
        let mut next = Vec::new();
        for (key, cap) in self.contacts.caps.iter().enumerate() {
            if !may_change && active != Some(key) {
                continue;
            }
            if !cap.index.query(bounds, |_| true) {
                continue;
            }
            if segment
                .points
                .windows(2)
                .all(|p| self.contact_span([p[0], p[1]], Some(key)))
            {
                next.push((if end_static { None } else { Some(key) }, Some(key)));
            }
        }
        next.sort_unstable();
        next.dedup();
        next
    }

    pub(crate) fn contact_receipts(&self, segments: &[Segment]) -> Option<Vec<serde_json::Value>> {
        if !self.has_contacts() {
            return Some(Vec::new());
        }
        let mut states = BTreeMap::from([(None, BTreeSet::new())]);
        for segment in segments {
            let mut next = BTreeMap::new();
            for (&active, used) in &states {
                for (contact, used_cap) in self.contact_steps(active, segment) {
                    let mut used = used.clone();
                    if let Some(key) = used_cap {
                        used.insert(key);
                    }
                    next.entry(contact).or_insert(used);
                }
            }
            if next.is_empty() {
                return self.translated_receipts(segments);
            }
            states = next;
        }
        let used = states.into_values().next()?;
        let facts: Vec<_> = self
            .physical
            .devices
            .iter()
            .flat_map(|d| &d.moving_supports)
            .collect();
        Some(used.into_iter().filter_map(|key|{
            let cap=&self.contacts.caps[key];let source=facts[cap.support];let pose=source.poses.get(cap.pose)?;
            Some(serde_json::json!({"device":source.id,"family":source.family,"min":pose.min,"max":pose.max,"role":"use"}))
        }).collect())
    }
}
