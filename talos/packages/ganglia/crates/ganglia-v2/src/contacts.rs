use super::*;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) type Contact = Option<usize>;
struct Cap {
    support: usize,
    pose: usize,
    triangles: Vec<[Point; 3]>,
    index: Index,
}
pub(super) struct Catalog {
    caps: Vec<Cap>,
    enabled: bool,
    empty: Index,
}
impl Catalog {
    pub(super) fn new(physical: &Physical) -> Self {
        let mut caps = Vec::new();
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
            enabled,
            empty: Index::new(&[]),
        }
    }
}
impl World {
    pub(crate) fn has_contacts(&self) -> bool {
        self.contacts.enabled
    }

    fn contact_span(&self, path: [Point; 2], choice: Contact) -> bool {
        let (index, triangles) = choice.map_or((&self.contacts.empty, &[][..]), |i| {
            let cap = &self.contacts.caps[i];
            (&cap.index, cap.triangles.as_slice())
        });
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
                return None;
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
