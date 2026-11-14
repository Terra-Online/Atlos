//! Prepared physical connections between learned action endpoints. Query-local
//! attachments propose a connected corridor; resource scheduling remains Search's job.
use super::{Entry, Point};
use crate::world::{GroundProbe, World, distance};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap, HashSet};

const CELL: f64 = 2.;
const RADIUS: f64 = 8.;
const NEIGHBORS: usize = 16;
type Cell = [i64; 3];
fn cell(p: Point) -> Cell {
    p.map(|v| (v / CELL).floor() as i64)
}
struct Edge {
    to: usize,
    cost: f64,
    action: Option<usize>,
}
pub(super) struct Roadmap {
    points: Vec<Point>,
    edges: Vec<Vec<Edge>>,
    representatives: Vec<usize>,
    speed: f64,
}
pub(super) struct Path {
    pub actions: Vec<usize>,
    pub walks: Vec<[Point; 2]>,
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
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Label {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .0
            .total_cmp(&self.0)
            .then_with(|| other.1.cmp(&self.1))
    }
}
fn walking(world: &World, a: Point, b: Point) -> Result<Option<f64>, String> {
    match world.probe_ground(a, b) {
        Ok(GroundProbe::Supported(path))
            if distance(path.points[0], a) <= 1e-5
                && distance(*path.points.last().unwrap(), b) <= 1e-5 =>
        {
            Ok(Some(path.length))
        }
        Ok(_) => Ok(None),
        Err(error) if crate::world::is_coverage_error(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

impl Roadmap {
    pub fn prepare(world: &World, entries: &[Entry]) -> Result<Self, String> {
        let speed = world
            .locomotion
            .as_ref()
            .map_or(world.movement.speed, |m| m.sprint_speed);
        let mut points = Vec::new();
        let mut ids = HashMap::new();
        for entry in entries {
            for point in [entry.start, entry.end] {
                ids.entry(point.map(f64::to_bits)).or_insert_with(|| {
                    points.push(point);
                    points.len() - 1
                });
            }
        }
        let mut edges: Vec<Vec<Edge>> = (0..points.len()).map(|_| Vec::new()).collect();
        for (action, entry) in entries.iter().enumerate() {
            let from = ids[&entry.start.map(f64::to_bits)];
            let to = ids[&entry.end.map(f64::to_bits)];
            edges[from].push(Edge {
                to,
                cost: entry.duration,
                action: Some(action),
            });
        }
        // Exact endpoints remain distinct. A spatial representative only proposes
        // short connections; it never merges states across a wall or a floor.
        let mut cells = HashMap::<Cell, usize>::new();
        for (id, &point) in points.iter().enumerate() {
            let key = cell(point);
            let center = key.map(|v| (v as f64 + 0.5) * CELL);
            let representative = cells.entry(key).or_insert(id);
            if distance(point, center) < distance(points[*representative], center) {
                *representative = id;
            }
        }
        let mut representatives: Vec<_> = cells.values().copied().collect();
        representatives.sort_unstable();
        let mut pairs = HashSet::new();
        for (id, &point) in points.iter().enumerate() {
            let representative = cells[&cell(point)];
            if id != representative {
                pairs.insert((id, representative));
                pairs.insert((representative, id));
            }
        }
        for &from in &representatives {
            let mut nearby: Vec<_> = representatives
                .iter()
                .copied()
                .filter(|&to| to != from && distance(points[from], points[to]) <= RADIUS)
                .collect();
            nearby.sort_by(|&a, &b| {
                distance(points[from], points[a])
                    .total_cmp(&distance(points[from], points[b]))
                    .then(a.cmp(&b))
            });
            for to in nearby.into_iter().take(NEIGHBORS) {
                pairs.insert((from, to));
            }
        }
        let mut pairs: Vec<_> = pairs.into_iter().collect();
        pairs.sort_unstable();
        let mut proved = 0;
        for (from, to) in pairs {
            crate::cancel::check()?;
            if let Some(length) = walking(world, points[from], points[to])? {
                edges[from].push(Edge {
                    to,
                    cost: length / speed,
                    action: None,
                });
                proved += 1;
            }
        }
        if std::env::var_os("GANGLIA_PROFILE").is_some() {
            eprintln!(
                "{}",
                serde_json::json!({"native":"catalog","phase":"roadmap",
                "nodes":points.len(),"representatives":representatives.len(),"walks":proved})
            );
        }
        Ok(Self {
            points,
            edges,
            representatives,
            speed,
        })
    }

    fn nearby(&self, point: Point) -> Vec<usize> {
        let mut nodes: Vec<_> = self
            .representatives
            .iter()
            .copied()
            .filter(|&id| distance(point, self.points[id]) <= RADIUS * 2.)
            .collect();
        nodes.sort_by(|&a, &b| {
            distance(point, self.points[a])
                .total_cmp(&distance(point, self.points[b]))
                .then(a.cmp(&b))
        });
        nodes.truncate(NEIGHBORS);
        nodes
    }

    pub fn select(
        &self,
        world: &World,
        starts: &[(Point, f64)],
        goals: &[Point],
    ) -> Result<Option<Path>, String> {
        let mut starts = starts.to_vec();
        let mut combined = Path {
            actions: Vec::new(),
            walks: Vec::new(),
        };
        for &goal in goals {
            let Some(path) = self.select_leg(world, &starts, goal)? else {
                return Ok(None);
            };
            starts = vec![(path.walks.last().unwrap()[1], 0.)];
            combined.actions.extend(path.actions);
            combined.walks.extend(path.walks);
        }
        Ok(Some(combined))
    }

    fn select_leg(
        &self,
        world: &World,
        starts: &[(Point, f64)],
        goal: Point,
    ) -> Result<Option<Path>, String> {
        let Some(goal) = world.standing_foot(goal)? else {
            return Ok(None);
        };
        let mut finishes = HashMap::new();
        for id in self.nearby(goal) {
            if let Some(length) = walking(world, self.points[id], goal)? {
                finishes.insert(id, length / self.speed);
            }
        }
        if finishes.is_empty() {
            return Ok(None);
        }
        let mut costs = vec![f64::INFINITY; self.points.len()];
        let mut previous = vec![None; self.points.len()];
        let mut origins = vec![None; self.points.len()];
        let mut pending = BinaryHeap::new();
        for &(start, overhead) in starts {
            let Some(start) = world.standing_foot(start)? else {
                continue;
            };
            for id in self.nearby(start) {
                if let Some(length) = walking(world, start, self.points[id])? {
                    let cost = overhead + length / self.speed;
                    if cost < costs[id] {
                        costs[id] = cost;
                        origins[id] = Some(start);
                        pending.push(Label(cost, id));
                    }
                }
            }
        }
        let mut winner = None;
        let mut best = f64::INFINITY;
        while let Some(Label(cost, node)) = pending.pop() {
            crate::cancel::check()?;
            if cost != costs[node] {
                continue;
            }
            if cost >= best {
                break;
            }
            if let Some(tail) = finishes.get(&node)
                && cost + tail < best
            {
                best = cost + tail;
                winner = Some(node);
            }
            for (index, edge) in self.edges[node].iter().enumerate() {
                let next = cost + edge.cost;
                if next < costs[edge.to] {
                    costs[edge.to] = next;
                    previous[edge.to] = Some((node, index));
                    origins[edge.to] = None;
                    pending.push(Label(next, edge.to));
                }
            }
        }
        let Some(mut node) = winner else {
            return Ok(None);
        };
        let mut path = Path {
            actions: Vec::new(),
            walks: vec![[self.points[node], goal]],
        };
        while let Some((from, index)) = previous[node] {
            let edge = &self.edges[from][index];
            if let Some(action) = edge.action {
                path.actions.push(action);
            } else {
                path.walks.push([self.points[from], self.points[node]]);
            }
            node = from;
        }
        path.walks.push([origins[node].unwrap(), self.points[node]]);
        path.actions.reverse();
        path.walks.reverse();
        Ok(Some(path))
    }
}
