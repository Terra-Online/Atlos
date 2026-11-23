use crate::{Candidate, Engine, backbone::Backbone, flight, geometry::*, search::Label, types::*};
use std::{
    collections::{BinaryHeap, HashMap},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

// Each seed uses one conditional flight. Its prefixes and suffixes come only
// from ordinary prepared edges; whole-route replay proves the resource entry.
// This bounded composition intentionally does not claim multi-gap completeness.
impl Engine {
    pub(super) fn conditional_seeds(
        &self,
        layout: usize,
        arrival: &Arrival,
        query: &Query,
        previous: &[Option<(usize, Segment)>],
        suffix: &[Option<(usize, Segment)>],
    ) -> Vec<Candidate> {
        let backbone = self.backbone_for(layout);
        let base = &self.world_for(layout).physical.movement.model;
        if !backbone.conditional.iter().any(|edges| !edges.is_empty()) {
            return Vec::new();
        }
        let mut incoming = vec![Vec::new(); backbone.nodes.len()];
        for (from, edges) in backbone.edges.iter().enumerate() {
            for edge in edges {
                if edge.action.mode == "walk" && !backbone.conditional[edge.to].is_empty() {
                    incoming[edge.to].push((from, &edge.action));
                }
            }
        }
        let mut trees: HashMap<usize, Tree> = HashMap::new();
        let mut result = Vec::new();
        for (from, edges) in backbone.conditional.iter().enumerate() {
            if previous[from].is_none() {
                continue;
            }
            for edge in edges {
                if self.cancelled.load(Ordering::Relaxed) {
                    return result;
                }
                let Some(ending) = chain(suffix, edge.to, false) else {
                    continue;
                };
                for flight in edge.flight.variants(base, &backbone.boost_uses) {
                    let axis = sub(flight.end(), flight.start());
                    let span = axis[0].hypot(axis[2]);
                    // The cheapest prefix may approach from the wrong direction.
                    // Try a few existing incoming walks as explicit run-up tails.
                    let mut runups: Vec<_> = incoming[from]
                        .iter()
                        .copied()
                        .filter(|(_, action)| {
                            let delta = sub(action.end(), action.start());
                            let length = delta[0].hypot(delta[2]);
                            span > 0.
                                && length > 0.
                                && (delta[0] * axis[0] + delta[2] * axis[2]) / (span * length)
                                    >= (std::f64::consts::PI / 6.).cos()
                        })
                        .collect();
                    runups.sort_by(|a, b| b.1.cost().total_cmp(&a.1.cost()));
                    let approaches: Vec<_> = std::iter::once((from, None))
                        .chain(
                            runups
                                .into_iter()
                                .take(8)
                                .map(|(node, action)| (node, Some(action))),
                        )
                        .collect();
                    for (node, runup) in approaches {
                        if self.cancelled.load(Ordering::Relaxed) {
                            return result;
                        }
                        let mut prefixes = Vec::new();
                        if let Some(prefix) = chain(previous, node, true) {
                            prefixes.push(prefix);
                        }
                        if let Some(required) = &flight.boost {
                            let source = self
                                .world_for(layout)
                                .physical
                                .devices
                                .iter()
                                .flat_map(|facts| &facts.devices)
                                .find(|device| device.id == required.id)
                                .and_then(|device| device.goal.as_ref());
                            if let Some(source) = source {
                                for &boost in &backbone.boosts {
                                    if flight::hit(
                                        backbone.nodes[boost],
                                        backbone.nodes[boost],
                                        source.position,
                                        &source.interaction,
                                    )
                                    .is_none()
                                    {
                                        continue;
                                    }
                                    let Some(mut prefix) = chain(previous, boost, true) else {
                                        continue;
                                    };
                                    let tree = trees.entry(boost).or_insert_with(|| {
                                        Tree::new(backbone, boost, &self.cancelled)
                                    });
                                    let Some(detour) = tree.path(node) else {
                                        continue;
                                    };
                                    prefix.extend(detour);
                                    prefixes.push(prefix);
                                }
                            }
                        }
                        for mut path in prefixes {
                            if let Some(runup) = runup {
                                path.push(runup.as_ref().clone());
                            }
                            path.push(flight.clone());
                            path.extend(ending.iter().cloned());
                            if let Some(candidate) = self.candidate(layout, arrival.clone(), path) {
                                if candidate.finishes_at_first_goal(query) {
                                    result.push(candidate);
                                    if result.len() >= self.config.population_size {
                                        return result;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        result
    }
}

fn chain(
    links: &[Option<(usize, Segment)>],
    mut node: usize,
    reverse: bool,
) -> Option<Vec<Segment>> {
    let mut result = Vec::new();
    for _ in 0..=links.len() {
        if node == links.len() {
            if reverse {
                result.reverse();
            }
            return Some(result);
        }
        let (next, action) = links.get(node)?.as_ref()?;
        result.push(action.clone());
        node = *next;
    }
    None
}

struct Tree {
    root: usize,
    previous: Vec<Option<(usize, Arc<Segment>)>>,
}
impl Tree {
    fn new(backbone: &Backbone, root: usize, cancelled: &AtomicBool) -> Self {
        let mut previous = vec![None; backbone.nodes.len()];
        let mut costs = vec![f64::INFINITY; backbone.nodes.len()];
        costs[root] = 0.;
        let mut queue = BinaryHeap::from([Label {
            node: root,
            cost: 0.,
        }]);
        while let Some(Label { node, cost }) = queue.pop() {
            if cancelled.load(Ordering::Relaxed) {
                break;
            }
            if cost > costs[node] {
                continue;
            }
            for edge in &backbone.edges[node] {
                let next = cost + edge.action.cost();
                if next < costs[edge.to] {
                    costs[edge.to] = next;
                    previous[edge.to] = Some((node, Arc::clone(&edge.action)));
                    queue.push(Label {
                        node: edge.to,
                        cost: next,
                    });
                }
            }
        }
        Self { root, previous }
    }
    fn path(&self, mut node: usize) -> Option<Vec<Segment>> {
        let mut path = Vec::new();
        for _ in 0..=self.previous.len() {
            if node == self.root {
                path.reverse();
                return Some(path);
            }
            let (from, action) = self.previous.get(node)?.as_ref()?;
            path.push(action.as_ref().clone());
            node = *from;
        }
        None
    }
}
