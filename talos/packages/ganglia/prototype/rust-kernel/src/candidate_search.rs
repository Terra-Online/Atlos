use napi::bindgen_prelude::{Float64Array, Int32Array, Uint32Array};
use napi::{Error, Result};
use napi_derive::napi;
use std::collections::HashSet;

const NONE: u32 = u32::MAX;
#[derive(Clone, Copy)]
struct Item {
    node: usize,
    cost: f64,
}
struct Edge {
    to: usize,
    penalty: f64,
    length: f64,
    bounds: Option<usize>,
}
struct Region {
    from: i32,
    to: i32,
    bounds: [f64; 6],
}
#[derive(Default)]
struct Search {
    scores: Vec<f64>,
    previous: Vec<u32>,
    parents: Vec<u32>,
    origins: Vec<u32>,
    heap: Vec<Item>,
    pending: Option<Item>,
    end: usize,
    excluded: HashSet<u32>,
    regions: Vec<Region>,
}
// Equal keys deliberately have no node or insertion-order tiebreaker. These
// operations mirror the JavaScript heap's comparisons and child selection.
fn push(heap: &mut Vec<Item>, item: Item) {
    let mut index = heap.len();
    heap.push(item);
    while index > 0 {
        let parent = (index - 1) >> 1;
        if heap[parent].cost <= item.cost {
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
            if child + 1 < heap.len() && heap[child + 1].cost < heap[child].cost {
                child += 1;
            }
            if heap[child].cost >= last.cost {
                break;
            }
            heap[index] = heap[child];
            index = child;
        }
        heap[index] = last;
    }
    Some(first)
}

