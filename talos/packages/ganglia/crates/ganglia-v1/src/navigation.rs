//! Coarse proposals rank coverage requests, never certify physical motion.
//! Prepared geometry and topology are immutable. Query arenas hold only
//! temporary endpoints/transfers; predecessor labels contain compact edge IDs.
mod topology;
use crate::geometry::{Index, distance};
use crate::model::{Interaction, Portal, Surface, Vec3 as Point};
use serde::{Deserialize, Serialize};
#[cfg(test)]
use serde_json::{Value, json};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};
use topology::Topology;

const TRANSFER_PENALTY: f64 = 10_000.;

fn horizontal(a: Point, b: Point) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}

#[derive(Deserialize)]
pub(crate) struct Input {
    surfaces: Vec<Surface>,
    options: MeshOptions,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MeshOptions {
    max_vertical: f64,
    #[serde(default)]
    portals: Vec<Portal>,
}
struct Mesh {
    surfaces: Vec<Surface>,
    portals: Vec<Portal>,
    index: Index,
    owners: Vec<usize>,
}
impl Mesh {
    fn new(input: Input) -> Result<Self, String> {
        let mut faces = Vec::new();
        let mut owners = Vec::new();
        for (owner, surface) in input.surfaces.iter().enumerate() {
            for i in 1..surface.vertices.len().saturating_sub(1) {
                let triangle = [
                    surface.vertices[0],
                    surface.vertices[i],
                    surface.vertices[i + 1],
                ];
                let normal = crate::geometry::cross(
                    crate::geometry::sub(triangle[1], triangle[0]),
                    crate::geometry::sub(triangle[2], triangle[0]),
                );
                if normal[1].abs() <= 1e-12 {
                    continue;
                }
                faces.push(if normal[1] < 0. {
                    [triangle[0], triangle[2], triangle[1]]
                } else {
                    triangle
                });
                owners.push(owner);
            }
        }
        let mut portals = input.options.portals;
        // Authored meshes authorize height-changing portals explicitly.
        portals.extend(crate::mesh::portals(&input.surfaces, 0., 0.));
        let index = Index::from_faces(faces, None)?;
        Ok(Self {
            surfaces: input.surfaces,
            portals,
            index,
            owners,
        })
    }
    fn project(
        &self,
        point: Point,
        tolerance: f64,
        interaction: Option<&Interaction>,
    ) -> Result<Vec<crate::mesh::Projection>, String> {
        crate::mesh::project(
            &self.index,
            &self.owners,
            &self.surfaces,
            point,
            tolerance,
            interaction,
        )
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub(crate) struct Arrival {
    pub id: String,
    pub position: Point,
    pub cost: f64,
    pub state: Availability,
    #[serde(flatten)]
    pub extra: crate::model::Extra,
}
#[derive(Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Availability {
    Available,
    Locked,
    Unknown,
}

pub(crate) struct Navigation {
    mesh: Option<Mesh>,
    centers: Vec<Point>,
    graph: Topology,
    ids: HashMap<String, usize>,
    max_vertical: f64,

