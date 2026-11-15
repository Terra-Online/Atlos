//! Immutable directed topology. CSR keeps traversal contiguous; iterative SCC
//! construction handles large meshes without recursive stacks. Components mean
//! mutual reachability, so one-way drops never suppress a return transfer.
use super::Edge;

#[derive(Default)]
pub(super) struct Topology {
    offsets: Vec<usize>,
    pub edges: Vec<Edge>,
    pub components: Vec<usize>,
    pub members: Vec<Vec<usize>>,
}
impl Topology {
    pub fn new(adjacency: Vec<Vec<Edge>>) -> Self {
        let count = adjacency.len();
        let mut offsets = Vec::with_capacity(count + 1);
        let mut edges = Vec::new();
        offsets.push(0);
        for list in adjacency {
            edges.extend(list);
            offsets.push(edges.len());
        }
        let mut reverse_offsets = vec![0; count + 1];
        for edge in &edges {
            reverse_offsets[edge.to + 1] += 1;
        }
        for i in 1..=count {
            reverse_offsets[i] += reverse_offsets[i - 1];
        }
        let mut next = reverse_offsets.clone();
        let mut reverse = vec![0; edges.len()];
        for node in 0..count {
            for edge in &edges[offsets[node]..offsets[node + 1]] {
                reverse[next[edge.to]] = node;
                next[edge.to] += 1;
            }
        }
        let mut visited = vec![false; count];
        let mut order = Vec::with_capacity(count);
        let mut stack = Vec::new();
        for root in 0..count {
            if visited[root] {
                continue;
            }
            visited[root] = true;
            stack.push((root, offsets[root]));
            while let Some((node, next_edge)) = stack.last_mut() {
                if *next_edge == offsets[*node + 1] {
                    order.push(*node);
                    stack.pop();
                } else {
                    let target = edges[*next_edge].to;
                    *next_edge += 1;
                    if !visited[target] {
                        visited[target] = true;
                        stack.push((target, offsets[target]));
                    }
                }
            }
        }
        let mut components = vec![usize::MAX; count];
        let mut members = Vec::new();
        let mut pending = Vec::new();
        for root in order.into_iter().rev() {
            if components[root] != usize::MAX {
                continue;
            }
            let component = members.len();
            let mut nodes = Vec::new();
            components[root] = component;
            pending.push(root);
            while let Some(node) = pending.pop() {
                nodes.push(node);
                for &source in &reverse[reverse_offsets[node]..reverse_offsets[node + 1]] {
                    if components[source] == usize::MAX {
                        components[source] = component;
                        pending.push(source);
                    }
                }
            }
            members.push(nodes);
        }
        Self {
            offsets,
            edges,
            components,
            members,
        }
    }
    pub fn outgoing(&self, node: usize) -> impl Iterator<Item = (usize, &Edge)> {
        let start = self.offsets[node];
        self.edges[start..self.offsets[node + 1]]
            .iter()
            .enumerate()
            .map(move |(i, edge)| (start + i, edge))
    }
}
