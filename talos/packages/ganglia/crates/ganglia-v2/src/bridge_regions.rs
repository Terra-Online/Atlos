use super::Edge;

pub(super) struct Regions {
    pub node: Vec<usize>,
    outgoing: Vec<Vec<usize>>,
    upstream: Vec<usize>,
    downstream: Vec<usize>,
}

impl Regions {
    pub fn new(edges: &[Vec<Edge>]) -> Self {
        let mut incoming = vec![Vec::new(); edges.len()];
        for (from, outgoing) in edges.iter().enumerate() {
            for edge in outgoing {
                incoming[edge.to].push(from);
            }
        }

        // Finish a forward traversal, then assign its strongly connected
        // regions in reverse finish order. Both traversals use explicit stacks
        // because scene-sized paths can exhaust the native thread stack.
        let mut visited = vec![false; edges.len()];
        let mut finished = Vec::with_capacity(edges.len());
        let mut stack = Vec::new();
        for start in 0..edges.len() {
            if visited[start] {
                continue;
            }
            visited[start] = true;
            stack.push((start, 0));
            while let Some((node, next)) = stack.last_mut() {
                if let Some(edge) = edges[*node].get(*next) {
                    *next += 1;
                    if !visited[edge.to] {
                        visited[edge.to] = true;
                        stack.push((edge.to, 0));
                    }
                } else {
                    finished.push(*node);
                    stack.pop();
                }
            }
        }
        let mut node = vec![usize::MAX; edges.len()];
        let mut sizes = Vec::<usize>::new();
        let mut pending = Vec::new();
        for start in finished.into_iter().rev() {
            if node[start] != usize::MAX {
                continue;
            }
            let region = sizes.len();
            sizes.push(0);
            node[start] = region;
            pending.push(start);
            while let Some(current) = pending.pop() {
                sizes[region] += 1;
                for &previous in &incoming[current] {
                    if node[previous] == usize::MAX {
                        node[previous] = region;
                        pending.push(previous);
                    }
                }
            }
        }
        drop(incoming);

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