    seams: HashMap<[i64; 3], BTreeMap<usize, Vec<Witness>>>,
    transfers: RefCell<HashMap<usize, Vec<Transfer>>>,
}
struct Transfer {
    key: String,
    to: usize,
    source: usize,
    target: usize,
    length: f64,
}

const CELL: Point = [8., 50., 8.];
const ALTERNATIVES: usize = 4;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Witness {
    surface: usize,
    vertex: usize,
}

struct Representatives {
    witnesses: [Option<Witness>; 9],
    distances: [f64; 9],
}
impl Representatives {
    fn new() -> Self {
        Self {
            witnesses: [None; 9],
            distances: [f64::INFINITY; 9],
        }
    }
    fn consider(&mut self, witness: Witness, position: Point, cell: [i64; 3]) {
        // Keep the nearest source vertex to each cell corner and its centre.
        // This bounds retrieval independently of navmesh triangle density. The
        // retained vertices are coarse proposals, never support/clearance proof.
        for slot in 0..9 {
            let target = std::array::from_fn(|axis| {
                let fraction = if slot == 8 {
                    0.5
                } else {
                    ((slot >> axis) & 1) as f64
                };
                (cell[axis] as f64 + fraction) * CELL[axis]
            });
            let score = squared(position, target);
            if score < self.distances[slot]
                || (score == self.distances[slot]
                    && self.witnesses[slot].is_none_or(|old| witness < old))
            {
                self.distances[slot] = score;
                self.witnesses[slot] = Some(witness);
            }
        }
    }
    fn finish(self) -> Vec<Witness> {
        let mut result = self.witnesses.into_iter().flatten().collect::<Vec<_>>();
        result.sort_unstable();
        result.dedup();
        result
    }
}

fn cell(position: Point) -> [i64; 3] {
    std::array::from_fn(|axis| (position[axis] / CELL[axis]).floor() as i64)
}
fn squared(a: Point, b: Point) -> f64 {
    (0..3).map(|axis| (a[axis] - b[axis]).powi(2)).sum()
}

#[derive(PartialEq)]
struct Nearest {
    score: f64,
    index: usize,
}
impl Eq for Nearest {}
impl PartialOrd for Nearest {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Nearest {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .total_cmp(&other.score)
            .then_with(|| self.index.cmp(&other.index))
    }
}

fn nearest(members: &[usize], centers: &[Point], target: Point, limit: usize) -> Vec<usize> {
    let mut heap = BinaryHeap::with_capacity(limit + 1);
    for &index in members {
        let candidate = Nearest {
            score: squared(centers[index], target),
            index,
        };
        if heap.len() < limit {
            heap.push(candidate);
        } else if heap.peek().is_some_and(|worst| candidate < *worst) {
            heap.pop();
            heap.push(candidate);
        }
    }
    heap.into_sorted_vec()
        .into_iter()
        .map(|item| item.index)
        .collect()
}
#[derive(Clone)]
pub(crate) struct Edge {
    pub key: String,
    pub points: Vec<Point>,
    pub unresolved: bool,
    to: usize,
    length: f64,
}
pub(crate) struct Proposal {
    pub arrival: Arrival,
    pub points: Vec<Point>,
    pub protected: Vec<[Point; 2]>,
    pub edges: Vec<Edge>,
}
#[derive(Clone, Copy)]
enum EdgeId {
    Prepared(usize),
    Query(usize),
}
#[derive(Clone)]
struct Label {
    cost: f64,
    node: usize,
    order: usize,
}
impl PartialEq for Label {
    fn eq(&self, b: &Self) -> bool {
        self.cost == b.cost && self.order == b.order
    }
}
impl Eq for Label {}
impl PartialOrd for Label {
    fn partial_cmp(&self, b: &Self) -> Option<Ordering> {
        Some(self.cmp(b))
    }
}
impl Ord for Label {
    fn cmp(&self, b: &Self) -> Ordering {
        b.cost
            .total_cmp(&self.cost)
            .then_with(|| b.order.cmp(&self.order))
    }
}

impl Navigation {
    pub fn clear(&mut self) {
        self.mesh = None;
        self.centers.clear();
        self.graph = Topology::default();
        self.ids.clear();
        self.seams.clear();
        self.transfers.get_mut().clear();
    }
    pub fn new(data: Option<Input>) -> Result<Self, String> {
        let Some(mesh) = data else {
            return Ok(Self {
                mesh: None,
                centers: vec![],
                graph: Topology::default(),
                ids: HashMap::new(),
                max_vertical: 3.,
                seams: HashMap::new(),
                transfers: RefCell::default(),
            });
        };
        let vertical = mesh.options.max_vertical;
        let mesh = Mesh::new(mesh)?;
        let centers = mesh
            .surfaces
            .iter()
            .map(|f| {
                std::array::from_fn(|axis| {
                    f.vertices.iter().map(|v| v[axis]).sum::<f64>() / f.vertices.len() as f64
                })
            })
            .collect::<Vec<Point>>();
        let ids = mesh
            .surfaces
            .iter()
            .enumerate()
            .map(|(i, f)| (f.id.clone(), i))
            .collect::<HashMap<_, _>>();
        let mut edges = vec![vec![]; centers.len()];
        for portal in &mesh.portals {
            let from = *ids
                .get(&portal.from)
                .ok_or("Unknown navigation portal source")?;
            let to = *ids
                .get(&portal.to)
                .ok_or("Unknown navigation portal target")?;
            let points = vec![
                centers[from],
                portal.points[0],
                portal.points[1],
                centers[to],
            ];
            edges[from].push(Edge::new(
                format!("portal:{}:{}:{:?}", portal.from, portal.to, portal.points),
                to,
                points,
                false,
            ));
        }
        // Equivalent costs retain input/geometry order, independent of HashMap
        // iteration or materialization history from an earlier query.
        for list in &mut edges {
            list.sort_by(|a, b| {
                a.unresolved
                    .cmp(&b.unresolved)
                    .then_with(|| a.key.cmp(&b.key))
            });
        }
        let graph = Topology::new(edges);
        let mut sampled: HashMap<[i64; 3], BTreeMap<usize, Representatives>> = HashMap::new();
        for (surface, face) in mesh.surfaces.iter().enumerate() {
            for (vertex, &position) in face.vertices.iter().enumerate() {
                let key = cell(position);
                sampled
                    .entry(key)
                    .or_default()
                    .entry(graph.components[surface])
                    .or_insert_with(Representatives::new)
                    .consider(Witness { surface, vertex }, position, key);
            }
        }
        let seams = sampled
            .into_iter()
            .map(|(key, groups)| {
                (
                    key,
                    groups
                        .into_iter()
                        .map(|(component, reps)| (component, reps.finish()))
                        .collect(),
                )
            })
            .collect();
        Ok(Self {
            mesh: Some(mesh),
            centers,
            graph,
            ids,
            max_vertical: vertical,
            seams,
            transfers: RefCell::default(),
        })
    }

