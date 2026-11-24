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
type Flights = [Option<Arc<PreparedFlight>>; 3];

#[derive(Clone)]
enum Actions {
    Ordinary(Arc<Segment>),
    Conditional(Flights),
}

struct ProofShard {
    pairs: HashMap<Pair, [Option<Actions>; 2]>,
    sprint_bridges: HashMap<Pair, Flights>,
    hits: usize,
}

// Layouts share exact proofs, including misses, if their only varying geometry
// cannot affect the motion. Even recursive walk projection keeps XZ between
// the endpoints. Ignore Y in this check so elevated jumps cannot evade it.
pub(super) struct Proofs {
    affected: Index,
    padding: f64,
    shards: Vec<Mutex<ProofShard>>,
    projections: Option<Mutex<HashMap<[u64; 3], Option<Point>>>>,
}
impl Proofs {
    pub fn new(bounds: Vec<Bounds>, profile: &Profile, reuse: bool, layouts: usize) -> Self {
        Self {
            affected: Index::new(&bounds),
            // Larger than the capsule sweep, support and projection margins.
            padding: profile.radius + 1.,
            shards: (0..if reuse { 64 } else { 0 })
                .map(|_| {
                    Mutex::new(ProofShard {
                        pairs: HashMap::new(),
                        sprint_bridges: HashMap::new(),
                        hits: 0,
                    })
                })
                .collect(),
            projections: (reuse && layouts > 1).then(|| Mutex::new(HashMap::new())),
        }
    }

    fn varies(&self, points: &[Point]) -> bool {
        let mut bounds = Bounds::points(points).expand(self.padding);
        bounds.min[1] = f64::NEG_INFINITY;
        bounds.max[1] = f64::INFINITY;
        self.affected.query(bounds, |_| true)
    }

    fn standing(&self, world: &World, point: Point) -> Option<Point> {
        let prove = || {
            world
                .standing(point)
                .filter(|&feet| !world.blocked(feet, feet, 0.))
        };
        let Some(projections) = &self.projections else {
            return prove();
        };
        if self.varies(&[point]) {
            return prove();
        }
        *projections
            .lock()
            .unwrap()
            .entry(point.map(f64::to_bits))
            .or_insert_with(prove)
    }

    fn shard(&self, key: &Pair) -> &Mutex<ProofShard> {
        let mut hash = DefaultHasher::new();
        key.hash(&mut hash);
        &self.shards[hash.finish() as usize % self.shards.len()]
    }

    fn sprint_bridge(&self, world: &World, from: Point, to: Point) -> Flights {
        let prove = || {
            world
                .conditional_flights(from, to, &[])
                .map(|flight| flight.map(Arc::new))
        };
        if self.projections.is_none() || self.varies(&[from, to]) {
            return prove();
        }
        let key = [from.map(f64::to_bits), to.map(f64::to_bits)];
        let shard = self.shard(&key);
        if let Some(flights) = shard.lock().unwrap().sprint_bridges.get(&key).cloned() {
            return flights;
        }
        let flights = prove();
        shard
            .lock()
            .unwrap()
            .sprint_bridges
            .insert(key, flights.clone());
        flights
    }

