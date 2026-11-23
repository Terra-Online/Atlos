pub(super) fn components<I: Iterator<Item = usize>>(
    count: usize,
    targets: impl Fn(usize) -> I,
) -> (Vec<usize>, Vec<usize>) {
    let mut incoming = vec![Vec::new(); count];
    for from in 0..count {
        for to in targets(from) {
            incoming[to].push(from);
        }
    }

    // Finish a forward traversal, then assign its strongly connected
    // regions in reverse finish order. Both traversals use explicit stacks
    // because scene-sized paths can exhaust the native thread stack.
    let mut visited = vec![false; count];
    let mut finished = Vec::with_capacity(count);
    let mut stack = Vec::new();
    for start in 0..count {
        if visited[start] {
            continue;
        }
        visited[start] = true;
        stack.push((start, targets(start)));
        while let Some((node, edges)) = stack.last_mut() {
            if let Some(to) = edges.next() {
                if !visited[to] {
                    visited[to] = true;
                    stack.push((to, targets(to)));
                }
            } else {
                finished.push(*node);
                stack.pop();
            }
        }
    }
    let mut node = vec![usize::MAX; count];
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
    (node, sizes)
}