    pub fn plan(
        &self,
        arrivals: &[Arrival],
        goal: Point,
        excluded: &HashSet<String>,
    ) -> Result<Option<Proposal>, String> {
        // A cheap known corridor already beats every unresolved transfer.
        // Avoid materializing those geometric proposals until their lower bound
        // can compete. The general search still handles disconnected endpoints,
        // costly arrivals and unusually long known corridors.
        if let Some(proposal) = self.plan_projected(arrivals, goal, excluded, false, false)? {
            let rank = proposal.arrival.cost + proposal.edges.iter().map(Edge::rank).sum::<f64>();
            let lower = arrivals
                .iter()
                .filter(|a| a.state == Availability::Available)
                .map(|a| a.cost)
                .fold(f64::INFINITY, f64::min)
                + TRANSFER_PENALTY;
            if rank < lower {
                return Ok(Some(proposal));
            }
        }
        if let Some(proposal) = self.plan_projected(arrivals, goal, excluded, false, true)? {
            return Ok(Some(proposal));
        }
        self.plan_projected(arrivals, goal, excluded, true, true)
    }

    fn plan_projected(
        &self,
        arrivals: &[Arrival],
        goal: Point,
        excluded: &HashSet<String>,
        broad: bool,
        allow_transfers: bool,
    ) -> Result<Option<Proposal>, String> {
        let Some(mesh) = &self.mesh else {
            return Ok(None);
        };
        if self.centers.is_empty() {
            return Ok(None);
        }
        let domain = Interaction {
            radius: 96.,
            max_vertical: Some(96.),
            airborne: false,
            facing: None,
            half_angle: None,
            extra: Default::default(),
        };
        let n = self.centers.len();
        let end = n;
        let remaining = |node: usize| {
            if node == end {
                0.
            } else {
                horizontal(self.centers[node], goal)
            }
        };
        let mut endpoints = HashMap::new();
        let mut query_edges = Vec::new();
        // Supported endpoints enter the actual directed topology. Broad fallback
        // handles missing endpoints without synthesizing every nearby start/goal
        // connection on ordinary queries.
        let project = |position| {
            mesh.project(
                position,
                if broad { 96. } else { self.max_vertical },
                if broad { Some(&domain) } else { None },
            )
        };
        for hit in project(goal)? {
            let Some(&i) = self.ids.get(&hit.surface) else {
                continue;
            };
            let edge = Edge::new(
                format!("goal:{}:{goal:?}", hit.surface),
                end,
                vec![self.centers[i], hit.position, goal],
                horizontal(hit.position, goal) > 1e-6
                    || (hit.position[1] - goal[1]).abs() > self.max_vertical,
            );
            endpoints.insert(i, query_edges.len());
            query_edges.push(edge);
        }
        let mut costs = vec![f64::INFINITY; n + 1];
        let mut previous: Vec<Option<(usize, EdgeId)>> = vec![None; n + 1];
        let mut origins = vec![None; n + 1];
        let mut heap = BinaryHeap::new();
        let mut serial = 0;
        let mut expanded_components = HashSet::new();
        let mut transfers: HashMap<usize, Vec<usize>> = HashMap::new();
        for (origin, a) in arrivals
            .iter()
            .enumerate()
            .filter(|(_, a)| a.state == Availability::Available)
        {
            let start = a.position;
            for hit in project(start)? {
                let Some(&i) = self.ids.get(&hit.surface) else {
                    continue;
                };
                let edge = Edge::new(
                    format!("start:{}:{start:?}", hit.surface),
                    i,
                    vec![start, hit.position, self.centers[i]],
                    horizontal(start, hit.position) > 1e-6
                        || (start[1] - hit.position[1]).abs() > self.max_vertical,
                );
                if excluded.contains(&edge.key) {
                    continue;
                }
                let cost = a.cost + edge.rank();
                if cost < costs[i] {
                    costs[i] = cost;
                    origins[i] = Some(origin);
                    previous[i] = Some((n + 1, EdgeId::Query(query_edges.len())));
                    query_edges.push(edge);
                    heap.push(Label {
                        cost: cost + remaining(i),
                        node: i,
                        order: serial,
                    });
                    serial += 1;
                }
            }
        }
        while let Some(Label { node, cost, .. }) = heap.pop() {
            crate::cancel::check()?;
            if cost != costs[node] + remaining(node) {
                continue;
            }
            if node == end {
                break;
            }
            let component = self.graph.components[node];
            if allow_transfers && expanded_components.insert(component) {
                for (from, edge) in self.transfers(component, arrivals, goal, excluded)? {
                    transfers.entry(from).or_default().push(query_edges.len());
                    query_edges.push(edge);
                }
            }
            for (id, edge) in self
                .graph
                .outgoing(node)
                .map(|(id, edge)| (EdgeId::Prepared(id), edge))
                .chain(
                    transfers
                        .get(&node)
                        .into_iter()
                        .flatten()
                        .chain(endpoints.get(&node))
                        .map(|&id| (EdgeId::Query(id), &query_edges[id])),
                )
            {
                if excluded.contains(&edge.key) {
                    continue;
                }
                let next = costs[node] + edge.rank();
                if next < costs[edge.to] {
                    costs[edge.to] = next;
                    origins[edge.to] = origins[node];
                    previous[edge.to] = Some((node, id));
                    heap.push(Label {
                        cost: next + remaining(edge.to),
                        node: edge.to,
                        order: serial,
                    });
                    serial += 1;
                }
            }
        }
        let Some(origin) = origins[end] else {
            return Ok(None);
        };
        let mut path = vec![];
        let mut node = end;
        while let Some((from, edge)) = &previous[node] {
            path.push(match *edge {
                EdgeId::Prepared(id) => self.graph.edges[id].clone(),
                EdgeId::Query(id) => query_edges[id].clone(),
            });
            if *from == n + 1 {
                break;
            }
            node = *from;
        }
        path.reverse();
        let mut points = vec![];
        let mut protected = vec![];
        for edge in &path {
            if edge.unresolved {
                // Only the unsupported interface is indivisible. The centroid
                // guide inside either support face can span kilometres and must
                // still be split into bounded physical windows.
                let pair = if edge.key.starts_with("transfer:") {
                    [edge.points[1], edge.points[2]]
                } else if edge.key.starts_with("start:") {
                    [edge.points[0], edge.points[1]]
                } else {
                    [edge.points[1], edge.points[2]]
                };
                protected.push(pair);
            }
            for p in &edge.points {
                if points
                    .last()
                    .map(|q| distance(*q, *p) > 1e-6)
                    .unwrap_or(true)
                {
                    points.push(*p);
                }
            }
        }
        if points.len() == 1 {
            points.push(goal);
        } else {
            *points.last_mut().unwrap() = goal;
        }
        Ok(Some(Proposal {
            arrival: arrivals[origin].clone(),
            points,
            protected,
            edges: path,
        }))
    }

