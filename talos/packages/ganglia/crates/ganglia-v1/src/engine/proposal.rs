//! Coarse proposals rank coverage requests, never certify physical motion.
//! Support projection and directed mesh portals come from the World module.
use super::{Point, distance, horizontal, point};
use crate::{model::Interaction, world::World};
use serde_json::{Value, json};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BinaryHeap, HashMap, HashSet};

pub(super) struct Navigation {
    world: Option<World>,
    centers: Vec<Point>,
    edges: Vec<Vec<Edge>>,
    ids: HashMap<String, usize>,
    max_vertical: f64,
    components: Vec<usize>,
    members: Vec<Vec<usize>>,
}
#[derive(Clone)]
pub(super) struct Edge {
    pub key: String,
    pub points: Vec<Point>,
    pub unresolved: bool,
    to: usize,
    length: f64,
}
pub(super) struct Proposal {
    pub arrival: Value,
    pub points: Vec<Point>,
    pub protected: Vec<[Point; 2]>,
    pub edges: Vec<Edge>,
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
        self.world = None;
        self.centers.clear();
        self.edges.clear();
        self.ids.clear();
        self.components.clear();
        self.members.clear();
    }
    pub fn new(data: &Value) -> Result<Self, String> {
        if data.is_null() {
            return Ok(Self {
                world: None,
                centers: vec![],
                edges: vec![],
                ids: HashMap::new(),
                max_vertical: 3.,
                components: vec![],
                members: vec![],
            });
        }
        let options = &data["options"];
        let vertical = options["maxVertical"].as_f64().unwrap_or(3.);
        // A navigation-only World supplies the shared projection/portal geometry.
        // Its inert motion carrier is never used for flight, physical validation,
        // or route timing. Those always use loaded physical snapshots.
        let world = World::new(json!({"kind":"surfaces","coverage":"complete","input":{
            "surfaces":data["surfaces"],"collision":{"positions":[],"indices":[]},
            "walls":options["walls"].as_array().cloned().unwrap_or_default(),
            "portals":options["portals"].as_array().cloned().unwrap_or_default(),
            "movement":{"speed":options["speed"].as_f64().unwrap_or(1.),"maxVertical":vertical,
                "stepUp":vertical,"stepDown":vertical,
                "profile":options.get("profile").cloned().unwrap_or(json!({"radius":0.,"height":1.})),
                "model":{"gravity":1.,"fallingGravity":1.,"maxJumpHeight":0.,"maxFallingSpeed":1.,"apexTime":0.,"maxHorizontalSpeed":0.}}
        }}))?;
        let centers = world
            .surfaces
            .iter()
            .map(|f| {
                std::array::from_fn(|axis| {
                    f.vertices.iter().map(|v| v[axis]).sum::<f64>() / f.vertices.len() as f64
                })
            })
            .collect::<Vec<Point>>();
        let ids = world
            .surfaces
            .iter()
            .enumerate()
            .map(|(i, f)| (f.id.clone(), i))
            .collect::<HashMap<_, _>>();
        let mut edges = vec![vec![]; centers.len()];
        for portal in &world.portals {
            let from = ids[&portal.from];
            let to = ids[&portal.to];
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
        let mut components: Vec<usize> = (0..centers.len()).collect();
        fn root(parents: &mut [usize], mut at: usize) -> usize {
            while at != parents[at] {
                parents[at] = parents[parents[at]];
                at = parents[at];
            }
            at
        }
        for (i, list) in edges.iter().enumerate() {
            for edge in list {
                let a = root(&mut components, i);
                let b = root(&mut components, edge.to);
                components[a] = b;
            }
        }
        let mut members = vec![vec![]; centers.len()];
        for i in 0..centers.len() {
            components[i] = root(&mut components, i);
            members[components[i]].push(i);
        }
        Ok(Self {
            world: Some(world),
            centers,
            edges,
            ids,
            max_vertical: vertical,
            components,
            members,
        })
    }

    pub fn plan(
        &self,
        arrivals: &[Value],
        goal: Point,
        excluded: &HashSet<String>,
    ) -> Result<Option<Proposal>, String> {
        let Some(world) = &self.world else {
            return Ok(None);
        };
        if self.centers.is_empty() {
            return Ok(None);
        }
        let domain: Interaction = serde_json::from_value(json!({"radius":96.,"maxVertical":96.}))
            .map_err(|e| e.to_string())?;
        let n = self.centers.len();
        let end = n;
        let mut endpoints = HashMap::new();
        for hit in world.project_with_tolerance(goal, 96., Some(&domain))? {
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
            endpoints.insert(i, edge);
        }
        let mut costs = vec![f64::INFINITY; n + 1];
        let mut previous: Vec<Option<(usize, Edge)>> = vec![None; n + 1];
        let mut origins = vec![None; n + 1];
        let mut heap = BinaryHeap::new();
        let mut serial = 0;
        let mut expanded_components = HashSet::new();
        let mut transfers: HashMap<usize, Vec<Edge>> = HashMap::new();
        for (origin, a) in arrivals
            .iter()
            .enumerate()
            .filter(|(_, a)| a["state"] == "available")
        {
            let start = point(&a["position"])?;
            for hit in world.project_with_tolerance(start, 96., Some(&domain))? {
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
                let cost = a["cost"].as_f64().unwrap_or(0.) + edge.rank();
                if cost < costs[i] {
                    costs[i] = cost;
                    origins[i] = Some(origin);
                    previous[i] = Some((n + 1, edge));
                    heap.push(Label {
                        cost,
                        node: i,
                        order: serial,
                    });
                    serial += 1;
                }
            }
        }
        while let Some(Label { node, cost, .. }) = heap.pop() {
            if cost != costs[node] {
                continue;
            }
            if node == end {
                break;
            }
            let component = self.components[node];
            if expanded_components.insert(component) {
                for (from, edge) in self.transfers(component, arrivals, goal)? {
                    transfers.entry(from).or_default().push(edge);
                }
            }
            for edge in self.edges[node]
                .iter()
                .chain(transfers.get(&node).into_iter().flatten())
                .chain(endpoints.get(&node))
            {
                if excluded.contains(&edge.key) {
                    continue;
                }
                let next = cost + edge.rank();
                if next < costs[edge.to] {
                    costs[edge.to] = next;
                    origins[edge.to] = origins[node];
                    previous[edge.to] = Some((node, edge.clone()));
                    heap.push(Label {
                        cost: next,
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
            path.push(edge.clone());
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
        arrivals: &[Value],
        goal: Point,
    ) -> Result<Vec<(usize, Edge)>, String> {
        let world = self.world.as_ref().unwrap();
        let mut sources = self.members[component].clone();
        sources.sort_by(|&a, &b| {
            distance(self.centers[a], goal).total_cmp(&distance(self.centers[b], goal))
        });
        let mut selected = sources.iter().take(12).copied().collect::<Vec<_>>();
        for arrival in arrivals.iter().filter(|a| a["state"] == "available") {
            let start = point(&arrival["position"])?;
            sources.sort_by(|&a, &b| {
                distance(self.centers[a], start).total_cmp(&distance(self.centers[b], start))
            });
            selected.extend(sources.iter().take(4).copied());
        }
        selected.sort_unstable();
        selected.dedup();
        let domain: Interaction =
            serde_json::from_value(json!({"radius":16_f64.hypot(50.),"maxVertical":50.}))
                .map_err(|e| e.to_string())?;
        let mut candidates: BTreeMap<(usize, usize), Edge> = BTreeMap::new();
        // Unknown transfers are query-directed finite proposals. Materialize
        // only reached component interfaces, never every nearby mesh-face pair
        // at scene preparation. Geometry and motion validation stay physical.
        for from in selected {
            for &vertex in &world.surfaces[from].vertices {
                for hit in world.project_with_tolerance(vertex, 50., Some(&domain))? {
                    let to = self.ids[&hit.surface];
                    if from == to || horizontal(vertex, hit.position) > 16. {
                        continue;
                    }
                    let edge = Edge::new(
                        format!("transfer:{}:{}", world.surfaces[from].id, hit.surface),
                        to,
                        vec![self.centers[from], vertex, hit.position, self.centers[to]],
                        true,
                    );
                    let key = (from, self.components[to]);
                    if candidates
                        .get(&key)
                        .is_none_or(|old| edge.rank() < old.rank())
                    {
                        candidates.insert(key, edge);
                    }
                }
            }
        }
        Ok(candidates
            .into_iter()
            .map(|((from, _), edge)| (from, edge))
            .collect())
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
                    10_000.
                }
            } else {
                0.
            }
    }
}
