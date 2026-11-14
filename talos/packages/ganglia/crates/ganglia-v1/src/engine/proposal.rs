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
    seams: HashMap<[i64; 3], BTreeMap<usize, Vec<Witness>>>,
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
        self.seams.clear();
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
                seams: HashMap::new(),
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
        let mut sampled: HashMap<[i64; 3], BTreeMap<usize, Representatives>> = HashMap::new();
        for (surface, face) in world.surfaces.iter().enumerate() {
            for (vertex, &position) in face.vertices.iter().enumerate() {
                let key = cell(position);
                sampled
                    .entry(key)
                    .or_default()
                    .entry(components[surface])
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
            world: Some(world),
            centers,
            edges,
            ids,
            max_vertical: vertical,
            components,
            members,
            seams,
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
            crate::cancel::check()?;
            if cost != costs[node] {
                continue;
            }
            if node == end {
                break;
            }
            let component = self.components[node];
            if expanded_components.insert(component) {
                for (from, edge) in self.transfers(component, arrivals, goal, excluded)? {
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
        excluded: &HashSet<String>,
    ) -> Result<Vec<(usize, Edge)>, String> {
        let world = self.world.as_ref().unwrap();
        let sources = &self.members[component];
        let mut selected = nearest(sources, &self.centers, goal, 12);
        for arrival in arrivals.iter().filter(|a| a["state"] == "available") {
            let start = point(&arrival["position"])?;
            selected.extend(nearest(sources, &self.centers, start, 4));
        }
        selected.sort_unstable();
        selected.dedup();
        let mut candidates: BTreeMap<(usize, usize), Vec<Edge>> = BTreeMap::new();
        // Unknown transfers are query-directed finite proposals. Materialize
        // only reached component interfaces. Cells exclude the source component
        // before visiting representatives, so dense connected floors do not cause
        // repeated broad projection, face cloning, or sorting. Both ends are
        // retained vertices; physical support/flight validation remains in World.
        // Nine representatives per component/cell and four alternatives per
        // source face/target component define finite proposal coverage, not an
        // equivalence claim with continuous nearest-surface projection.
        for from in selected {
            for (source, &vertex) in world.surfaces[from].vertices.iter().enumerate() {
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
                                    let target = world.surfaces[to].vertices[witness.vertex];
                                    if (vertex[1] - target[1]).abs() > 50.
                                        || horizontal(vertex, target) > 16.
                                    {
                                        continue;
                                    }
                                    let key = format!(
                                        "transfer:{}:{}:{source}:{}",
                                        world.surfaces[from].id,
                                        world.surfaces[to].id,
                                        witness.vertex
                                    );
                                    // Reject the actual retained witness before ranking;
                                    // a failed cheapest seam must reveal other witnesses.
                                    if excluded.contains(&key) {
                                        continue;
                                    }
                                    let path =
                                        [self.centers[from], vertex, target, self.centers[to]];
                                    let length =
                                        path.windows(2).map(|p| distance(p[0], p[1])).sum::<f64>();
                                    let list =
                                        candidates.entry((from, target_component)).or_default();
                                    let score = length
                                        + if path[3][1] - path[0][1] > 2.1 {
                                            1_000_000.
                                        } else {
                                            10_000.
                                        };
                                    let rank = list.partition_point(|old| {
                                        old.rank().total_cmp(&score).then_with(|| old.key.cmp(&key))
                                            != Ordering::Greater
                                    });
                                    if rank < ALTERNATIVES {
                                        list.insert(
                                            rank,
                                            Edge {
                                                key,
                                                to,
                                                length,
                                                points: path.to_vec(),
                                                unresolved: true,
                                            },
                                        );
                                        list.truncate(ALTERNATIVES);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        Ok(candidates
            .into_iter()
            .flat_map(|((from, _), edges)| edges.into_iter().map(move |edge| (from, edge)))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn face(id: &str, x: f64, y: f64) -> Value {
        json!({"id":id,"vertices":[[x-1.,y,-1.],[x+1.,y,-1.],[x+1.,y,1.],[x-1.,y,1.]]})
    }
    fn navigation(faces: Vec<Value>, portals: Vec<Value>) -> Navigation {
        Navigation::new(
            &json!({"surfaces":faces,"options":{"speed":1.,"maxVertical":0.5,"portals":portals}}),
        )
        .unwrap()
    }
    fn start(x: f64) -> Vec<Value> {
        vec![json!({"id":"start","position":[x,0.,0.],"cost":0.,"state":"available"})]
    }

    #[test]
    fn rejected_seam_reveals_another_witness_in_the_same_target_component() {
        let nav = navigation(
            vec![face("a", 0., 0.), face("b", 6., 0.), face("c", 10., 0.)],
            vec![json!({"from":"b","to":"c","points":[[7.,0.,0.],[9.,0.,0.]]})],
        );
        let component = nav.components[nav.ids["a"]];
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
                nav.components[source],
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
            let world = nav.world.as_ref().unwrap();
            assert!(world.surfaces[from].vertices.contains(&edge.points[1]));
            assert!(world.surfaces[edge.to].vertices.contains(&edge.points[2]));
            assert!(horizontal(edge.points[1], edge.points[2]) <= 16.);
            assert!((edge.points[1][1] - edge.points[2][1]).abs() <= 50.);
        }
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