    fn transfers(
        &self,
        component: usize,
        arrivals: &[Arrival],
        goal: Point,
        excluded: &HashSet<String>,
    ) -> Result<Vec<(usize, Edge)>, String> {
        let mesh = self.mesh.as_ref().unwrap();
        let sources = &self.graph.members[component];
        let mut selected = nearest(sources, &self.centers, goal, 12);
        for arrival in arrivals
            .iter()
            .filter(|a| a.state == Availability::Available)
        {
            let start = arrival.position;
            selected.extend(nearest(sources, &self.centers, start, 4));
        }
        selected.sort_unstable();
        selected.dedup();
        let mut candidates = Vec::new();
        let mut cached = self.transfers.borrow_mut();
        for from in selected {
            if let std::collections::hash_map::Entry::Vacant(slot) = cached.entry(from) {
                slot.insert(self.transfer_candidates(from, component)?);
            }
            let mut group = usize::MAX;
            let mut emitted = 0;
            for candidate in &cached[&from] {
                let to = candidate.to;
                let target_component = self.graph.components[to];
                if group != target_component {
                    group = target_component;
                    emitted = 0;
                }
                // Geometry and ranking are static. Filter exclusions before
                // limiting each group, so failures reveal all later witnesses.
                if emitted == ALTERNATIVES || excluded.contains(&candidate.key) {
                    continue;
                }
                candidates.push((
                    from,
                    Edge {
                        key: candidate.key.clone(),
                        to,
                        length: candidate.length,
                        points: vec![
                            self.centers[from],
                            mesh.surfaces[from].vertices[candidate.source],
                            mesh.surfaces[to].vertices[candidate.target],
                            self.centers[to],
                        ],
                        unresolved: true,
                    },
                ));
                emitted += 1;
            }
        }
        Ok(candidates)
    }

