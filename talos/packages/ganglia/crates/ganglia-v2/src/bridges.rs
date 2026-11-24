#[path = "bridge_regions.rs"]
mod regions;

use super::{ConditionalEdge, Edge, LOCAL_EDGE_RANGE, Proofs};
use crate::{flight, geometry::*, placement, region_flight, types::*, world::World};
use regions::Regions;
use serde::Serialize;
use std::{
    cmp::Reverse,
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

// Keep the extra physics work bounded independently of the size of a scene.
const LEDGE_TRIALS: usize = 192;
const BOX_REGION_TRIALS: usize = 24;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Discovery {
    walk_groups: usize,
    ledge_regions: usize,
    ledge_bounds_checks: usize,
    ledge_bounds_pruned: usize,
    ledge_patch_pairs: usize,
    ledge_contact_checks: usize,
    ledge_contact_pairs: usize,
    ledge_pairs: usize,
    ledge_tried_pairs: usize,
    ledge_enumeration_ms: f64,
    ledge_trials: usize,
    ledge_flights: usize,
    sprint_bridge_trials: usize,
    sprint_bridges: usize,
    sprint_bridge_ms: f64,
    box_searches: Vec<region_flight::Search>,
    elapsed_ms: f64,
}

impl Discovery {
    pub(super) fn discover_sprint(
        &mut self,
        world: &World,
        nodes: &[Point],
        edges: &[Vec<Edge>],
        conditional: &mut [Vec<ConditionalEdge>],
        index: &Index,
        proofs: &Proofs,
    ) {
        const TRIALS_PER_DEPARTURE: usize = 6;
        let started = Instant::now();
        let model = &world.physical.movement.model;
        let run = world.physical.movement.run_air_speed;
        let sprint = model.max_horizontal_speed;
        let impulse = flight::SprintImpulse::limit(model);
        if sprint <= run && impulse.is_none() {
            return;
        }
        let jump_span = |time| impulse.map_or(sprint * time, |i| i.distance(time));
        let mut approaches = vec![Vec::new(); nodes.len()];
        for (from, outgoing) in edges.iter().take(nodes.len()).enumerate() {
            for edge in outgoing {
                if edge.to < nodes.len() && edge.action.mode == "walk" {
                    let delta = sub(nodes[edge.to], nodes[from]);
                    let span = delta[0].hypot(delta[2]);
                    if span > 1e-9 {
                        approaches[edge.to].push(scale(delta, 1. / span));
                    }
                }
            }
        }
        let prove = |from: usize,
                     outgoing: &mut Vec<ConditionalEdge>,
                     candidates: &mut [Vec<(f64, usize)>; 2]| {
            let start = nodes[from];
            let mut trials = 0;
            let mut bridges = 0;
            candidates.iter_mut().for_each(Vec::clear);
            let origin = Bounds::points(&[start]);
            index.query_where(
                |bounds| {
                    start[1] - bounds.min[1] > LOCAL_EDGE_RANGE
                        && reaches(model, jump_span, origin, bounds)
                },
                |to| {
                    let Some(&end) = nodes.get(to) else {
                        return false;
                    };
                    let delta = sub(end, start);
                    let span = delta[0].hypot(delta[2]);
                    let jump_time = flight::duration(model, start[1], end[1]);
                    let constant = [jump_time, flight::drop_duration(model, start[1], end[1])]
                        .into_iter()
                        .flatten()
                        .find(|&time| time <= 60. && span > run * time && span <= sprint * time);
                    let candidate = constant.map(|time| (0, time)).or_else(|| {
                        jump_time
                            .filter(|&time| {
                                time <= 60.
                                    && span > run.max(sprint) * time + 1e-9
                                    && span <= jump_span(time) + 1e-9
                            })
                            .map(|time| (1, time))
                    });
                    if let Some((family, time)) = candidate
                        && approaches[from].iter().any(|approach| {
                            approach[0] * delta[0] + approach[2] * delta[2]
                                >= span * (std::f64::consts::PI / 6.).cos()
                        })
                    {
                        candidates[family].push((span / time, to));
                    }
                    false
                },
            );
            // Prefer rapid clearance from takeoff terrain. Give the wider
            // impulse envelope its own small budget so that it cannot crowd
            // existing long drops and jumps out of the sweep.
            let rank = |a: &(f64, usize), b: &(f64, usize)| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1));
            for (candidates, (trial_limit, landing_limit)) in candidates
                .iter_mut()
                .zip([(TRIALS_PER_DEPARTURE, 2), (2, 1)])
            {
                if candidates.len() > trial_limit {
                    candidates.select_nth_unstable_by(trial_limit, rank);
                    candidates.truncate(trial_limit);
                }
                candidates.sort_unstable_by(rank);
                let mut landings = 0;
                for &(_, to) in candidates.iter() {
                    trials += 1;
                    let mut proved = false;
                    for flight in proofs
                        .sprint_bridge(world, start, nodes[to])
                        .into_iter()
                        .flatten()
                    {
                        outgoing.push(ConditionalEdge { to, flight });
                        bridges += 1;
                        proved = true;
                    }
                    landings += usize::from(proved);
                    if landings == landing_limit {
                        break;
                    }
                }
            }
            (trials, bridges)
        };
        // Each departure selects and proves its own edges. Assign disjoint
        // rows in batches to balance dense cliffs against open terrain.
        const CHUNK: usize = 128;
        let rows = Mutex::new(conditional[..nodes.len()].chunks_mut(CHUNK).enumerate());
        let workers =
            thread::available_parallelism().map_or(1, |count| (count.get() / 2).clamp(1, 6));
        let (trials, bridges) = thread::scope(|scope| {
            let handles: Vec<_> = (0..workers.min(nodes.len().div_ceil(CHUNK)))
                .map(|_| {
                    scope.spawn(|| {
                        let mut candidates = [Vec::new(), Vec::new()];
                        let mut trials = 0;
                        let mut bridges = 0;
                        loop {
                            let Some((chunk, rows)) = rows.lock().unwrap().next() else {
                                break;
                            };
                            for (offset, outgoing) in rows.iter_mut().enumerate() {
                                let from = chunk * CHUNK + offset;
                                if !approaches[from].is_empty() {
                                    let (row_trials, row_bridges) =
                                        prove(from, outgoing, &mut candidates);
                                    trials += row_trials;
                                    bridges += row_bridges;
                                }
                            }
                        }
                        (trials, bridges)
                    })
                })
                .collect();
            handles
                .into_iter()
                .fold((0, 0), |(trials, bridges), handle| {
                    let (worker_trials, worker_bridges) = handle.join().unwrap();
                    (trials + worker_trials, bridges + worker_bridges)
                })
        });
        self.sprint_bridge_trials = trials;
        self.sprint_bridges = bridges;
        self.sprint_bridge_ms = started.elapsed().as_secs_f64() * 1000.;
        self.elapsed_ms += self.sprint_bridge_ms;
    }
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
    for (from, to, action) in ledge_flights(world, nodes, edges, ledges, support_count, &mut stats)
    {
        add_edge(edges, from, to, action);
        connected.insert((groups[from], groups[to]));
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

struct Patch {
    region: usize,
    bounds: Bounds,
    contacts: Vec<usize>,
}

fn patches(
    nodes: &[Point],
    contacts: impl Iterator<Item = usize>,
    regions: &Regions,
) -> Vec<Patch> {
    let mut cells = BTreeMap::<_, Vec<_>>::new();
    for node in contacts {
        let [x, y, z] = nodes[node];
        // Match the ground sampling scale while keeping stacked supports in
        // narrow height ranges. Every patch belongs to one directed region.
        let cell = (
            (x / 4.).floor() as i64,
            y.floor() as i64,
            (z / 4.).floor() as i64,
        );
        cells
            .entry((regions.node[node], cell))
            .or_default()
            .push(node);
    }
    cells
        .into_iter()
        .map(|((region, _), contacts)| {
            let bounds =
                Bounds::points(&contacts.iter().map(|&node| nodes[node]).collect::<Vec<_>>());
            Patch {
                region,
                bounds,
                contacts,
            }
        })
        .collect()
}

/// Reject a whole index branch using its highest possible departure, the
/// lowest landing, and the closest possible horizontal span.
fn reaches(model: &Model, span: impl FnOnce(f64) -> f64, from: Bounds, to: Bounds) -> bool {
    let duration = flight::duration(model, from.max[1], to.min[1])
        .or_else(|| flight::drop_duration(model, from.max[1], to.min[1]));
    duration.is_some_and(|time| {
        let dx = (from.min[0] - to.max[0])
            .max(to.min[0] - from.max[0])
            .max(0.);
        let dz = (from.min[2] - to.max[2])
            .max(to.min[2] - from.max[2])
            .max(0.);
        dx * dx + dz * dz <= (span(time.min(60.)) + 1e-9).powi(2)
    })
}

fn ledge_flights(
    world: &World,
    nodes: &[Point],
    edges: &[Vec<Edge>],
    ledges: &[usize],
    support_count: usize,
    stats: &mut Discovery,
) -> Vec<(usize, usize, Segment)> {
    if ledges.is_empty() {
        return Vec::new();
    }
    let started = Instant::now();
    let regions = Regions::new(edges);
    stats.ledge_regions = regions.count();
    let model = &world.physical.movement.model;
    let speed = model
        .max_horizontal_speed
        .min(world.physical.movement.run_air_speed);
    let span = |time| time * speed;
    let departures = patches(nodes, ledges.iter().copied(), &regions);
    let index = Index::new(
        &departures
            .iter()
            .map(|patch| patch.bounds)
            .collect::<Vec<_>>(),
    );
    let landings = patches(nodes, 0..support_count, &regions);
    let mut proposed = HashMap::<_, Vec<(f64, usize, usize)>>::new();
    for landing in landings {
        index.query_where(
            |bounds| {
                stats.ledge_bounds_checks += 1;
                let possible = reaches(model, span, bounds, landing.bounds);
                stats.ledge_bounds_pruned += usize::from(!possible);
                possible
            },
            |candidate| {
                stats.ledge_patch_pairs += 1;
                let departure = &departures[candidate];
                let pair = (departure.region, landing.region);
                if regions.has_connection(pair) {
                    return false;
                }
                // Refine only across patches whose regions still need a
                // directed connection. Exact contacts keep the bounds safe.
                for &from in &departure.contacts {
                    let origin = Bounds::points(&[nodes[from]]);
                    if !reaches(model, span, origin, landing.bounds) {
                        continue;
                    }
                    for &to in &landing.contacts {
                        stats.ledge_contact_checks += 1;
                        if !reaches(model, span, origin, Bounds::points(&[nodes[to]])) {
                            continue;
                        }
                        stats.ledge_contact_pairs += 1;
                        let choices = proposed.entry(pair).or_default();
                        choices.push((distance(nodes[from], nodes[to]), from, to));
                        choices.sort_unstable_by(|a, b| {
                            a.0.total_cmp(&b.0).then((a.1, a.2).cmp(&(b.1, b.2)))
                        });
                        choices.truncate(4);
                    }
                }
                false
            },
        );
    }
    stats.ledge_pairs = proposed.len();
    let mut proposals: Vec<_> = proposed.into_iter().collect();
    proposals.sort_by(|a, b| {
        Reverse(regions.influence(a.0))
            .cmp(&Reverse(regions.influence(b.0)))
            .then_with(|| a.1[0].0.total_cmp(&b.1[0].0))
            .then_with(|| a.0.cmp(&b.0))
    });
    stats.ledge_enumeration_ms = started.elapsed().as_secs_f64() * 1000.;
    let mut flights = Vec::new();
    let mut solved = HashSet::new();
    for attempt in 0..4 {
        for (pair, choices) in &proposals {
            let Some(&(_, from, to)) = choices.get(attempt).filter(|_| !solved.contains(pair))
            else {
                continue;
            };
            if stats.ledge_trials == LEDGE_TRIALS {
                return flights;
            }
            stats.ledge_trials += 1;
            stats.ledge_tried_pairs += usize::from(attempt == 0);
            if let Some(action) = world
                .drop(nodes[from], nodes[to])
                .or_else(|| world.jump(nodes[from], nodes[to], None))
            {
                flights.push((from, to, action));
                solved.insert(*pair);
                stats.ledge_flights += 1;
            }
        }
    }
    flights
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