    fn actions(&self, world: &World, from: Point, to: Point, boosts: &[BoostUse]) -> Actions {
        let prove = |walk: Option<Segment>| match walk
            .or_else(|| world.drop(from, to))
            .or_else(|| world.jump(from, to, None))
        {
            Some(action) => Actions::Ordinary(Arc::new(action)),
            None => Actions::Conditional(
                world
                    .conditional_flights(from, to, boosts)
                    .map(|a| a.map(Arc::new)),
            ),
        };
        if self.shards.is_empty() {
            return prove(world.walk(from, to));
        }
        if self.varies(&[from, to]) {
            return prove(world.walk(from, to));
        }
        let mut key = [from.map(f64::to_bits), to.map(f64::to_bits)];
        let direction = usize::from(key[0] > key[1]);
        if direction == 1 {
            key.swap(0, 1);
        }
        let shard = self.shard(&key);
        let needs_walk = {
            let mut saved = shard.lock().unwrap();
            if let Some(pair) = saved.pairs.get(&key) {
                if let Some(actions) = pair[direction].clone() {
                    saved.hits += 1;
                    return actions;
                }
                false
            } else {
                true
            }
        };
        // The swept body and support of a walk are reversible. Always prove
        // its canonical direction so concurrent rows choose the same trace.
        // Drops, jumps and their conditional alternatives remain directed.
        if needs_walk
            && let Some(walk) = world.walk(key[0].map(f64::from_bits), key[1].map(f64::from_bits))
        {
            let reverse = world.walk_segment(walk.points.iter().rev().copied().collect());
            let pair = [
                Actions::Ordinary(Arc::new(walk)),
                Actions::Ordinary(Arc::new(reverse)),
            ];
            let result = pair[direction].clone();
            shard.lock().unwrap().pairs.insert(key, pair.map(Some));
            return result;
        }
        let actions = prove(None);
        shard.lock().unwrap().pairs.entry(key).or_default()[direction] = Some(actions.clone());
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

#[derive(Default)]
struct LocalEdges {
    ordinary: Vec<Edge>,
    conditional: Vec<ConditionalEdge>,
}

impl LocalEdges {
    fn push(&mut self, to: usize, actions: Actions) {
        match actions {
            Actions::Ordinary(action) => self.ordinary.push(Edge { to, action }),
            Actions::Conditional(flights) => self.conditional.extend(
                flights
                    .into_iter()
                    .flatten()
                    .map(|flight| ConditionalEdge { to, flight }),
            ),
        }
    }
}

fn parallel_rows<T: Send>(rows: &mut [T], visit: impl Fn(usize, &mut T) + Sync) {
    const CHUNK: usize = 256;
    let workers = thread::available_parallelism()
        .map_or(1, |count| (count.get() / 2).clamp(1, 6))
        .min(rows.len().div_ceil(CHUNK));
    let chunks = Mutex::new(rows.chunks_mut(CHUNK).enumerate());
    thread::scope(|scope| {
        for _ in 0..workers {
            let chunks = &chunks;
            let visit = &visit;
            scope.spawn(move || {
                loop {
                    let Some((chunk, rows)) = chunks.lock().unwrap().next() else {
                        break;
                    };
                    for (offset, row) in rows.iter_mut().enumerate() {
                        visit(chunk * CHUNK + offset, row);
                    }
                }
            });
        }
    });
}

pub(super) const LOCAL_EDGE_RANGE: f64 = 12.;
pub(super) struct Backbone {
    pub nodes: Vec<Point>,
    pub edges: Vec<Vec<Edge>>,
    pub boosts: Vec<usize>,
    pub sample_candidates: usize,
    pub spacing_scale: f64,
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
        let mut boundaries: HashMap<([i64; 3], [i64; 3]), (usize, Point, Point, Point)> =
            HashMap::new();
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
        // Shared mesh edges never supply ledge samples. Sort only the
        // remaining boundary edges to preserve representative selection.
        let mut boundaries: Vec<_> = boundaries
            .into_iter()
            .filter(|(_, edge)| edge.0 == 1)
            .collect();
        boundaries.sort_unstable_by_key(|(key, _)| *key);
        for (_, (_, a, b, center)) in boundaries {
            let steps = (horizontal(a, b) / 3.).ceil().max(1.) as usize;
            for i in 0..steps {
                let edge = lerp(a, b, (i as f64 + 0.5) / steps as f64);
                let point = lerp(edge, center, 0.05);
                ledges.entry(key(point, 2.)).or_insert(point);
            }
        }
        // Reduce work on large windows. Height bins and the separate, denser
        // ledge lattice preserve samples for stacked floors and takeoffs.
        const SAMPLE_TARGET: f64 = 56_000.;
        let sample_candidates = interior.len() + ledges.len();
        let pressure = sample_candidates as f64 / SAMPLE_TARGET;
        // More samples also crowd the local proof neighbourhoods. Scale
        // more rapidly on the largest snapshots where both effects compound.
        let spacing_scale =
            (pressure.sqrt() * (pressure / 3.).max(1.).powf(2. / 3.)).clamp(1., 3.5);
        let standing = |p| proofs.standing(world, p);
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
        let edges_started = Instant::now();
        if profile {
            eprintln!(
                "ganglia-v2 backbone: {} nodes, {} device actions",
                nodes.len(),
                devices.len()
            );
        }

        let sparse = nodes.len() > 20_000;
        let mut requested = vec![Vec::new(); nodes.len()];
        parallel_rows(&mut requested, |i, nearby| {
            let a = nodes[i];
            index.query(Bounds::points(&[a]).expand(LOCAL_EDGE_RANGE), |j| {
                if i != j {
                    nearby.push((j, false));
                }
                false
            });
            nearby.sort_unstable_by(|&(j, _), &(k, _)| {
                distance(a, nodes[j]).total_cmp(&distance(a, nodes[k]))
            });
            nearby.truncate(neighbour_count);
            let mut headings = 0_u16;
            for (rank, (j, seed)) in nearby.iter_mut().enumerate() {
                let [x, _, z] = sub(nodes[*j], a);
                let sector = (usize::from(x < 0.) << 2)
                    | (usize::from(z < 0.) << 1)
                    | usize::from(z.abs() > x.abs());
                let bit = 1 << sector;
                *seed = !sparse || rank < 2 || headings & bit == 0;
                headings |= bit;
            }
        });
        let mut graph: Vec<_> = (0..nodes.len()).map(|_| LocalEdges::default()).collect();
        parallel_rows(&mut graph, |i, row| {
            for &(j, seed) in &requested[i] {
                if seed {
                    row.push(j, proofs.actions(world, nodes[i], nodes[j], &boost_uses));
                }
            }
        });

        let (mut edges, mut conditional): (Vec<_>, Vec<_>) = graph
            .into_iter()
            .map(|row| (row.ordinary, row.conditional))
            .unzip();
        if sparse {
            // A walk is reversible. Publish its reverse before identifying
            // regions so that each region has a proved round trip throughout.
            let mut reverse = Vec::new();
            for (from, outgoing) in edges.iter().enumerate() {
                for edge in outgoing.iter().filter(|edge| edge.action.mode == "walk") {
                    if !edges[edge.to].iter().any(|back| back.to == from) {
                        reverse.push((edge.to, from, edge.action.clone()));
                    }
                }
            }
            for (from, to, action) in reverse {
                edges[from].push(Edge {
                    to,
                    action: Arc::new(
                        world.walk_segment(action.points.iter().rev().copied().collect()),
                    ),
                });
            }
            let (groups, _) = bridges::walk_groups(&edges);
            let mut extra: Vec<_> = (0..nodes.len()).map(|_| LocalEdges::default()).collect();
            parallel_rows(&mut extra, |i, row| {
                let a = nodes[i];
                for &(j, seed) in &requested[i] {
                    let b = nodes[j];
                    let relief = (a[1] - b[1]).abs();
                    let steep = relief > 0.6 * horizontal(a, b);
                    if seed || (groups[i] == groups[j] && !steep) {
                        continue;
                    }
                    if edges[i].iter().any(|edge| edge.to == j) {
                        continue;
                    }
                    row.push(j, proofs.actions(world, a, b, &boost_uses));
                }
            });
            for (i, row) in extra.into_iter().enumerate() {
                edges[i].extend(row.ordinary);
                conditional[i].extend(row.conditional);
            }
        }
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
            proofs,
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
            sample_candidates,
            spacing_scale,
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
