use crate::{Candidate, Engine, flight, geometry::*, types::*};
use std::sync::atomic::Ordering;
impl Engine {
    pub(super) fn initialize(&self, query: &Query) -> Vec<Candidate> {
        let goals = self.world.goals(&query);
        let mut endings: Vec<Vec<Segment>> =
            (0..self.backbone.nodes.len()).map(|_| Vec::new()).collect();
        for (i, &point) in self.backbone.nodes.iter().enumerate() {
            for &goal in &goals {
                if distance(point, goal) < 12. {
                    if let Some(action) = self.world.walk(point, goal) {
                        endings[i].push(action);
                    }
                }
            }
        }
        if let Some(interaction) = query.interaction.as_ref().filter(|x| x.airborne) {
            for (mark, connections) in &self.backbone.terminals {
                if distance(mark.position, query.goal) < 1e-6 && mark.interaction == *interaction {
                    for (node, action) in connections {
                        if flight::hit(action.end(), action.end(), query.goal, interaction)
                            .is_some()
                        {
                            endings[*node].push(action.clone());
                        }
                    }
                }
            }
        }
        let mut population = Vec::new();
        for arrival in &query.starts {
            if arrival.state != "available" || self.cancelled.load(Ordering::Relaxed) {
                continue;
            }
            let Some(start) = self.world.project(
                arrival.position,
                self.world.physical.ground.options.max_vertical,
            ) else {
                continue;
            };
            for &goal in &goals {
                if let Some(action) = self.world.walk(start, goal) {
                    population.push(Candidate {
                        arrival: arrival.clone(),
                        segments: vec![action],
                    });
                }
            }
            let count = self.backbone.nodes.len();
            let mut costs = vec![f64::INFINITY; count];
            let mut previous: Vec<Option<(usize, Segment)>> = vec![None; count];
            let mut done = vec![false; count];
            let mut queue = std::collections::BinaryHeap::new();
            for (i, &point) in self.backbone.nodes.iter().enumerate() {
                if distance(start, point) < 12. {
                    if let Some(action) = self.world.walk(start, point) {
                        costs[i] = action.cost();
                        queue.push(Label {
                            cost: costs[i],
                            node: i,
                        });
                        previous[i] = Some((count, action));
                    }
                }
            }
            let mut found = 0;
            while let Some(label) = queue.pop() {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                let node = label.node;
                if done[node] {
                    continue;
                }
                done[node] = true;
                for last in &endings[node] {
                    let mut segments = vec![last.clone()];
                    let mut cursor = node;
                    while let Some((from, action)) = &previous[cursor] {
                        segments.push(action.clone());
                        if *from == count {
                            break;
                        }
                        cursor = *from;
                    }
                    segments.reverse();
                    let candidate = Candidate {
                        arrival: arrival.clone(),
                        segments,
                    };
                    if candidate.finishes_at_first_goal(query) {
                        population.push(candidate);
                        found += 1;
                    }
                }
                if found >= self.config.population_size {
                    break;
                }
                for edge in &self.backbone.edges[node] {
                    let cost = costs[node] + edge.action.cost();
                    if cost < costs[edge.to] {
                        costs[edge.to] = cost;
                        queue.push(Label {
                            cost,
                            node: edge.to,
                        });
                        previous[edge.to] = Some((node, edge.action.clone()));
                    }
                }
            }
        }
        population
    }
}
struct Label {
    cost: f64,
    node: usize,
}
impl PartialEq for Label {
    fn eq(&self, other: &Self) -> bool {
        self.node == other.node && self.cost == other.cost
    }
}
impl Eq for Label {}
impl PartialOrd for Label {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Label {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.node.cmp(&self.node))
    }
}
