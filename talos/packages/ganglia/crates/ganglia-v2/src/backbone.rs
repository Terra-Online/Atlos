use crate::{flight::PreparedFlight, geometry::*, region_flight, types::*, world::World};
#[path = "bridges.rs"]
mod bridges;
use std::{
    collections::{BTreeMap, HashMap},
    hash::{DefaultHasher, Hash, Hasher},
    sync::{Arc, Mutex},
    thread,
    time::Instant,
};

type Pair = [[u64; 3]; 2];

#[derive(Clone)]
enum Actions {
    Ordinary(Arc<Segment>),
    Conditional([Option<Arc<PreparedFlight>>; 2]),
}

struct ProofShard {
    pairs: HashMap<Pair, Actions>,
    hits: usize,
}

// Layouts share exact proofs, including misses, if their only varying geometry
// cannot affect the motion. Even recursive walk projection keeps XZ between
// the endpoints. Ignore Y in this check so elevated jumps cannot evade it.
pub(super) struct Proofs {
    affected: Index,
    padding: f64,
    shards: Vec<Mutex<ProofShard>>,
}
impl Proofs {
    pub fn new(bounds: Vec<Bounds>, profile: &Profile, reuse: bool) -> Self {
        Self {
            affected: Index::new(&bounds),
            // Larger than the capsule sweep, support and projection margins.
            padding: profile.radius + 1.,
            shards: (0..if reuse { 64 } else { 0 })
                .map(|_| {
                    Mutex::new(ProofShard {
                        pairs: HashMap::new(),
                        hits: 0,
                    })
                })
                .collect(),
        }
    }

    fn actions(&self, world: &World, from: Point, to: Point, boosts: &[BoostUse]) -> Actions {
        let prove = || match world.action(from, to) {
            Some(action) => Actions::Ordinary(Arc::new(action)),
            None => Actions::Conditional(
                world
                    .conditional_flights(from, to, boosts)
                    .map(|a| a.map(Arc::new)),
            ),
        };
        if self.shards.is_empty() {
            return prove();
        }
        let mut bounds = Bounds::points(&[from, to]).expand(self.padding);
        bounds.min[1] = f64::NEG_INFINITY;
        bounds.max[1] = f64::INFINITY;
        if self.affected.query(bounds, |_| true) {
            return prove();
        }
        let key = [from.map(f64::to_bits), to.map(f64::to_bits)];
        let mut hash = DefaultHasher::new();
        key.hash(&mut hash);
        let shard = &self.shards[hash.finish() as usize % self.shards.len()];
        {
            let mut saved = shard.lock().unwrap();
            if let Some(actions) = saved.pairs.get(&key).cloned() {
                saved.hits += 1;
                return actions;
            }
        }
        let actions = prove();
        shard.lock().unwrap().pairs.insert(key, actions.clone());
        actions
    }

    pub fn stats(&self) -> (usize, usize) {
        self.shards.iter().fold((0, 0), |(count, hits), shard| {
            let saved = shard.lock().unwrap();
            (count + saved.pairs.len(), hits + saved.hits)
        })
    }
}