#[napi]
pub struct CandidateSearchIndex {
    expand_components: Vec<i32>,
    logical_components: Vec<i32>,
    rows: Vec<Vec<u32>>,
    edges: Vec<Edge>,
    bounds: Vec<[f64; 6]>,
    expanded: HashSet<i32>,
    search: Search,
}
#[napi]
impl CandidateSearchIndex {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            expand_components: Vec::new(),
            logical_components: Vec::new(),
            rows: Vec::new(),
            edges: Vec::new(),
            bounds: Vec::new(),
            expanded: HashSet::new(),
            search: Search::default(),
        }
    }
    #[napi]
    pub fn append_nodes(&mut self, expand: Int32Array, logical: Int32Array) -> Result<()> {
        if expand.len() != logical.len() {
            return Err(Error::from_reason("Invalid candidate nodes"));
        }
        self.expand_components.extend_from_slice(&expand);
        self.logical_components.extend_from_slice(&logical);
        self.rows
            .resize_with(self.expand_components.len(), Vec::new);
        Ok(())
    }
    #[napi]
    pub fn append_edges(
        &mut self,
        targets: Uint32Array,
        penalties: Float64Array,
        lengths: Float64Array,
        boxes: Float64Array,
    ) -> Result<()> {
        if targets.len() != penalties.len()
            || targets.len() != lengths.len()
            || boxes.len() % 7 != 0
        {
            return Err(Error::from_reason("Invalid candidate edges"));
        }
        let first = self.edges.len();
        for index in 0..targets.len() {
            if targets[index] as usize >= self.rows.len() {
                return Err(Error::from_reason("Invalid candidate target"));
            }
            self.edges.push(Edge {
                to: targets[index] as usize,
                penalty: penalties[index],
                length: lengths[index],
                bounds: None,
            });
        }
        for record in boxes.chunks_exact(7) {
            let index = record[0] as usize;
            if index >= targets.len() {
                return Err(Error::from_reason("Invalid candidate bounds"));
            }
            self.edges[first + index].bounds = Some(self.bounds.len());
            self.bounds.push([
                record[1], record[2], record[3], record[4], record[5], record[6],
            ]);
        }
        Ok(())
    }
    #[napi]
    pub fn set_rows(
        &mut self,
        nodes: Uint32Array,
        offsets: Uint32Array,
        edges: Uint32Array,
    ) -> Result<()> {
        if offsets.len() != nodes.len() + 1
            || offsets[0] != 0
            || offsets[nodes.len()] as usize != edges.len()
        {
            return Err(Error::from_reason("Invalid candidate adjacency"));
        }
        for (index, node) in nodes.iter().enumerate() {
            let low = offsets[index] as usize;
            let high = offsets[index + 1] as usize;
            if *node as usize >= self.rows.len()
                || low > high
                || high > edges.len()
                || edges[low..high]
                    .iter()
                    .any(|edge| *edge as usize >= self.edges.len())
            {
                return Err(Error::from_reason("Invalid candidate row"));
            }
            let row = &mut self.rows[*node as usize];
            row.clear();
            row.extend_from_slice(&edges[low..high]);
        }
        Ok(())
    }
    #[napi]
    pub fn start(
        &mut self,
        end: u32,
        nodes: Uint32Array,
        costs: Float64Array,
        origins: Uint32Array,
        excluded: Uint32Array,
        regions: Float64Array,
    ) -> Result<Float64Array> {
        if end as usize >= self.rows.len()
            || nodes.len() != costs.len()
            || nodes.len() != origins.len()
            || regions.len() % 8 != 0
            || nodes.iter().any(|node| *node as usize >= self.rows.len())
        {
            return Err(Error::from_reason("Invalid candidate search"));
        }
        let search = &mut self.search;
        search.scores.resize(self.rows.len(), f64::INFINITY);
        search.scores.fill(f64::INFINITY);
        search.previous.resize(self.rows.len(), NONE);
        search.previous.fill(NONE);
        search.parents.resize(self.rows.len(), NONE);
        search.parents.fill(NONE);
        search.origins.resize(self.rows.len(), NONE);
        search.origins.fill(NONE);
        search.heap.clear();
        search.pending = None;
        search.end = end as usize;
        search.excluded.clear();
        search.excluded.extend(excluded.iter().copied());
        search.regions.clear();
        for region in regions.chunks_exact(8) {
            search.regions.push(Region {
                from: region[0] as i32,
                to: region[1] as i32,
                bounds: [
                    region[2], region[3], region[4], region[5], region[6], region[7],
                ],
            });
        }
        for index in 0..nodes.len() {
            let node = nodes[index] as usize;
            let cost = costs[index];
            if cost >= search.scores[node] {
                continue;
            }
            search.scores[node] = cost;
            search.origins[node] = origins[index];
            push(&mut search.heap, Item { node, cost });
        }
        Ok(self.run())
    }
    #[napi]
    pub fn resume(&mut self, component: i32, excluded: Uint32Array) -> Result<Float64Array> {
        let current = self
            .search
            .pending
            .ok_or_else(|| Error::from_reason("Candidate search is not suspended"))?;
        if self.expand_components[current.node] != component {
            return Err(Error::from_reason("Unexpected candidate component"));
        }
        self.expanded.insert(component);
        self.search.excluded.extend(excluded.iter().copied());
        Ok(self.run())
    }
}
impl CandidateSearchIndex {
    fn run(&mut self) -> Float64Array {
        let search = &mut self.search;
        loop {
            let current = search.pending.take().or_else(|| pop(&mut search.heap));
            let Some(current) = current else {
                break;
            };
            if current.cost != search.scores[current.node] {
                continue;
            }
            if current.node == search.end {
                break;
            }
            let component = self.expand_components[current.node];
            if component >= 0 && !self.expanded.contains(&component) {
                // Keep the popped entry out of the heap while JavaScript expands
                // and sorts its component. Reinsertion would reorder equal keys.
                search.pending = Some(current);
                return vec![0.0, component as f64].into();
            }
            for index in &self.rows[current.node] {
                if search.excluded.contains(index) {
                    continue;
                }
                let edge = &self.edges[*index as usize];
                if let Some(box_index) = edge.bounds {
                    let bounds = self.bounds[box_index];
                    if search.regions.iter().any(|region| {
                        region.from == self.logical_components[current.node]
                            && region.to == self.logical_components[edge.to]
                            && (0..3).all(|axis| {
                                bounds[axis] >= region.bounds[axis]
                                    && bounds[axis + 3] <= region.bounds[axis + 3]
                            })
                    }) {
                        continue;
                    }
                }
                // Preserve the JavaScript expression's left-to-right additions.
                let with_penalty = current.cost + edge.penalty;
                let score = with_penalty + edge.length;
                if score >= search.scores[edge.to] {
                    continue;
                }
                search.scores[edge.to] = score;
                search.previous[edge.to] = *index;
                search.parents[edge.to] = current.node as u32;
                search.origins[edge.to] = search.origins[current.node];
                push(
                    &mut search.heap,
                    Item {
                        node: edge.to,
                        cost: score,
                    },
                );
            }
        }
        if !search.scores[search.end].is_finite() {
            return vec![2.0].into();
        }
        let mut path = Vec::new();
        let mut node = search.end;
        while search.previous[node] != NONE {
            path.push(search.previous[node] as f64);
            node = search.parents[node] as usize;
        }
        path.reverse();
        let mut result = vec![
            1.0,
            search.scores[search.end],
            search.origins[search.end] as f64,
        ];
        result.extend(path);
        result.into()
    }
}
