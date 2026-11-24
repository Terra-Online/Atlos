use super::{
    Actions, ConditionalEdge, Edge, LOCAL_EDGE_RANGE, LocalEdges, Proofs, bridges, parallel_rows,
};
use crate::{flight, geometry::*, search::Label, types::*, world::World};
use serde::Serialize;
use std::{
    collections::{BinaryHeap, HashMap, HashSet},
    sync::Arc,
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stats {
    walk_candidates: usize,
    walk_proofs: usize,
    walk_pairs: usize,
    shortcut_pairs: usize,
    flight_candidates: usize,
    flight_groups: usize,
    flight_trials: usize,
    flight_proofs: usize,
    walk_degrees: [usize; 4],
    maximum_walk_degree: usize,
    short_walk_edges: usize,
    short_flight_edges: usize,
}

pub(super) struct Graph {
    pub edges: Vec<Vec<Edge>>,
    pub conditional: Vec<Vec<ConditionalEdge>>,
    pub stats: Stats,
}

fn cell([x, y, z]: Point) -> [i64; 3] {
    [
        (x / 6.).floor() as i64,
        (y / 2.).floor() as i64,
        (z / 6.).floor() as i64,
    ]
}

fn heading([x, _, z]: Point) -> u8 {
    (u8::from(x < 0.) << 2) | (u8::from(z < 0.) << 1) | u8::from(x.abs() < z.abs())
}

fn add_walk(world: &World, edges: &mut [Vec<Edge>], from: usize, to: usize, walk: Arc<Segment>) {
    let reverse = world.walk_segment(walk.points.iter().rev().copied().collect());
    edges[from].push(Edge { to, action: walk });
    edges[to].push(Edge {
        to: from,
        action: Arc::new(reverse),
    });
}

fn detours(edges: &[Vec<Edge>], from: usize, limit: f64, speed: f64) -> (HashMap<usize, f64>, f64) {
    let mut costs = HashMap::from([(from, 0.)]);
    let mut queue = BinaryHeap::from([Label {
        node: from,
        cost: 0.,
    }]);
    for _ in 0..48 {
        let Some(Label { node, cost }) = queue.pop() else {
            break;
        };
        if cost > costs[&node] {
            continue;
        }
        for edge in &edges[node] {
            let cost = cost + edge.action.cost() * speed;
            if cost > limit {
                continue;
            }
            let old = costs.entry(edge.to).or_insert(f64::INFINITY);
            if cost < *old {
                *old = cost;
                queue.push(Label {
                    node: edge.to,
                    cost,
                });
            }
        }
    }
    // Distances still at or above this frontier could improve with more work.
    let settled = queue.peek().map_or(limit, |label| label.cost);
    (costs, settled)
}

pub(super) fn build(
    world: &World,
    nodes: &[Point],
    index: &Index,
    neighbour_count: usize,
    first_port: usize,
    proofs: &Proofs,
    boosts: &[BoostUse],
) -> Graph {
    let mut neighbours = vec![Vec::new(); nodes.len()];
    parallel_rows(&mut neighbours, |from, neighbours| {
        let start = nodes[from];
        index.query(Bounds::points(&[start]).expand(LOCAL_EDGE_RANGE), |to| {
            if from != to {
                neighbours.push((distance(start, nodes[to]), to));
            }
            false
        });
        neighbours.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        neighbours.truncate(neighbour_count);
    });

    let mut stats = Stats::default();
    let mut edges: Vec<Vec<Edge>> = (0..nodes.len()).map(|_| Vec::new()).collect();
    let mut parent: Vec<_> = (0..nodes.len()).collect();
    let mut size = vec![1; nodes.len()];
    let mut tried = HashSet::new();
    for rank in 0..neighbour_count {
        let mut batch = Vec::new();
        for (from, row) in neighbours.iter().enumerate() {
            let Some(&(_, to)) = row.get(rank) else {
                continue;
            };
            let pair = (from.min(to), from.max(to));
            if bridges::root(&mut parent, from) != bridges::root(&mut parent, to)
                && tried.insert(pair)
            {
                batch.push((pair, (None, false)));
            }
        }
        parallel_rows(&mut batch, |_, ((from, to), result)| {
            *result = proofs.walk(world, nodes[*from], nodes[*to]);
        });
        stats.walk_candidates += batch.len();
        for ((from, to), (walk, checked)) in batch {
            stats.walk_proofs += usize::from(checked);
            let Some(walk) = walk else { continue };
            let mut a = bridges::root(&mut parent, from);
            let mut b = bridges::root(&mut parent, to);
            if a == b {
                continue;
            }
            if size[a] < size[b] {
                std::mem::swap(&mut a, &mut b);
            }
            parent[b] = a;
            size[a] += size[b];
            add_walk(world, &mut edges, from, to, walk);
            stats.walk_pairs += 1;
        }
    }

    let groups: Vec<_> = (0..nodes.len())
        .map(|i| bridges::root(&mut parent, i))
        .collect();
    let cells: Vec<_> = nodes.iter().copied().map(cell).collect();
    let patch = |node| (cells[node], (node >= first_port).then_some(node));
    // Keep a local crossing between neighboring patches when the forest
    // connects them through a distant branch.
    let crossing = |from: usize, to: usize| {
        let a = cells[from];
        let b = cells[to];
        let across = (a[0].abs_diff(b[0]), a[2].abs_diff(b[2]));
        (matches!(across, (1, 0) | (0, 1)) && a[1].abs_diff(b[1]) <= 1)
            .then(|| (groups[from], a.min(b), a.max(b)))
    };
    let covered: HashSet<_> = edges
        .iter()
        .enumerate()
        .flat_map(|(from, row)| row.iter().filter_map(move |edge| crossing(from, edge.to)))
        .collect();
    let mut crossings = HashMap::<_, Vec<_>>::new();
    for (from, row) in neighbours.iter().enumerate() {
        for &(length, to) in row {
            if groups[from] == groups[to]
                && let Some(key) = crossing(from, to)
                && !covered.contains(&key)
                && !tried.contains(&(from.min(to), from.max(to)))
            {
                crossings
                    .entry(key)
                    .or_default()
                    .push((length, from.min(to), from.max(to)));
            }
        }
    }
    let mut crossings: Vec<_> = crossings
        .into_iter()
        .map(|(key, pairs)| (key, pairs, None, 0, 0))
        .collect();
    crossings.sort_unstable_by_key(|row| row.0);
    parallel_rows(
        &mut crossings,
        |_, (_, candidates, chosen, attempts, physical)| {
            candidates
                .sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then((a.1, a.2).cmp(&(b.1, b.2))));
            candidates.dedup();
            for &(_, from, to) in candidates.iter().take(3) {
                let (walk, checked) = proofs.walk(world, nodes[from], nodes[to]);
                *attempts += 1;
                *physical += usize::from(checked);
                if let Some(walk) = walk {
                    *chosen = Some((from, to, walk));
                    break;
                }
            }
        },
    );
    for (_, _, chosen, attempts, physical) in crossings {
        stats.walk_candidates += attempts;
        stats.walk_proofs += physical;
        if let Some((from, to, walk)) = chosen {
            add_walk(world, &mut edges, from, to, walk);
        }
    }

    // Score a bounded detour along proved walks before nominating a shortcut.
    // Each patch chooses a single best candidate to avoid parallel edges
    // advancing along the same part of the route.
    let mut proposals = vec![None; nodes.len()];
    parallel_rows(&mut proposals, |from, proposal| {
        let candidates: Vec<_> = neighbours[from]
            .iter()
            .filter(|&&(length, to)| {
                groups[from] == groups[to]
                    && length >= 1.
                    && !edges[from].iter().any(|edge| edge.to == to)
            })
            .copied()
            .collect();
        let Some(&(max, _)) = candidates.last() else {
            return;
        };
        let speed = world.physical.locomotion.speed;
        let (costs, settled) = detours(&edges, from, max * 2. + 4., speed);
        *proposal = candidates
            .into_iter()
            .filter_map(|(length, to)| {
                let estimate = costs.get(&to).copied().unwrap_or(settled).min(settled);
                (estimate > length * 1.5 && estimate - length > 4.)
                    .then_some(((estimate - length) / length, to))
            })
            .max_by(|a, b| a.0.total_cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
    });
    let mut by_crossing = HashMap::new();
    for (from, proposal) in proposals.into_iter().enumerate() {
        if let Some((gain, to)) = proposal {
            let (a, b) = (cells[from], cells[to]);
            let key = (groups[from], a.min(b), a.max(b));
            let best = by_crossing.entry(key).or_insert((gain, from, to));
            if (gain, from, to) > *best {
                *best = (gain, from, to);
            }
        }
    }
    let mut shortcuts: Vec<_> = by_crossing
        .into_values()
        .map(|(_, from, to)| (from, to, (None, false), None))
        .collect();
    shortcuts.sort_unstable_by_key(|row| (row.0, row.1));
    parallel_rows(&mut shortcuts, |_, (from, to, result, air)| {
        *result = proofs.walk(world, nodes[*from], nodes[*to]);
        if result.0.is_none() {
            *air = Some([
                proofs.flying(world, nodes[*from], nodes[*to], boosts),
                proofs.flying(world, nodes[*to], nodes[*from], boosts),
            ]);
        }
    });
    stats.walk_candidates += shortcuts.len();
    let mut shortcut_flights = Vec::new();
    for (from, to, (walk, checked), air) in shortcuts {
        stats.walk_proofs += usize::from(checked);
        if let Some(walk) = walk {
            add_walk(world, &mut edges, from, to, walk);
            stats.shortcut_pairs += 1;
        }
        if let Some(air) = air {
            for ((from, to), (action, checked)) in [(from, to), (to, from)].into_iter().zip(air) {
                stats.flight_trials += 1;
                stats.flight_proofs += usize::from(checked);
                shortcut_flights.push((from, to, action));
            }
        }
    }

    let model = &world.physical.movement.model;
    let speed = boosts
        .iter()
        .fold(model.max_horizontal_speed, |max, boost| {
            max.max(model.max_horizontal_speed * boost.multiplier)
        });
    let impulse = flight::SprintImpulse::limit(model);
    // Small support surfaces can require precise approach and landing contacts
    // for a sequence of placements. Keep the local alternatives there.
    let near_placement: Vec<_> = nodes
        .iter()
        .map(|&node| !world.roofs.is_empty() && proofs.varies(&[node]))
        .collect();
    let mut rows: Vec<_> = (0..nodes.len())
        .map(|_| (LocalEdges::default(), 0, 0, 0, 0))
        .collect();
    parallel_rows(
        &mut rows,
        |from, (row, walks, walk_proofs, flights, flight_proofs)| {
            for &(_, to) in &neighbours[from] {
                if !(near_placement[from] || near_placement[to])
                    || edges[from].iter().any(|edge| edge.to == to)
                {
                    continue;
                }
                let (walk, checked) = proofs.walk(world, nodes[from], nodes[to]);
                *walks += 1;
                *walk_proofs += usize::from(checked);
                if let Some(walk) = walk {
                    row.push(to, Actions::Ordinary(walk));
                } else {
                    let (action, checked) = proofs.flying(world, nodes[from], nodes[to], boosts);
                    *flights += 1;
                    *flight_proofs += usize::from(checked);
                    row.push(to, action);
                }
            }
        },
    );
    let mut rows: Vec<_> = rows
        .into_iter()
        .map(|(row, walks, walk_proofs, flights, flight_proofs)| {
            stats.walk_candidates += walks;
            stats.walk_proofs += walk_proofs;
            stats.flight_trials += flights;
            stats.flight_proofs += flight_proofs;
            row
        })
        .collect();
    for (from, to, action) in shortcut_flights {
        if !near_placement[from] && !near_placement[to] {
            rows[from].push(to, action);
        }
    }
    let mut by_patch = HashMap::<_, Vec<_>>::new();
    for (from, row) in neighbours.iter().enumerate() {
        for &(length, to) in row {
            if groups[from] == groups[to] || near_placement[from] || near_placement[to] {
                continue;
            }
            let span = horizontal(nodes[from], nodes[to]);
            let start = nodes[from][1];
            let end = nodes[to][1];
            let jump = flight::duration(model, start, end).is_some_and(|t| {
                span <= (t * speed).max(impulse.map_or(0., |i| i.distance(t))) + 1e-9
            });
            let drop =
                flight::drop_duration(model, start, end).is_some_and(|t| span <= t * speed + 1e-9);
            if !jump && !drop {
                continue;
            }
            let key = (
                groups[from],
                groups[to],
                patch(from),
                patch(to),
                heading(sub(nodes[to], nodes[from])),
            );
            by_patch.entry(key).or_default().push((length, from, to));
            stats.flight_candidates += 1;
        }
    }
    let mut batches: Vec<_> = by_patch
        .into_iter()
        .map(|(key, pairs)| (key, pairs, None, 0, 0))
        .collect();
    batches.sort_unstable_by_key(|row| row.0);
    stats.flight_groups = batches.len();
    parallel_rows(&mut batches, |_, (_, pairs, edge, trials, checked)| {
        pairs.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then((a.1, a.2).cmp(&(b.1, b.2))));
        for &(_, from, to) in pairs.iter() {
            let (actions, ran) = proofs.flying(world, nodes[from], nodes[to], boosts);
            *trials += 1;
            *checked += usize::from(ran);
            if matches!(&actions, Actions::Conditional(flights) if flights.iter().all(Option::is_none))
            {
                continue;
            }
            *edge = Some((from, to, actions));
            break;
        }
    });
    for (_, _, edge, tried, checked) in batches {
        stats.flight_trials += tried;
        stats.flight_proofs += checked;
        if let Some((from, to, actions)) = edge {
            rows[from].push(to, actions);
        }
    }
    let conditional = rows
        .into_iter()
        .zip(&mut edges)
        .map(|(row, ordinary)| {
            ordinary.extend(row.ordinary);
            row.conditional
        })
        .collect::<Vec<_>>();
    let mut runups: Vec<_> = (0..nodes.len()).map(|_| (Vec::new(), 0, 0)).collect();
    parallel_rows(&mut runups, |from, (walks, attempts, physical)| {
        let mut seen = 0_u8;
        for flight in &conditional[from] {
            let delta = sub(nodes[flight.to], nodes[from]);
            let bit = 1 << heading(delta);
            if seen & bit != 0 {
                continue;
            }
            seen |= bit;
            let aligned = |to| {
                let incoming = sub(nodes[from], nodes[to]);
                let length = incoming[0].hypot(incoming[2]);
                length > 0.
                    && dot(incoming, [delta[0], 0., delta[2]])
                        >= (std::f64::consts::PI / 6.).cos() * length * delta[0].hypot(delta[2])
            };
            let available = edges[from]
                .iter()
                .filter(|e| e.action.mode == "walk" && aligned(e.to))
                .map(|e| distance(nodes[from], nodes[e.to]))
                .fold(0., f64::max);
            for &(length, to) in neighbours[from]
                .iter()
                .rev()
                .filter(|&&(length, to)| {
                    length > available * 1.25 && groups[from] == groups[to] && aligned(to)
                })
                .take(2)
            {
                if length <= 1e-9 || walks.iter().any(|(next, _)| *next == to) {
                    continue;
                }
                let (walk, checked) = proofs.walk(world, nodes[from], nodes[to]);
                *attempts += 1;
                *physical += usize::from(checked);
                if let Some(walk) = walk {
                    walks.push((to, walk));
                    break;
                }
            }
        }
    });
    for (from, (walks, attempts, physical)) in runups.into_iter().enumerate() {
        stats.walk_candidates += attempts;
        stats.walk_proofs += physical;
        for (to, walk) in walks {
            if !edges[from]
                .iter()
                .any(|edge| edge.to == to && edge.action.mode == "walk")
            {
                add_walk(world, &mut edges, from, to, walk);
            }
        }
    }
    Graph {
        edges,
        conditional,
        stats,
    }
}

