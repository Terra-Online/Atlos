use super::{ConditionalEdge, Edge};
use crate::{
    search::Label,
    types::{Mark, Segment},
};
use serde::Serialize;
use std::{collections::BinaryHeap, time::Instant};

pub(super) const MAX_STRETCH: f64 = 1.02;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Stats {
    forest_pairs: usize,
    shortcut_pairs: usize,
    removed_pairs: usize,
    input_degree_p95: usize,
    degree_p95: usize,
    elapsed_ms: f64,
}

fn percentile(degrees: &mut [usize]) -> usize {
    if degrees.is_empty() {
        return 0;
    }
    let rank = (degrees.len() * 95).div_ceil(100) - 1;
    *degrees.select_nth_unstable(rank).1
}

/// Preserve reciprocal walking connectivity and keep a shortcut whenever its
/// detour cannot be proved short in a bounded search over retained walks.
pub(super) fn thin(
    edges: &mut [Vec<Edge>],
    conditional: &[Vec<ConditionalEdge>],
    boosts: &[usize],
    terminals: &[(Mark, Vec<(usize, Segment)>)],
) -> Stats {
    let started = Instant::now();
    let mut ports = vec![false; edges.len()];
    for (from, row) in edges.iter().enumerate() {
        for edge in row.iter().filter(|edge| edge.action.mode != "walk") {
            ports[from] = true;
            ports[edge.to] = true;
        }
        if !conditional[from].is_empty() {
            ports[from] = true;
        }
    }
    for &boost in boosts {
        ports[boost] = true;
    }
    for (_, connections) in terminals {
        for (node, _) in connections {
            ports[*node] = true;
        }
    }

    let mut pairs = Vec::new();
    for (from, row) in edges.iter().enumerate() {
        for (index, edge) in row.iter().enumerate() {
            if edge.to <= from || edge.action.mode != "walk" {
                continue;
            }
            if row[..index]
                .iter()
                .any(|prior| prior.to == edge.to && prior.action.mode == "walk")
            {
                continue;
            }
            if let Some(reverse) = edges[edge.to]
                .iter()
                .position(|back| back.to == from && back.action.mode == "walk")
            {
                let reverse_cost = edges[edge.to][reverse].action.cost();
                let cost = edge.action.cost();
                pairs.push((
                    cost.max(reverse_cost),
                    cost.min(reverse_cost),
                    from,
                    edge.to,
                    index,
                    reverse,
                ));
            }
        }
    }
    pairs.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then((a.2, a.3).cmp(&(b.2, b.3))));
    let mut parent: Vec<_> = (0..edges.len()).collect();
    let mut sizes = vec![1; edges.len()];
    let mut retained = vec![Vec::new(); edges.len()];
    let mut remove: Vec<_> = edges.iter().map(|row| vec![false; row.len()]).collect();
    let mut degrees: Vec<_> = edges.iter().map(Vec::len).collect();
    let mut stats = Stats {
        input_degree_p95: percentile(&mut degrees),
        ..Stats::default()
    };
    let mut pending = Vec::new();
    let keep = |graph: &mut [Vec<(usize, f64)>], from: usize, to: usize, cost| {
        graph[from].push((to, cost));
        graph[to].push((from, cost));
    };
    for (cost, low, from, to, index, reverse) in pairs {
        let mut a = super::bridges::root(&mut parent, from);
        let mut b = super::bridges::root(&mut parent, to);
        if a != b {
            if sizes[a] < sizes[b] {
                std::mem::swap(&mut a, &mut b);
            }
            parent[b] = a;
            sizes[a] += sizes[b];
            keep(&mut retained, from, to, cost);
            stats.forest_pairs += 1;
        } else {
            pending.push((cost, low, from, to, index, reverse));
        }
    }
    let mut distances = vec![f64::INFINITY; edges.len()];
    let mut touched = Vec::new();
    let mut queue = BinaryHeap::new();
    for (cost, low, from, to, index, reverse) in pending {
        let mut short = false;
        if !ports[from] && !ports[to] {
            let limit = low * MAX_STRETCH + 1e-9;
            distances[from] = 0.;
            touched.push(from);
            queue.push(Label {
                node: from,
                cost: 0.,
            });
            // Keep the direct edge when the local proof budget is exhausted.
            for _ in 0..24 {
                let Some(Label { node, cost }) = queue.pop() else {
                    break;
                };
                if node == to {
                    short = true;
                    break;
                }
                if cost > distances[node] {
                    continue;
                }
                for &(next, walk) in &retained[node] {
                    let cost = cost + walk;
                    if cost <= limit && cost < distances[next] {
                        if distances[next].is_infinite() {
                            touched.push(next);
                        }
                        distances[next] = cost;
                        queue.push(Label { node: next, cost });
                    }
                }
            }
            queue.clear();
            for node in touched.drain(..) {
                distances[node] = f64::INFINITY;
            }
        }
        if short {
            remove[from][index] = true;
            remove[to][reverse] = true;
            stats.removed_pairs += 1;
        } else {
            keep(&mut retained, from, to, cost);
            stats.shortcut_pairs += 1;
        }
    }
    degrees.clear();
    for (row, removed) in edges.iter_mut().zip(remove) {
        let mut removed = removed.into_iter();
        row.retain(|_| !removed.next().unwrap());
        degrees.push(row.len());
    }
    stats.degree_p95 = percentile(&mut degrees);
    stats.elapsed_ms = started.elapsed().as_secs_f64() * 1000.;
    stats
}
