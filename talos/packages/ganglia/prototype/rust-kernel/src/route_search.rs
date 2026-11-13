use napi::bindgen_prelude::{Float64Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;
use std::collections::{HashMap, HashSet};

const NONE: u32 = u32::MAX;
type Point = [f64; 3];
#[napi(object)]
pub struct RouteSnapshot {
    pub positions: Float64Array,
    pub from: Uint32Array,
    pub to: Uint32Array,
    pub costs: Float64Array,
}
#[napi(object)]
pub struct RouteQuery {
    pub positions: Float64Array,
    pub from: Uint32Array,
    pub to: Uint32Array,
    pub costs: Float64Array,
    pub seed_nodes: Uint32Array,
    pub seed_costs: Float64Array,
    pub seed_priorities: Float64Array,
    pub goals: Uint32Array,
    pub target_key: String,
    pub estimate_denominator: Option<f64>,
}
#[napi(object)]
pub struct RouteResult {
    pub reverse_path: Uint32Array,
    pub root: u32,
    pub origin: u32,
    pub cost: f64,
    pub arrival_cost: f64,
}
#[derive(Clone, Copy)]
struct Edge {
    from: u32,
    to: u32,
    cost: f64,
}
struct Base {
    positions: Vec<Point>,
    edges: Vec<Edge>,
    offsets: Vec<usize>,
    rows: Vec<u32>,
}
struct Overlay<'a> {
    query: &'a RouteQuery,
    rows: HashMap<u32, Vec<usize>>,
}
impl Overlay<'_> {
    fn edge(&self, index: usize) -> Edge {
        Edge {
            from: self.query.from[index],
            to: self.query.to[index],
            cost: self.query.costs[index],
        }
    }
    fn position(&self, base: &Base, node: u32) -> Point {
        if (node as usize) < base.positions.len() {
            return base.positions[node as usize];
        }
        let index = (node as usize - base.positions.len()) * 3;
        [
            self.query.positions[index],
            self.query.positions[index + 1],
            self.query.positions[index + 2],
        ]
    }
}
#[derive(Clone, Copy)]
struct Item {
    node: u32,
    travelled: f64,
    priority: f64,
}
// Mirror the JavaScript heap comparisons. IDs never break equal or infinite
// priorities, and NaN priorities follow the same comparison fall-through.
fn push(heap: &mut Vec<Item>, item: Item) {
    let mut index = heap.len();
    heap.push(item);
    while index > 0 {
        let parent = (index - 1) >> 1;
        if heap[parent].priority <= item.priority {
            break;
        }
        heap[index] = heap[parent];
        index = parent;
    }
    heap[index] = item;
}
fn pop(heap: &mut Vec<Item>) -> Option<Item> {
    let first = *heap.first()?;
    let last = heap.pop().unwrap();
    if !heap.is_empty() {
        let mut index = 0;
        while index * 2 + 1 < heap.len() {
            let mut child = index * 2 + 1;
            if child + 1 < heap.len() && heap[child + 1].priority < heap[child].priority {
                child += 1;
            }
            if heap[child].priority >= last.priority {
                break;
            }
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = last;
    }
    Some(first)
}
fn invalid() -> Error {
    Error::from_reason("Invalid prepared route search inputs")
}
fn distance(a: Point, b: Point) -> f64 {
    if (0..3).any(|axis| (a[axis] - b[axis]).is_infinite()) {
        f64::INFINITY
    } else {
        super::distance(a, b)
    }
}
#[derive(Default)]
struct Labels {
    generation: u32,
    stamps: Vec<u32>,
    costs: Vec<f64>,
    previous: Vec<u32>,
    origins: Vec<u32>,
    heap: Vec<Item>,
}
impl Labels {
    fn begin(&mut self, count: usize) {
        if self.stamps.len() < count {
            self.stamps.resize(count, 0);
            self.costs.resize(count, 0.0);
            self.previous.resize(count, NONE);
            self.origins.resize(count, NONE);
        }
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.stamps.fill(0);
            self.generation = 1;
        }
        self.heap.clear();
    }
    fn cost(&self, node: u32) -> f64 {
        if self.stamps[node as usize] == self.generation {
            self.costs[node as usize]
        } else {
            f64::INFINITY
        }
    }
    fn set(&mut self, node: u32, cost: f64, previous: u32, origin: u32) {
        let node = node as usize;
        self.stamps[node] = self.generation;
        self.costs[node] = cost;
        self.previous[node] = previous;
        self.origins[node] = origin;
    }
}
struct Estimates {
    target_key: Option<String>,
    generation: u32,
    stamps: Vec<u32>,
    distances: Vec<f64>,
}
impl Estimates {
    fn new(count: usize) -> Self {
        Self {
            target_key: None,
            generation: 0,
            stamps: vec![0; count],
            distances: vec![0.0; count],
        }
    }
    fn begin(&mut self, key: &str) {
        if self.target_key.as_deref() == Some(key) {
            return;
        }
        self.target_key = Some(key.to_owned());
        self.generation = self.generation.wrapping_add(1);
        if self.generation == 0 {
            self.stamps.fill(0);
            self.generation = 1;
        }
    }
    fn estimate(
        &mut self,
        node: u32,
        base: &Base,
        overlay: &Overlay,
        extra: &mut [Option<f64>],
    ) -> f64 {
        let Some(denominator) = overlay.query.estimate_denominator else {
            return 0.0;
        };
        let index = node as usize;
        let cached = if index < base.positions.len() {
            (self.stamps[index] == self.generation).then(|| self.distances[index])
        } else {
            extra[index - base.positions.len()]
        };
        let best = cached.unwrap_or_else(|| {
            let position = overlay.position(base, node);
            let mut best = f64::INFINITY;
            for &goal in overlay.query.goals.iter() {
                let next = distance(position, overlay.position(base, goal));
                // Math.min propagates NaN rather than selecting the other input.
                best = if best.is_nan() || next.is_nan() {
                    f64::NAN
                } else {
                    best.min(next)
                };
            }
            if index < base.positions.len() {
                self.stamps[index] = self.generation;
                self.distances[index] = best;
            } else {
                extra[index - base.positions.len()] = Some(best);
            }
            best
        });
        best / denominator
    }
}

