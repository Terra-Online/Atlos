use super::Edge;
use crate::graph::components;

pub(super) struct Regions {
    pub node: Vec<usize>,
    outgoing: Vec<Vec<usize>>,
    upstream: Vec<usize>,
    downstream: Vec<usize>,
}

impl Regions {
    pub fn new(edges: &[Vec<Edge>]) -> Self {
        let (node, sizes) = components(edges.len(), |from| edges[from].iter().map(|edge| edge.to));

        // Region IDs are in topological order. Propagate the largest known
        // entry and exit regions, avoiding a transitive closure or counting
        // shared descendants repeatedly.
        let mut outgoing = vec![Vec::new(); sizes.len()];
        for (from, edges) in edges.iter().enumerate() {
            for edge in edges {
                if node[from] != node[edge.to] {
                    outgoing[node[from]].push(node[edge.to]);
                }
            }
        }
        let mut upstream = sizes.clone();
        let mut downstream = sizes;
        for (from, targets) in outgoing.iter_mut().enumerate() {
            targets.sort_unstable();
            targets.dedup();
            for &to in targets.iter() {
                upstream[to] = upstream[to].max(upstream[from]);
            }
        }
        for (from, targets) in outgoing.iter().enumerate().rev() {
            for &to in targets {
                downstream[from] = downstream[from].max(downstream[to]);
            }
        }
        Self {
            node,
            outgoing,
            upstream,
            downstream,
        }
    }

    pub fn count(&self) -> usize {
        self.outgoing.len()
    }
    pub fn has_connection(&self, (from, to): (usize, usize)) -> bool {
        from == to || self.outgoing[from].binary_search(&to).is_ok()
    }
    pub fn influence(&self, (from, to): (usize, usize)) -> (usize, usize) {
        let entry = self.upstream[from];
        let exit = self.downstream[to];
        (entry.min(exit), entry.max(exit))
    }
}
