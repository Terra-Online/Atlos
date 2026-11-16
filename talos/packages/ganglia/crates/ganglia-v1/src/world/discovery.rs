//! Navigation distances order action discovery; they never authorize motion.
use super::*;
use std::collections::{BinaryHeap, HashMap};

#[derive(Clone, Debug)]
pub(crate) struct Face {
    pub center: Vec3,
    pub height: f64,
    pub min: [f64; 2],
    pub max: [f64; 2],
}
#[derive(Clone, Debug)]
pub(super) struct Graph {
    faces: Vec<Face>,
    forward: Vec<Vec<(usize, f64)>>,
    reverse: Vec<Vec<(usize, f64)>>,
}
impl Graph {
    fn new(world: &World) -> Self {
        let faces = world
            .surfaces
            .iter()
            .map(|s| Face {
                center: std::array::from_fn(|axis| {
                    s.vertices.iter().map(|p| p[axis]).sum::<f64>() / s.vertices.len() as f64
                }),
                height: s
                    .vertices
                    .iter()
                    .map(|p| p[1])
                    .fold(f64::INFINITY, f64::min),
                min: [0, 2].map(|axis| {
                    s.vertices
                        .iter()
                        .map(|p| p[axis])
                        .fold(f64::INFINITY, f64::min)
                }),
                max: [0, 2].map(|axis| {
                    s.vertices
                        .iter()
                        .map(|p| p[axis])
                        .fold(f64::NEG_INFINITY, f64::max)
                }),
            })
            .collect::<Vec<_>>();
        let mut forward = vec![Vec::new(); faces.len()];
        let mut reverse = vec![Vec::new(); faces.len()];
        for portal in &world.portals {
            let a = world.surface_ids[&portal.from];
            let b = world.surface_ids[&portal.to];
            let cost = distance(faces[a].center, portal.points[0])
                + distance(portal.points[0], portal.points[1])
                + distance(portal.points[1], faces[b].center);
            forward[a].push((b, cost));
            reverse[b].push((a, cost));
        }
        Self {
            faces,
            forward,
            reverse,
        }
    }
}
#[derive(Clone, Copy)]
struct Label(f64, usize);
impl PartialEq for Label {
    fn eq(&self, other: &Self) -> bool {
        self.0 == other.0 && self.1 == other.1
    }
}
impl Eq for Label {}
impl PartialOrd for Label {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Label {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other.0.total_cmp(&self.0).then(other.1.cmp(&self.1))
    }
}
fn distances(
    edges: &[Vec<(usize, f64)>],
    extra: &HashMap<usize, Vec<(usize, f64)>>,
    roots: Vec<(usize, f64)>,
) -> Result<Vec<f64>, String> {
    let mut costs = vec![f64::INFINITY; edges.len()];
    let mut queue = BinaryHeap::new();
    for (id, cost) in roots {
        if cost < costs[id] {
            costs[id] = cost;
            queue.push(Label(cost, id));
        }
    }
    while let Some(Label(cost, id)) = queue.pop() {
        crate::cancel::check()?;
        if cost != costs[id] {
            continue;
        }
        for &(to, length) in edges[id].iter().chain(extra.get(&id).into_iter().flatten()) {
            let next = cost + length;
            if next < costs[to] {
                costs[to] = next;
                queue.push(Label(next, to));
            }
        }
    }
    Ok(costs)
}
pub(crate) struct Fields<'a> {
    world: &'a World,
    graph: &'a Graph,
    approach: Vec<f64>,
    departure: Vec<f64>,
}
impl Fields<'_> {
    pub(crate) fn face(&self, id: usize) -> &Face {
        &self.graph.faces[id]
    }

    pub(crate) fn surface_costs(&self, surface: &str, point: Vec3) -> (f64, f64) {
        let id = self.world.surface_ids[surface];
        let offset = distance(point, self.graph.faces[id].center);
        (self.approach[id] + offset, self.departure[id] + offset)
    }

    pub(crate) fn costs(&self, point: Vec3) -> Result<(f64, f64), String> {
        let mut head = f64::INFINITY;
        let mut tail = f64::INFINITY;
        for projection in self.world.project(point, None)? {
            let id = self.world.surface_ids[&projection.surface];
            let offset = distance(point, self.graph.faces[id].center);
            head = head.min(self.approach[id] + offset);
            tail = tail.min(self.departure[id] + offset);
        }
        Ok((head, tail))
    }
}
impl World {
    pub(crate) fn discovery_fields(
        &self,
        origins: &[Vec3],
        goal: Vec3,
        actions: &[(Vec3, Vec3, f64)],
    ) -> Result<Fields<'_>, String> {
        let graph = self.discovery_graph.get_or_init(|| Graph::new(self));
        let roots = |points: &[Vec3]| -> Result<Vec<(usize, f64)>, String> {
            let mut roots = Vec::new();
            for &point in points {
                for projection in self.project(point, None)? {
                    let id = self.surface_ids[&projection.surface];
                    roots.push((id, distance(point, graph.faces[id].center)));
                }
            }
            Ok(roots)
        };
        let mut forward = HashMap::<usize, Vec<(usize, f64)>>::new();
        let mut reverse = HashMap::<usize, Vec<(usize, f64)>>::new();
        for &(start, end, length) in actions {
            for from in self.project(start, None)? {
                for to in self.project(end, None)? {
                    let a = self.surface_ids[&from.surface];
                    let b = self.surface_ids[&to.surface];
                    let cost = distance(graph.faces[a].center, start)
                        + length
                        + distance(end, graph.faces[b].center);
                    forward.entry(a).or_default().push((b, cost));
                    reverse.entry(b).or_default().push((a, cost));
                }
            }
        }
        Ok(Fields {
            world: self,
            graph,
            approach: distances(&graph.forward, &forward, roots(origins)?)?,
            departure: distances(&graph.reverse, &reverse, roots(&[goal])?)?,
        })
    }
}