    fn transfer_candidates(&self, from: usize, component: usize) -> Result<Vec<Transfer>, String> {
        let mesh = self.mesh.as_ref().unwrap();
        let mut candidates = Vec::new();
        for (source, &vertex) in mesh.surfaces[from].vertices.iter().enumerate() {
            crate::cancel::check()?;
            let origin = cell(vertex);
            for dx in -2..=2 {
                for dy in -1..=1 {
                    for dz in -2..=2 {
                        let Some(groups) =
                            self.seams
                                .get(&[origin[0] + dx, origin[1] + dy, origin[2] + dz])
                        else {
                            continue;
                        };
                        for (&target_component, witnesses) in groups {
                            if target_component == component {
                                continue;
                            }
                            for witness in witnesses {
                                let to = witness.surface;
                                let target = mesh.surfaces[to].vertices[witness.vertex];
                                if (vertex[1] - target[1]).abs() > 50.
                                    || horizontal(vertex, target) > 16.
                                {
                                    continue;
                                }
                                let path = [self.centers[from], vertex, target, self.centers[to]];
                                candidates.push(Transfer {
                                    key: format!(
                                        "transfer:{}:{}:{source}:{}",
                                        mesh.surfaces[from].id,
                                        mesh.surfaces[to].id,
                                        witness.vertex
                                    ),
                                    to,
                                    source,
                                    target: witness.vertex,
                                    length: path.windows(2).map(|p| distance(p[0], p[1])).sum(),
                                });
                            }
                        }
                    }
                }
            }
        }
        let rank = |candidate: &Transfer| {
            candidate.length
                + if self.centers[candidate.to][1] - self.centers[from][1] > 2.1 {
                    1_000_000.
                } else {
                    TRANSFER_PENALTY
                }
        };
        candidates.sort_by(|a, b| {
            self.graph.components[a.to]
                .cmp(&self.graph.components[b.to])
                .then_with(|| rank(a).total_cmp(&rank(b)))
                .then_with(|| a.key.cmp(&b.key))
        });
        Ok(candidates)
    }
}
impl Edge {
    fn new(key: String, to: usize, points: Vec<Point>, unresolved: bool) -> Self {
        Self {
            key,
            to,
            length: points.windows(2).map(|e| distance(e[0], e[1])).sum(),
            points,
            unresolved,
        }
    }
    fn rank(&self) -> f64 {
        self.length
            + if self.unresolved {
                if self.points.last().unwrap()[1] - self.points[0][1] > 2.1 {
                    1_000_000.
                } else {
                    TRANSFER_PENALTY
                }
            } else {
                0.
            }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn face(id: &str, x: f64, y: f64) -> Value {
        json!({"id":id,"vertices":[[x-1.,y,-1.],[x+1.,y,-1.],[x+1.,y,1.],[x-1.,y,1.]]})
    }
    fn navigation(faces: Vec<Value>, portals: Vec<Value>) -> Navigation {
        Navigation::new(Some(serde_json::from_value(
            json!({"surfaces":faces,"options":{"speed":1.,"maxVertical":0.5,"portals":portals}})
        ).unwrap()))
        .unwrap()
    }
    fn start(x: f64) -> Vec<Arrival> {
        vec![Arrival {
            id: "start".into(),
            position: [x, 0., 0.],
            cost: 0.,
            state: Availability::Available,
            extra: Default::default(),
        }]
    }

    #[test]
    fn rejected_seam_reveals_another_witness_in_the_same_target_component() {
        let nav = navigation(
            vec![face("a", 0., 0.), face("b", 6., 0.), face("c", 10., 0.)],
            vec![json!({"from":"b","to":"c","points":[[7.,0.,0.],[9.,0.,0.]]})],
        );
        let component = nav.graph.components[nav.ids["a"]];
        let first = nav
            .transfers(component, &start(0.), [10., 0., 0.], &HashSet::new())
            .unwrap();
        assert!(
            first.len() >= 2,
            "fixture must expose alternative physical witnesses"
        );
        let rejected = first[0].1.key.clone();
        let excluded = HashSet::from([rejected.clone()]);
        let retry = nav
            .transfers(component, &start(0.), [10., 0., 0.], &excluded)
            .unwrap();
        assert!(!retry.is_empty());
        assert!(retry.iter().all(|(_, edge)| edge.key != rejected));
        let restored = nav
            .transfers(component, &start(0.), [10., 0., 0.], &HashSet::new())
            .unwrap();
        assert_eq!(
            first.iter().map(|(_, e)| &e.key).collect::<Vec<_>>(),
            restored.iter().map(|(_, e)| &e.key).collect::<Vec<_>>()
        );
    }

    #[test]
    fn coarse_seams_cross_negative_cells_and_respect_horizontal_vertical_limits() {
        let nav = navigation(
            vec![
                face("a", -8., 0.),
                face("b", 8., 50.),
                face("too-high", 8., 100.001),
                face("too-far", 40., 0.),
            ],
            vec![],
        );
        let source = nav.ids["a"];
        let transfers = nav
            .transfers(
                nav.graph.components[source],
                &start(-8.),
                [8., 50., 0.],
                &HashSet::new(),
            )
            .unwrap();
        assert!(transfers.iter().any(|(_, edge)| edge.to == nav.ids["b"]));
        assert!(
            transfers
                .iter()
                .all(|(_, edge)| edge.to != nav.ids["too-high"] && edge.to != nav.ids["too-far"])
        );
        for (from, edge) in transfers {
            let mesh = nav.mesh.as_ref().unwrap();
            assert!(mesh.surfaces[from].vertices.contains(&edge.points[1]));
            assert!(mesh.surfaces[edge.to].vertices.contains(&edge.points[2]));
            assert!(horizontal(edge.points[1], edge.points[2]) <= 16.);
            assert!((edge.points[1][1] - edge.points[2][1]).abs() <= 50.);
        }
    }

    #[test]
    fn one_way_portal_keeps_the_reverse_transfer_available() {
        let nav = navigation(
            vec![face("upper", 0., 1.), face("lower", 6., 0.)],
            vec![json!({"from":"upper","to":"lower","points":[[1.,1.,0.],[5.,0.,0.]]})],
        );
        let mut upper = start(0.);
        upper[0].position[1] = 1.;
        let downhill = nav
            .plan(&upper, [6., 0., 0.], &HashSet::new())
            .unwrap()
            .unwrap();
        assert!(downhill.edges.iter().all(|edge| !edge.unresolved));
        let uphill = nav
            .plan(&start(6.), [0., 1., 0.], &HashSet::new())
            .unwrap()
            .unwrap();
        assert!(
            uphill
                .edges
                .iter()
                .any(|edge| edge.unresolved && edge.points[1][0] >= 5. && edge.points[2][0] <= 1.)
        );
        // A proposal remains hypothetical: its crossing must be physically
        // solved before it can become a route.
        assert!(!uphill.protected.is_empty());
    }

    #[test]
    fn cheap_unknown_arrival_can_beat_an_expensive_known_corridor() {
        let nav = navigation(vec![face("goal", 0., 0.), face("other", 5., 0.)], vec![]);
        let mut arrivals = start(0.);
        arrivals[0].id = "expensive".into();
        arrivals[0].cost = 20_000.;
        let mut cheap = start(5.).remove(0);
        cheap.id = "cheap".into();
        arrivals.push(cheap);
        let proposal = nav
            .plan(&arrivals, [0., 0., 0.], &HashSet::new())
            .unwrap()
            .unwrap();
        assert_eq!(proposal.arrival.id, "cheap");
    }

    #[test]
    fn bounded_nearest_selection_keeps_equal_distance_input_order() {
        let centers = vec![
            [1., 0., 0.],
            [-1., 0., 0.],
            [0., 0., 1.],
            [0., 0., -1.],
            [100., 0., 0.],
        ];
        assert_eq!(
            nearest(&[4, 3, 2, 1, 0], &centers, [0., 0., 0.], 3),
            vec![0, 1, 2]
        );
        assert_eq!(
            nearest(&[4, 3, 2, 1, 0], &centers, [100., 0., 0.], 1),
            vec![4]
        );
    }
}
