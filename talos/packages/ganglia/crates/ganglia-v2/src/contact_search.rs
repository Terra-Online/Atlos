use crate::{Candidate, Engine, geometry::*, search::Label, types::*, world::Contact};
use std::{
    collections::{BinaryHeap, HashMap},
    sync::{Arc, atomic::Ordering},
};

struct Entry {
    node: usize,
    contact: Contact,
    cost: f64,
    previous: Option<(usize, Arc<Segment>)>,
}

impl Engine {
    // Pose-aware fallback retains a more expensive authored ride when an
    // ordinary shortest path crossed incompatible alternative support roofs.
    pub(super) fn contact_seeds(
        &self,
        layout: usize,
        query: &Query,
        endings: &[Vec<Segment>],
    ) -> (Vec<Candidate>, usize) {
        let world = self.world_for(layout);
        let backbone = self.backbone_for(layout);
        let mut population = Vec::new();
        let mut visited = 0;
        for arrival in &query.starts {
            if arrival.state != "available" {
                continue;
            }
            let Some(start) =
                world.project(arrival.position, world.physical.ground.options.max_vertical)
            else {
                continue;
            };
            let mut entries = Vec::<Entry>::new();
            let mut by_state = HashMap::<(usize, Contact), usize>::new();
            let mut queue = BinaryHeap::new();
            for (node, &point) in backbone.nodes.iter().enumerate() {
                if distance(start, point) >= 12. {
                    continue;
                }
                let Some(action) = world.walk(start, point) else {
                    continue;
                };
                for contact in world.contact_next(None, &action) {
                    let label = entries.len();
                    by_state.insert((node, contact), label);
                    entries.push(Entry {
                        node,
                        contact,
                        cost: action.cost(),
                        previous: Some((usize::MAX, Arc::new(action.clone()))),
                    });
                    queue.push(Label {
                        node: label,
                        cost: action.cost(),
                    });
                }
            }
            let mut found = 0;
            'search: while let Some(Label { node: label, cost }) = queue.pop() {
                if self.cancelled.load(Ordering::Relaxed) {
                    return (population, visited);
                }
                if cost > entries[label].cost {
                    continue;
                }
                visited += 1;
                let node = entries[label].node;
                let contact = entries[label].contact;
                for ending in &endings[node] {
                    if world.contact_next(contact, ending).is_empty() {
                        continue;
                    }
                    let mut path = vec![ending.clone()];
                    let mut cursor = label;
                    while let Some((from, action)) = &entries[cursor].previous {
                        path.push(action.as_ref().clone());
                        if *from == usize::MAX {
                            break;
                        }
                        cursor = *from;
                    }
                    path.reverse();
                    if let Some(candidate) = self.candidate(layout, arrival.clone(), path) {
                        if candidate.finishes_at_first_goal(query) {
                            population.push(candidate);
                            found += 1;
                            if found >= self.config.population_size {
                                break 'search;
                            }
                        }
                    }
                }
                for edge in &backbone.edges[node] {
                    for next_contact in world.contact_next(contact, &edge.action) {
                        let key = (edge.to, next_contact);
                        let next_cost = cost + edge.action.cost();
                        if let Some(&next) = by_state.get(&key) {
                            if next_cost >= entries[next].cost {
                                continue;
                            }
                            entries[next].cost = next_cost;
                            entries[next].previous = Some((label, Arc::clone(&edge.action)));
                            queue.push(Label {
                                node: next,
                                cost: next_cost,
                            });
                        } else {
                            let next = entries.len();
                            entries.push(Entry {
                                node: edge.to,
                                contact: next_contact,
                                cost: next_cost,
                                previous: Some((label, Arc::clone(&edge.action))),
                            });
                            by_state.insert(key, next);
                            queue.push(Label {
                                node: next,
                                cost: next_cost,
                            });
                        }
                    }
                }
            }
        }
        (population, visited)
    }
}
