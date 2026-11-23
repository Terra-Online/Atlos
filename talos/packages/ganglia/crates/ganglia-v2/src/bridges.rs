use super::Edge;
use crate::{flight, geometry::*, placement, region_flight, types::*, world::World};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
    time::Instant,
};

// Keep the extra physics work bounded independently of the size of a scene.
const LEDGE_TRIALS: usize = 192;
const BOX_REGION_TRIALS: usize = 24;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Discovery {
    walk_groups: usize,
    ledge_pairs: usize,
    ledge_trials: usize,
    ledge_flights: usize,
    box_searches: Vec<region_flight::Search>,
    elapsed_ms: f64,
}

fn root(parents: &mut [usize], mut node: usize) -> usize {
    while parents[node] != node {
        parents[node] = parents[parents[node]];
        node = parents[node];
    }
    node
}

fn walk_groups(edges: &[Vec<Edge>]) -> (Vec<usize>, Vec<usize>) {
    let mut parents: Vec<_> = (0..edges.len()).collect();
    let mut sizes = vec![1; edges.len()];
    // Walk groups only prioritize proposals. Every admitted edge is directed
    // and its actual walk and flight segments are still checked.
    for (from, outgoing) in edges.iter().enumerate() {
        for edge in outgoing.iter().filter(|e| e.action.mode == "walk") {
            let mut a = root(&mut parents, from);
            let mut b = root(&mut parents, edge.to);
            if a == b {
                continue;
            }
            if sizes[a] < sizes[b] {
                std::mem::swap(&mut a, &mut b);
            }
            parents[b] = a;
            sizes[a] += sizes[b];
            sizes[b] = 0;
        }
    }
    let groups = (0..edges.len()).map(|i| root(&mut parents, i)).collect();
    (groups, sizes)
}

fn add_edge(edges: &mut [Vec<Edge>], from: usize, to: usize, action: Segment) {
    if from != to {
        edges[from].push(Edge {
            to,
            action: Arc::new(action),
        });
    }
}