pub(super) struct Edge {
    pub to: usize,
    pub action: Arc<Segment>,
}
pub(super) struct ConditionalEdge {
    pub to: usize,
    pub flight: Arc<PreparedFlight>,
}
pub(super) const LOCAL_EDGE_RANGE: f64 = 12.;
pub(super) struct Backbone {
    pub nodes: Vec<Point>,
    pub edges: Vec<Vec<Edge>>,
    pub boosts: Vec<usize>,
    pub conditional: Vec<Vec<ConditionalEdge>>,
    pub boost_uses: Vec<BoostUse>,
    pub preparation_ms: [f64; 4],
    pub proved_link_count: usize,
    pub region_flights: Vec<region_flight::Search>,
    pub automatic_bridges: bridges::Discovery,
    pub terminals: Vec<(Mark, Vec<(usize, Segment)>)>,
}
impl Backbone {
    pub fn build(
        world: &World,
        marks: Vec<Mark>,
        anchors: Vec<Point>,
        links: &[Link],
        proofs: &Proofs,
        placements: &[Placement],
    ) -> Self {
        let profile = std::env::var_os("GANGLIA_PROFILE").is_some();
        let started = std::time::Instant::now();
        // Sparse interior representatives plus ledge samples. The lattice is a
        // discovery heuristic, not a completeness claim: missed connectivity is
        // deliberately left unavailable until the next construction strategy.
        let key = |p: Point, size: f64| {
            [
                (p[0] / size).floor() as i64,
                p[1].floor() as i64,
                (p[2] / size).floor() as i64,
            ]
        };
        let vertex_key = |p: Point| p.map(|v| (v * 10000.).round() as i64);
        let mut interior = BTreeMap::new();
        let mut boundaries: BTreeMap<([i64; 3], [i64; 3]), (usize, Point, Point, Point)> =
            BTreeMap::new();
        for surface in world
            .physical
            .ground
            .surfaces
            .iter()
            .chain(world.roofs.iter())
        {
            if surface.vertices.len() < 3 {
                continue;
            }
            let center = scale(
                surface.vertices.iter().copied().fold([0.; 3], add),
                1. / surface.vertices.len() as f64,
            );
            interior.entry(key(center, 4.)).or_insert(center);
            for (i, &a) in surface.vertices.iter().enumerate() {
                let b = surface.vertices[(i + 1) % surface.vertices.len()];
                let ka = vertex_key(a);
                let kb = vertex_key(b);
                let edge = if ka < kb { (ka, kb) } else { (kb, ka) };
                boundaries
                    .entry(edge)
                    .and_modify(|entry| entry.0 += 1)
                    .or_insert((1, a, b, center));
            }
        }
        let mut ledges = BTreeMap::new();
        for (_, (count, a, b, center)) in boundaries {
            if count != 1 {
                continue;
            }
            let steps = (horizontal(a, b) / 3.).ceil().max(1.) as usize;
            for i in 0..steps {
                let edge = lerp(a, b, (i as f64 + 0.5) / steps as f64);
                let point = lerp(edge, center, 0.05);
                ledges.entry(key(point, 2.)).or_insert(point);
            }
        }
        // Reduce work on large windows. Height bins and the separate, denser
        // ledge lattice preserve samples for stacked floors and takeoffs.
        const SAMPLE_TARGET: f64 = 85_000.;
        let spacing_scale =
            (((interior.len() + ledges.len()) as f64 / SAMPLE_TARGET).sqrt()).clamp(1., 2.);
        let standing = |p| {
            world
                .standing(p)
                .filter(|&point| !world.blocked(point, point, 0.))
        };
        let representatives = |samples: BTreeMap<_, Point>, spacing| {
            let mut retained = BTreeMap::new();
            for (cell, sample) in samples {
                let Some(feet) = standing(sample) else {
                    continue;
                };
                let group = if spacing_scale > 1. {
                    key(feet, spacing)
                } else {
                    cell
                };
                retained.entry(group).or_insert(feet);
            }
            retained.into_values()
        };
        let interiors = representatives(interior, 4. * spacing_scale);
        let ledges = representatives(ledges, 2. * spacing_scale);
        let ledge_nodes: Vec<_> = (interiors.len()..interiors.len() + ledges.len()).collect();
        let mut nodes: Vec<_> = interiors
            .chain(ledges)
            .chain(
                anchors
                    .into_iter()
                    .chain(world.box_contacts())
                    .filter_map(standing),
            )
            .collect();
        let neighbour_count = (24. / spacing_scale).round() as usize;
        let support_count = nodes.len();
        let samples_ms = started.elapsed().as_secs_f64() * 1000.;
        let ports_started = Instant::now();
        // Authored traversal ports are critical nodes even when lattice
        // representatives omit their small interaction volumes.
        let launches = crate::devices::launches(world, &nodes, &marks);
        let devices: Vec<_> = crate::devices::ropes(world)
            .into_iter()
            .chain(crate::devices::rope_drops(world))
            .chain(launches.edges)
            .chain(crate::devices::rides(world))
            .collect();
        // A free pad can have many outgoing flights from the same launch point.
        // Share that port so duplicate coordinates cannot consume its neighbours.
        let mut ports: BTreeMap<_, _> = nodes
            .iter()
            .enumerate()
            .map(|(index, point)| (point.map(f64::to_bits), index))
            .collect();
        let mut port = |point: Point| {
            *ports.entry(point.map(f64::to_bits)).or_insert_with(|| {
                let index = nodes.len();
                nodes.push(point);
                index
            })
        };
        let devices: Vec<_> = devices
            .into_iter()
            .map(|action| (port(action.start()), port(action.end()), action))
            .collect();
        let launch_terminals: Vec<_> = launches
            .terminals
            .into_iter()
            .map(|(mark, action)| (mark, port(action.start()), action))
            .collect();
        let boosts = crate::devices::boost_contacts(world)
            .into_iter()
            .map(&mut port)
            .collect();
        let boost_uses: Vec<_> = world
            .physical
            .devices
            .iter()
            .flat_map(|facts| &facts.devices)
            .filter_map(crate::devices::boost_usage)
            .collect();
        // Landmarks can still be crowded out by nearby generated samples.
        // Authored links nominate a pair directly, with the same standing and
        // resource-aware motion proofs as automatically discovered edges.
        let mut region_flights = Vec::new();
        let annotated: Vec<_> = links
            .iter()
            .filter_map(|link| {
                let (from, to) = match *link {
                    Link::Points { from, to } => (from, to),
                    Link::FlightRegions { from, to } => {
                        let (action, search) = region_flight::find(world, from, to);
                        region_flights.push(search);
                        let action = action?;
                        return Some((
                            port(action.start()),
                            port(action.end()),
                            Actions::Ordinary(Arc::new(action)),
                        ));
                    }
                };
                let prove = || {
                    let from = world.standing(from)?;
                    let to = world.standing(to)?;
                    if world.blocked(from, from, 0.) || world.blocked(to, to, 0.) {
                        return None;
                    }
                    let actions = proofs.actions(world, from, to, &boost_uses);
                    if matches!(&actions, Actions::Conditional(flights) if flights.iter().all(Option::is_none))
                    {
                        return None;
                    }
                    Some((from, to, actions))
                };
                let proof = prove();
                if profile && proof.is_none() {
                    eprintln!("ganglia-v2 rejected link {from:?} to {to:?}");
                }
                let (from, to, actions) = proof?;
                Some((port(from), port(to), actions))
            })
            .collect();
        let index = Index::new(
            &nodes
                .iter()
                .map(|p| Bounds::points(&[*p]))
                .collect::<Vec<_>>(),
        );
        let ports_ms = ports_started.elapsed().as_secs_f64() * 1000.;
        let mut edges: Vec<Vec<Edge>> = (0..nodes.len()).map(|_| Vec::new()).collect();
        let mut conditional: Vec<Vec<ConditionalEdge>> =
            (0..nodes.len()).map(|_| Vec::new()).collect();
        let edges_started = Instant::now();
        if profile {
            eprintln!(
                "ganglia-v2 backbone: {} nodes, {} device actions",
                nodes.len(),
                devices.len()
            );
        }
        // Scenario benchmark workers already run concurrently. Leave half the
        // machine available to the other worker. Write disjoint adjacency rows
        // so scheduling cannot change discovery order within a row.
        let workers =
            thread::available_parallelism().map_or(1, |count| (count.get() / 2).clamp(1, 6));
        const CHUNK: usize = 256;
        let chunks = Mutex::new(
            edges
                .chunks_mut(CHUNK)
                .zip(conditional.chunks_mut(CHUNK))
                .enumerate(),
        );
        thread::scope(|scope| {
            for _ in 0..workers.min(nodes.len().div_ceil(CHUNK)) {
                let nodes = &nodes;
                let index = &index;
                let boost_uses = &boost_uses;
                let chunks = &chunks;
                scope.spawn(move || {
                    let mut nearby = Vec::new();
                    loop {
                        // Dense geometry makes adjacent rows very different
                        // in cost. Draw another batch when a worker finishes.
                        let Some((chunk, (edges, conditional))) = chunks.lock().unwrap().next()
                        else {
                            break;
                        };
                        for (row, (edges, conditional)) in
                            edges.iter_mut().zip(conditional).enumerate()
                        {
                            let i = chunk * CHUNK + row;
                            let a = nodes[i];
                            nearby.clear();
                            index.query(Bounds::points(&[a]).expand(LOCAL_EDGE_RANGE), |j| {
                                if i != j {
                                    nearby.push(j);
                                }
                                false
                            });
                            nearby.sort_unstable_by(|&j, &k| {
                                distance(a, nodes[j]).total_cmp(&distance(a, nodes[k]))
                            });
                            for &j in nearby.iter().take(neighbour_count) {
                                match proofs.actions(world, a, nodes[j], boost_uses) {
                                    Actions::Ordinary(action) => edges.push(Edge { to: j, action }),
                                    Actions::Conditional(flights) => conditional.extend(
                                        flights
                                            .into_iter()
                                            .flatten()
                                            .map(|flight| ConditionalEdge { to: j, flight }),
                                    ),
                                }
                            }
                        }
                    }
                });
            }
        });
        let edges_ms = edges_started.elapsed().as_secs_f64() * 1000.;
        let count_before_bridges = nodes.len();
        let mut automatic_bridges = bridges::discover(
            world,
            placements,
            &mut nodes,
            &mut edges,
            &index,
            &ledge_nodes,
            support_count,
        );
        conditional.resize_with(nodes.len(), Vec::new);
        automatic_bridges.discover_sprint(
            world,
            &nodes[..support_count],
            &edges,
            &mut conditional,
            &index,
        );
        let index = if !marks.is_empty() && nodes.len() != count_before_bridges {
            Index::new(
                &nodes
                    .iter()
                    .map(|p| Bounds::points(&[*p]))
                    .collect::<Vec<_>>(),
            )
        } else {
            index
        };
        let terminals_started = Instant::now();
        let proved_link_count = annotated.len();
        for (from, to, actions) in annotated {
            match actions {
                Actions::Ordinary(action) if !edges[from].iter().any(|edge| edge.to == to) => {
                    edges[from].push(Edge { to, action });
                }
                Actions::Conditional(flights)
                    if !conditional[from].iter().any(|edge| edge.to == to) =>
                {
                    conditional[from].extend(
                        flights
                            .into_iter()
                            .flatten()
                            .map(|flight| ConditionalEdge { to, flight }),
                    );
                }
                _ => {}
            }
        }
        for (from, to, action) in devices {
            edges[from].push(Edge {
                to,
                action: Arc::new(action),
            });
        }
        let terminals = marks
            .into_iter()
            .enumerate()
            .map(|(mark_index, mark)| {
                let mut connections = Vec::new();
                for (index, node, action) in &launch_terminals {
                    if *index == mark_index {
                        connections.push((*node, action.clone()));
                    }
                }
                index.query(Bounds::points(&[mark.position]).expand(12.), |i| {
                    if let Some(action) = world.collect(nodes[i], mark.position, &mark.interaction)
                    {
                        connections.push((i, action));
                    }
                    false
                });
                if connections.is_empty() {
                    index.query(Bounds::points(&[mark.position]).expand(12.), |i| {
                        if let Some(action) =
                            world.collect_sprinting(nodes[i], mark.position, &mark.interaction)
                        {
                            connections.push((i, action));
                        }
                        false
                    });
                }
                (mark, connections)
            })
            .collect();
        Self {
            nodes,
            edges,
            terminals,
            boosts,
            conditional,
            boost_uses,
            proved_link_count,
            region_flights,
            automatic_bridges,
            preparation_ms: [
                samples_ms,
                ports_ms,
                edges_ms,
                terminals_started.elapsed().as_secs_f64() * 1000.,
            ],
        }
    }
}
