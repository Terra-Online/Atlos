use crate::{Candidate, Engine, flight, geometry::*, types::*};
use serde_json::{Value, json};
use std::sync::atomic::Ordering;
impl Engine {
    pub(super) fn initialize(&self, query: &Query, diagnostics: &mut Value) -> Vec<Candidate> {
        let goals = self.world.goals(&query);
        let mut endings: Vec<Vec<Segment>> =
            (0..self.backbone.nodes.len()).map(|_| Vec::new()).collect();
        for (i, &point) in self.backbone.nodes.iter().enumerate() {
            if self.cancelled.load(Ordering::Relaxed) {
                break;
            }
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
        let mut origins = Vec::new();
        let mut reached = vec![false; self.backbone.nodes.len()];
        for arrival in &query.starts {
            if arrival.state != "available" || self.cancelled.load(Ordering::Relaxed) {
                continue;
            }
            let Some(start) = self.world.project(
                arrival.position,
                self.world.physical.ground.options.max_vertical,
            ) else {
                origins.push(json!({"id":arrival.id,"projected":null,"attachments":0}));
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
            origins.push(json!({"id":arrival.id,"projected":start,"attachments":queue.len()}));
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
                reached[node] = true;
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
        *diagnostics = json!({"starts":origins,"goalPositions":goals.len(),"goalAttachments":endings.iter().map(Vec::len).sum::<usize>(),"reachedNodes":reached.iter().filter(|&&v|v).count()});
        if population.is_empty()
            && !self.cancelled.load(Ordering::Relaxed)
            && std::env::var_os("GANGLIA_PROFILE").is_some()
        {
            // Explain which prepared connection is missing without exporting
            // the physical snapshot or a complete graph dump.
            let mut reverse = vec![Vec::new(); self.backbone.nodes.len()];
            for (from, edges) in self.backbone.edges.iter().enumerate() {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                for edge in edges {
                    reverse[edge.to].push(from);
                }
            }
            let mut pending: Vec<_> = endings
                .iter()
                .enumerate()
                .filter_map(|(i, e)| (!e.is_empty()).then_some(i))
                .collect();
            let mut to_goal = vec![false; reached.len()];
            while let Some(node) = pending.pop() {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                if to_goal[node] {
                    continue;
                }
                to_goal[node] = true;
                pending.extend(reverse[node].iter().copied());
            }
            diagnostics["nodesReachingGoal"] = json!(to_goal.iter().filter(|&&v| v).count());
            let mut nearby: Vec<_> = (0..reached.len()).filter(|&i| reached[i]).collect();
            nearby.sort_by(|&a, &b| {
                distance(self.backbone.nodes[a], query.goal)
                    .total_cmp(&distance(self.backbone.nodes[b], query.goal))
            });
            diagnostics["nearestReached"] = json!(
                nearby
                    .into_iter()
                    .take(8)
                    .map(|i| self.backbone.nodes[i])
                    .collect::<Vec<_>>()
            );
            let targets: Vec<_> = (0..to_goal.len()).filter(|&i| to_goal[i]).collect();
            let index = Index::new(
                &targets
                    .iter()
                    .map(|&i| Bounds::points(&[self.backbone.nodes[i]]))
                    .collect::<Vec<_>>(),
            );
            let mut gaps = Vec::new();
            for (i, &yes) in reached.iter().enumerate() {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                if !yes {
                    continue;
                }
                index.query(Bounds::points(&[self.backbone.nodes[i]]).expand(12.), |j| {
                    if self.cancelled.load(Ordering::Relaxed) {
                        return true;
                    }
                    let to = targets[j];
                    gaps.push((
                        distance(self.backbone.nodes[i], self.backbone.nodes[to]),
                        i,
                        to,
                    ));
                    gaps.sort_by(|a, b| a.0.total_cmp(&b.0));
                    gaps.truncate(8);
                    false
                });
            }
            gaps.sort_by(|a, b| a.0.total_cmp(&b.0));
            diagnostics["nearestGaps"] = json!(gaps.into_iter().take(8).map(|(span,a,b)|{
                let from=self.backbone.nodes[a];let to=self.backbone.nodes[b];
                json!({"from":from,"to":to,"distance":span,"action":self.world.action(from,to).map(|a|a.mode)})
            }).collect::<Vec<_>>());
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