impl Stats {
    pub(super) fn measure(
        &mut self,
        nodes: &[Point],
        edges: &[Vec<Edge>],
        conditional: &[Vec<ConditionalEdge>],
    ) {
        const SHORT: f64 = 4.;
        for (from, row) in edges.iter().enumerate() {
            let mut walking = Vec::new();
            for edge in row {
                let short = distance(nodes[from], nodes[edge.to]) <= SHORT;
                match edge.action.mode {
                    "walk" => {
                        if edges[edge.to]
                            .iter()
                            .any(|back| back.to == from && back.action.mode == "walk")
                            && !walking.contains(&edge.to)
                        {
                            walking.push(edge.to);
                        }
                        self.short_walk_edges += usize::from(short);
                    }
                    "jump" | "drop" => self.short_flight_edges += usize::from(short),
                    _ => {}
                }
            }
            self.short_flight_edges += conditional[from]
                .iter()
                .filter(|edge| distance(nodes[from], nodes[edge.to]) <= SHORT)
                .count();
            self.walk_degrees[walking.len().min(3)] += 1;
            self.maximum_walk_degree = self.maximum_walk_degree.max(walking.len());
        }
    }
}

pub(super) fn terminal_runups(
    world: &World,
    nodes: &[Point],
    index: &Index,
    terminals: &[(Mark, Vec<(usize, Segment)>)],
    proofs: &Proofs,
    edges: &mut [Vec<Edge>],
    stats: &mut Stats,
) {
    let mut requested = Vec::new();
    for (_, connections) in terminals {
        for (from, action) in connections {
            if action.required_gait == Some("sprint") || action.boost.is_some() {
                requested.push((*from, action.end()));
            }
        }
    }
    if requested.is_empty() {
        return;
    }
    let (groups, _) = bridges::walk_groups(edges);
    for (from, end) in requested {
        let source = nodes[from];
        let axis = sub(end, source);
        let aligned = |point: Point| {
            let approach = sub(source, point);
            let length = approach[0].hypot(approach[2]);
            length > 1e-9
                && dot(approach, [axis[0], 0., axis[2]])
                    >= (std::f64::consts::PI / 6.).cos() * length * axis[0].hypot(axis[2])
        };
        let available = edges[from]
            .iter()
            .filter(|e| e.action.mode == "walk" && aligned(nodes[e.to]))
            .map(|e| distance(source, nodes[e.to]))
            .fold(0., f64::max);
        let mut candidates = Vec::new();
        index.query(Bounds::points(&[source]).expand(LOCAL_EDGE_RANGE), |to| {
            let length = distance(source, nodes[to]);
            if groups[from] == groups[to] && length > available && aligned(nodes[to]) {
                candidates.push((length, to));
            }
            false
        });
        candidates.sort_unstable_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        for (_, to) in candidates.into_iter().take(4) {
            let (walk, checked) = proofs.walk(world, source, nodes[to]);
            stats.walk_candidates += 1;
            stats.walk_proofs += usize::from(checked);
            if let Some(walk) = walk {
                add_walk(world, edges, from, to, walk);
                break;
            }
        }
    }
}