#[napi]
pub struct RouteSearchIndex {
    base: Base,
    labels: Labels,
    estimates: Estimates,
}
#[napi]
impl RouteSearchIndex {
    #[napi(constructor)]
    pub fn new(snapshot: RouteSnapshot) -> Result<Self> {
        let count = snapshot.positions.len() / 3;
        if snapshot.positions.len() % 3 != 0
            || snapshot.from.len() != snapshot.to.len()
            || snapshot.from.len() != snapshot.costs.len()
            || snapshot
                .from
                .iter()
                .chain(snapshot.to.iter())
                .any(|&id| id as usize >= count)
        {
            return Err(invalid());
        }
        let positions = snapshot.positions.as_chunks::<3>().0.to_vec();
        let mut edges = Vec::with_capacity(snapshot.from.len());
        let mut offsets = vec![0; count + 1];
        for index in 0..snapshot.from.len() {
            edges.push(Edge {
                from: snapshot.from[index],
                to: snapshot.to[index],
                cost: snapshot.costs[index],
            });
            offsets[snapshot.from[index] as usize + 1] += 1;
        }
        for node in 1..offsets.len() {
            offsets[node] += offsets[node - 1];
        }
        let mut next = offsets[..count].to_vec();
        let mut rows = vec![0; edges.len()];
        for (id, edge) in edges.iter().enumerate() {
            rows[next[edge.from as usize]] = id as u32;
            next[edge.from as usize] += 1;
        }
        Ok(Self {
            base: Base {
                positions,
                edges,
                offsets,
                rows,
            },
            labels: Labels::default(),
            estimates: Estimates::new(count),
        })
    }
    #[napi]
    pub fn search(&mut self, query: RouteQuery) -> Result<Option<RouteResult>> {
        let extra_count = query.positions.len() / 3;
        let count = self.base.positions.len() + extra_count;
        if query.positions.len() % 3 != 0
            || query.from.len() != query.to.len()
            || query.from.len() != query.costs.len()
            || query.seed_nodes.len() != query.seed_costs.len()
            || query.seed_nodes.len() != query.seed_priorities.len()
            || query
                .from
                .iter()
                .chain(query.to.iter())
                .chain(query.seed_nodes.iter())
                .chain(query.goals.iter())
                .any(|&id| id as usize >= count)
        {
            return Err(invalid());
        }
        let base = &self.base;
        let labels = &mut self.labels;
        let estimates = &mut self.estimates;
        labels.begin(count);
        estimates.begin(&query.target_key);
        let mut overlay = Overlay {
            query: &query,
            rows: HashMap::new(),
        };
        for (id, &from) in query.from.iter().enumerate() {
            overlay.rows.entry(from).or_default().push(id);
        }
        let mut extra_estimates = vec![None; extra_count];
        let goals: HashSet<_> = query.goals.iter().copied().collect();
        // Every improving JS seed is retained, even if a later seed makes it
        // stale. Removing those entries would change the heap's equal-key shape.
        for index in 0..query.seed_nodes.len() {
            let node = query.seed_nodes[index];
            let cost = query.seed_costs[index];
            if cost < labels.cost(node) {
                labels.set(node, cost, NONE, index as u32);
                push(
                    &mut labels.heap,
                    Item {
                        node,
                        travelled: cost,
                        priority: query.seed_priorities[index],
                    },
                );
            }
        }
        while let Some(item) = pop(&mut labels.heap) {
            if item.travelled != labels.cost(item.node) {
                continue;
            }
            if goals.contains(&item.node) {
                let mut path = Vec::new();
                let mut root = item.node;
                while labels.previous[root as usize] != NONE {
                    let edge = labels.previous[root as usize];
                    path.push(edge);
                    root = if (edge as usize) < base.edges.len() {
                        base.edges[edge as usize].from
                    } else {
                        overlay.edge(edge as usize - base.edges.len()).from
                    };
                }
                return Ok(Some(RouteResult {
                    reverse_path: path.into(),
                    root,
                    origin: labels.origins[item.node as usize],
                    cost: labels.cost(item.node),
                    arrival_cost: labels.cost(root),
                }));
            }
            let node = item.node as usize;
            let base_row = if node < base.positions.len() {
                &base.rows[base.offsets[node]..base.offsets[node + 1]]
            } else {
                &[]
            };
            let extra_row = overlay
                .rows
                .get(&item.node)
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            for (id, edge) in base_row
                .iter()
                .map(|&id| (id, base.edges[id as usize]))
                .chain(
                    extra_row
                        .iter()
                        .map(|&id| ((base.edges.len() + id) as u32, overlay.edge(id))),
                )
            {
                let cost = labels.cost(item.node) + edge.cost;
                if cost < labels.cost(edge.to) {
                    labels.set(edge.to, cost, id, labels.origins[node]);
                    let estimate =
                        estimates.estimate(edge.to, base, &overlay, &mut extra_estimates);
                    push(
                        &mut labels.heap,
                        Item {
                            node: edge.to,
                            travelled: cost,
                            priority: cost + estimate,
                        },
                    );
                }
            }
        }
        Ok(None)
    }
}