pub(super) fn discover(
    world: &World,
    placements: &[Placement],
    nodes: &mut Vec<Point>,
    edges: &mut Vec<Vec<Edge>>,
    index: &Index,
    ledges: &[usize],
    support_count: usize,
) -> Discovery {
    let started = Instant::now();
    let (groups, sizes) = walk_groups(edges);
    let mut stats = Discovery {
        walk_groups: sizes.iter().filter(|&&size| size > 0).count(),
        ..Discovery::default()
    };
    let model = &world.physical.movement.model;
    let speed = model
        .max_horizontal_speed
        .min(world.physical.movement.run_air_speed);
    let local_radius = flight::duration(model, 0., 0.).unwrap_or(0.) * speed;
    let mut connected = HashSet::new();
    for (from, outgoing) in edges.iter().enumerate() {
        for edge in outgoing {
            if groups[from] != groups[edge.to] {
                connected.insert((groups[from], groups[edge.to]));
            }
        }
    }
    let mut proposed = BTreeMap::<_, Vec<(f64, usize, usize)>>::new();
    for &from in ledges {
        let start = nodes[from];
        let mut bounds = Bounds::points(&[start]).expand(local_radius);
        bounds.min[1] = f64::NEG_INFINITY;
        bounds.max[1] = start[1] + model.max_jump_height;
        index.query(bounds, |to| {
            if to >= support_count {
                return false;
            }
            let pair = (groups[from], groups[to]);
            if pair.0 == pair.1 || connected.contains(&pair) {
                return false;
            }
            let end = nodes[to];
            let span = horizontal(start, end);
            if [
                flight::duration(model, start[1], end[1]),
                flight::drop_duration(model, start[1], end[1]),
            ]
            .into_iter()
            .flatten()
            .any(|time| time <= 60. && span <= time * speed + 1e-9)
            {
                let choices = proposed.entry(pair).or_default();
                choices.push((distance(start, end), from, to));
                choices
                    .sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then((a.1, a.2).cmp(&(b.1, b.2))));
                choices.truncate(4);
            }
            false
        });
    }
    stats.ledge_pairs = proposed.len();
    let mut proposals: Vec<_> = proposed.into_iter().collect();
    proposals.sort_by_key(|&((a, b), _)| std::cmp::Reverse(sizes[a].min(sizes[b])));
    for (pair, choices) in proposals {
        for (_, from, to) in choices {
            if stats.ledge_trials == LEDGE_TRIALS {
                break;
            }
            stats.ledge_trials += 1;
            if let Some(action) = world
                .drop(nodes[from], nodes[to])
                .or_else(|| world.jump(nodes[from], nodes[to], None))
            {
                add_edge(edges, from, to, action);
                connected.insert(pair);
                stats.ledge_flights += 1;
                break;
            }
        }
        if stats.ledge_trials == LEDGE_TRIALS {
            break;
        }
    }

    let vertical = world.physical.ground.options.max_vertical;
    for body in placement::placed_bounds(&world.physical, placements) {
        let roof = Bounds {
            min: [body.min[0], body.max[1], body.min[2]],
            max: [body.max[0], body.max[1] + vertical, body.max[2]],
        };
        let center = lerp(roof.min, roof.max, 0.5);
        let mut on_roof = None;
        index.query(roof, |i| {
            if i < support_count
                && on_roof
                    .is_none_or(|best| distance(nodes[i], center) < distance(nodes[best], center))
            {
                on_roof = Some(i);
            }
            false
        });
        let Some(on_roof) = on_roof else { continue };
        let mut nearby = BTreeMap::<_, (f64, usize)>::new();
        let mut vicinity = body.expand(local_radius);
        vicinity.min[1] = body.min[1] - model.max_jump_height;
        vicinity.max[1] = roof.max[1] + model.max_jump_height;
        index.query(vicinity, |i| {
            if i < support_count && groups[i] != groups[on_roof] {
                let d = distance(nodes[i], center);
                let offset = sub(nodes[i], center);
                let axis = if offset[0].abs() >= offset[2].abs() {
                    0
                } else {
                    2
                };
                let side = (axis, offset[axis].is_sign_positive());
                // The same walk group can approach from both sides of a box.
                // Preserve the shorter approaches for different arrivals.
                let entry = nearby.entry((groups[i], side)).or_insert((d, i));
                if (d, i) < *entry {
                    *entry = (d, i);
                }
            }
            false
        });
        let mut nearby: Vec<_> = nearby.into_values().collect();
        nearby.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut bridged = HashSet::new();
        for (_, neighbor) in nearby {
            let point = nodes[neighbor];
            let direction = [point[0] - center[0], 0., point[2] - center[2]];
            let length = horizontal(center, point);
            // The closest sample can be against a fence. Search farther
            // inside its region and still require a walk back to that sample.
            let inset = if length > 0. {
                scale(direction, vertical / length * 2.)
            } else {
                [0.; 3]
            };
            let mut surface = Bounds::points(&[add(point, inset)]).expand(1.5);
            surface.min[1] = nodes[neighbor][1] - vertical;
            surface.max[1] = nodes[neighbor][1] + vertical;
            for (source, target, from, to) in [
                (surface, roof, neighbor, on_roof),
                (roof, surface, on_roof, neighbor),
            ] {
                if stats.box_searches.len() == BOX_REGION_TRIALS {
                    break;
                }
                let pair = (groups[from], groups[to]);
                if connected.contains(&pair) {
                    continue;
                }
                let (flight, report) =
                    region_flight::find_attached(world, source, target, |flight| {
                        Some((
                            world.walk(nodes[from], flight.start())?,
                            world.walk(flight.end(), nodes[to])?,
                        ))
                    });
                stats.box_searches.push(report);
                if let Some((flight, (approach, exit))) = flight {
                    let start = port(nodes, edges, flight.start());
                    let end = port(nodes, edges, flight.end());
                    add_edge(edges, from, start, approach);
                    add_edge(edges, start, end, flight);
                    add_edge(edges, end, to, exit);
                    bridged.insert(pair);
                }
            }
            if stats.box_searches.len() == BOX_REGION_TRIALS {
                break;
            }
        }
        connected.extend(bridged);
    }
    stats.elapsed_ms = started.elapsed().as_secs_f64() * 1000.;
    stats
}

fn port(nodes: &mut Vec<Point>, edges: &mut Vec<Vec<Edge>>, point: Point) -> usize {
    if let Some(index) = nodes.iter().position(|&node| node == point) {
        return index;
    }
    let index = nodes.len();
    nodes.push(point);
    edges.push(Vec::new());
    index
}
