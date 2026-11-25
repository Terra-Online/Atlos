use crate::{
    Candidate, Engine, backbone::Backbone, flight, flight::PreparedFlight, geometry::*, optimize,
    search::Label, types::*,
};
use std::{
    collections::{BinaryHeap, HashMap},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

type Links = [Option<(usize, Segment)>];

#[derive(Clone, Copy)]
pub(super) struct Paths<'a> {
    pub previous: &'a Links,
    pub suffix: &'a Links,
    pub prefix_costs: &'a [f64],
    pub suffix_costs: &'a [f64],
    pub settled: &'a [bool],
}

#[derive(Clone, Copy)]
enum Hop<'a> {
    Edge(&'a Segment),
    Sprint(&'a PreparedFlight),
}

impl Engine {
    /// Try a bounded chain of prepared sprint flights when neither ordinary
    /// routing nor a single conditional gap provided a scheduled route.
    pub(super) fn chained_sprints(
        &self,
        layout: usize,
        arrival: &Arrival,
        query: &Query,
        paths: Paths<'_>,
    ) -> Option<Candidate> {
        const MAX_FLIGHTS: usize = 3;
        const LABEL_LIMIT: usize = 65_536;
        const ROUTE_TRIALS: usize = 32;
        let backbone = self.backbone_for(layout);
        let model = &self.world_for(layout).physical.movement.model;
        let count = backbone.nodes.len();
        // A label identifies both a node and the number of flights already
        // used. A cheaper one-flight chain must not overwrite a two-flight
        // chain that reached the same supported contact.
        let mut costs = vec![f64::INFINITY; count * MAX_FLIGHTS];
        let mut links = vec![None; costs.len()];
        let mut queue = BinaryHeap::new();
        for (from, edges) in backbone.conditional.iter().enumerate() {
            if self.cancelled.load(Ordering::Relaxed) {
                return None;
            }
            if !paths.settled[from] {
                continue;
            }
            for edge in edges.iter().filter(|edge| edge.flight.supports_unboosted()) {
                if paths.settled[edge.to] {
                    continue;
                }
                let cost = paths.prefix_costs[from] + edge.flight.action.cost();
                if cost < costs[edge.to] {
                    costs[edge.to] = cost;
                    links[edge.to] = Some((count * MAX_FLIGHTS + from, Hop::Sprint(&edge.flight)));
                    queue.push(Label {
                        node: edge.to,
                        cost,
                    });
                }
            }
        }

        let mut labels = 0;
        let mut trials = 0;
        while let Some(Label { node: label, cost }) = queue.pop() {
            if self.cancelled.load(Ordering::Relaxed) || labels == LABEL_LIMIT {
                return None;
            }
            if cost > costs[label] {
                continue;
            }
            labels += 1;
            let node = label % count;
            let layer = label / count;
            if layer > 0 && paths.suffix[node].is_some() {
                trials += 1;
                let mut middle = Vec::new();
                let mut cursor = label;
                while cursor < count * MAX_FLIGHTS {
                    let (parent, hop) = links[cursor]?;
                    middle.push(match hop {
                        Hop::Edge(action) => action.clone(),
                        Hop::Sprint(flight) => flight.variants(model, &[]).next()?,
                    });
                    cursor = parent;
                }
                let mut route = chain(paths.previous, cursor % count, true)?;
                route.extend(middle.into_iter().rev());
                route.extend(chain(paths.suffix, node, false)?);
                if let Some(candidate) = self.candidate(layout, arrival.clone(), route) {
                    if candidate.finishes_at_first_goal(query) {
                        return Some(candidate);
                    }
                }
                if trials == ROUTE_TRIALS {
                    return None;
                }
            }
            let mut relax = |to, next, hop| {
                if next < costs[to] {
                    costs[to] = next;
                    links[to] = Some((label, hop));
                    queue.push(Label {
                        node: to,
                        cost: next,
                    });
                }
            };
            for edge in &backbone.edges[node] {
                relax(
                    layer * count + edge.to,
                    cost + edge.action.cost(),
                    Hop::Edge(&edge.action),
                );
            }
            if layer + 1 < MAX_FLIGHTS {
                for edge in backbone.conditional[node]
                    .iter()
                    .filter(|edge| edge.flight.supports_unboosted())
                {
                    relax(
                        (layer + 1) * count + edge.to,
                        cost + edge.flight.action.cost(),
                        Hop::Sprint(&edge.flight),
                    );
                }
            }
        }
        None
    }
}

// Each seed uses one conditional flight. Its prefixes and suffixes come only
// from ordinary prepared edges; whole-route replay proves the resource entry.
// This bounded composition intentionally does not claim multi-gap completeness.
impl Engine {
    pub(super) fn conditional_seeds(
        &self,
        layout: usize,
        arrival: &Arrival,
        query: &Query,
        paths: Paths<'_>,
        incumbent: Option<f64>,
        sprint_terminal: bool,
    ) -> Vec<Candidate> {
        const IMPROVEMENT_TRIALS: usize = 48;
        let backbone = self.backbone_for(layout);
        let physical = &self.world_for(layout).physical;
        let base = &physical.movement.model;
        let Paths {
            previous,
            suffix,
            prefix_costs,
            suffix_costs,
            settled,
        } = paths;
        let locomotion = &physical.locomotion;
        let top_speed = locomotion.dash.as_ref().map_or(
            locomotion.sprint_speed.unwrap_or(locomotion.speed),
            |dash| dash.speed,
        );
        let max_boost = backbone
            .boost_uses
            .iter()
            .map(|boost| boost.multiplier)
            .fold(1., f64::max);
        let time_ratio = locomotion.speed / (top_speed * max_boost);
        let mut connections: Vec<_> = backbone
            .conditional
            .iter()
            .enumerate()
            .flat_map(|(from, edges)| {
                edges.iter().filter_map(move |edge| {
                    if previous[from].is_none() || suffix[edge.to].is_none() {
                        return None;
                    }
                    let flight = edge.flight.action.cost();
                    let end = suffix_costs[edge.to];
                    let start = prefix_costs[from];
                    // Ordinary labels price walking at run speed. Even if every walk
                    // used the fastest gait and boost, it could only save this fraction.
                    // An unsettled prefix has no final shortest-path cost yet.
                    let prefix_bound = if settled[from] { start } else { 0. };
                    let bound = arrival.cost + flight + (prefix_bound + end) * time_ratio;
                    incumbent.is_none_or(|best| bound < best).then_some((
                        start + flight + end,
                        from,
                        edge,
                    ))
                })
            })
            .collect();
        if connections.is_empty() {
            return Vec::new();
        }
        if incumbent.is_some() || sprint_terminal {
            connections.sort_by(|a, b| a.0.total_cmp(&b.0));
        }
        if incumbent.is_some() {
            connections.truncate(IMPROVEMENT_TRIALS);
        }
        let mut incoming = vec![Vec::new(); backbone.nodes.len()];
        let mut departures = vec![false; backbone.nodes.len()];
        for &(_, from, _) in &connections {
            departures[from] = true;
        }
        for (from, edges) in backbone.edges.iter().enumerate() {
            for edge in edges {
                if edge.action.mode == "walk" && departures[edge.to] {
                    incoming[edge.to].push((from, &edge.action));
                }
            }
        }
        let mut trees: HashMap<usize, Tree> = HashMap::new();
        let mut result = Vec::new();
        for (_, from, edge) in connections {
            if self.cancelled.load(Ordering::Relaxed) {
                return result;
            }
            let Some(ending) = chain(suffix, edge.to, false) else {
                continue;
            };
            let mut best_for_edge: Option<Candidate> = None;
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
                                let tree = trees
                                    .entry(boost)
                                    .or_insert_with(|| Tree::new(backbone, boost, &self.cancelled));
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
                            if !candidate.finishes_at_first_goal(query) {
                                continue;
                            }
                            if let Some(best) = incumbent {
                                let limit = best_for_edge.as_ref().map_or(best, Candidate::cost);
                                if candidate.cost() < limit {
                                    best_for_edge = Some(candidate);
                                }
                            } else {
                                result.push(candidate);
                                if result.len() == self.config.population_size {
                                    return result;
                                }
                            }
                        }
                    }
                }
            }
            // Vary the flight among improving seeds. Repeating the same
            // departure and landing with different run-ups crowds out shortcuts.
            if let Some(candidate) = best_for_edge {
                result.push(candidate);
                optimize::select(&mut result, self.config.population_size);
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
