export interface Bounds {
  min: readonly number[];
  max: readonly number[];
}
export type BoundsNode<T extends Bounds, G> = Bounds & { group?: G; uniform?: boolean } & (
    | { entries: T[]; left?: never; right?: never }
    | { entries?: undefined; left: BoundsNode<T, G>; right: BoundsNode<T, G> }
  );
export interface BoundsIndex<T extends Bounds, G = unknown> {
  (
    bounds: Bounds,
    target?: readonly number[],
    radius?: number,
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T>;
  nearest(
    bounds: Bounds,
    target: readonly number[],
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T>;
  empty: boolean;
  filter(eligible: (entry: T) => boolean): BoundsIndex<T, G>;
  filterGroups(eligible: (group: G) => boolean): BoundsIndex<T, G>;
}
const overlaps = (node: Bounds, bounds: Bounds) => {
  if (node.min.length === 3)
    return (
      node.min[0] <= bounds.max[0] &&
      node.max[0] >= bounds.min[0] &&
      node.min[1] <= bounds.max[1] &&
      node.max[1] >= bounds.min[1] &&
      node.min[2] <= bounds.max[2] &&
      node.max[2] >= bounds.min[2]
    );
  for (let axis = 0; axis < node.min.length; axis++) {
    if (!(node.min[axis] <= bounds.max[axis] && node.max[axis] >= bounds.min[axis])) return false;
  }
  return true;
};
const sphereTouches = (node: Bounds, target: readonly number[], radius: number) => {
  let squared = 0;
  for (let axis = 0; axis < node.min.length; axis++) {
    const distance = Math.max(node.min[axis] - target[axis], 0, target[axis] - node.max[axis]);
    squared += distance * distance;
  }
  return squared <= radius * radius;
};
export const createBoundsTree = <T extends Bounds, G = unknown>(
  surfaces: readonly T[],
): BoundsNode<T, G> | null => {
  const entries = [...surfaces];
  // Packed build-only columns avoid revisiting nested entry bounds at every
  // level. Leaves retain the original entries and no scratch columns.
  const order = new Uint32Array(entries.length);
  const lower = Array.from({ length: 3 }, () => new Float64Array(entries.length));
  const upper = Array.from({ length: 3 }, () => new Float64Array(entries.length));
  for (let index = 0; index < entries.length; index++) {
    order[index] = index;
    const entry = entries[index];
    for (let axis = 0; axis < 3; axis++) {
      lower[axis][index] = entry.min[axis];
      upper[axis][index] = entry.max[axis];
    }
  }
  // Median partitioning avoids sorting every subtree. Equal centres form one
  // partition, so coincident or elongated bounds still terminate in balanced leaves.
  const select = (start: number, end: number, middle: number, axis: number) => {
    const minima = lower[axis] ?? [],
      maxima = upper[axis] ?? [];
    const center = (index: number) => minima[order[index]] + maxima[order[index]];
    while (end - start > 1) {
      const first = center(start),
        last = center(end - 1),
        mid = center(Math.floor((start + end) / 2));
      const pivot = Math.max(Math.min(first, last), Math.min(Math.max(first, last), mid));
      let lower = start,
        current = start,
        upper = end;
      while (current < upper) {
        const value = center(current);
        if (value < pivot) {
          const other = order[lower];
          order[lower] = order[current];
          order[current] = other;
          lower++;
          current++;
        } else if (value > pivot) {
          upper--;
          const other = order[upper];
          order[upper] = order[current];
          order[current] = other;
        } else current++;
      }
      if (middle < lower) end = lower;
      else if (middle >= upper) start = upper;
      else return;
    }
  };
  const build = (start: number, end: number): BoundsNode<T, G> => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (let index = start; index < end; index++) {
      const id = order[index];
      min[0] = Math.min(min[0], lower[0][id]);
      max[0] = Math.max(max[0], upper[0][id]);
      min[1] = Math.min(min[1], lower[1][id]);
      max[1] = Math.max(max[1], upper[1][id]);
      min[2] = Math.min(min[2], lower[2][id]);
      max[2] = Math.max(max[2], upper[2][id]);
    }
    if (end - start <= 8)
      return {
        min,
        max,
        entries: Array.from(order.subarray(start, end), (index) => entries[index]),
      };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    const middle = Math.floor((start + end) / 2);
    select(start, end, middle, axis);
    return { min, max, left: build(start, middle), right: build(middle, end) };
  };
  return entries.length ? build(0, entries.length) : null;
};
export const createBoundsIndex = <T extends Bounds, G = unknown>(
  surfaces: readonly T[],
  groupOf?: (entry: T) => G,
): BoundsIndex<T, G> => {
  const root = createBoundsTree<T, G>(surfaces);
  // Uniform subtrees can be accepted or excluded without visiting every leaf.
  // Their grouping is immutable; callers explicitly filter group IDs, not entries.
  const annotate = (node: BoundsNode<T, G> | null): void => {
    if (!node) return;
    if (node.entries) {
      node.group = groupOf!(node.entries[0]);
      node.uniform = node.entries.every((entry) => groupOf!(entry) === node.group);
    } else {
      annotate(node.left);
      annotate(node.right);
      node.group = node.left.group;
      node.uniform =
        node.left.uniform && node.right.uniform && node.left.group === node.right.group;
    }
  };
  if (groupOf) annotate(root);
  return fromRoot(root, groupOf);
};
// Filtered views reuse the immutable hierarchy. Repeated movement frontiers
// change eligibility, without requiring another spatial sort of the same faces.
const filterNode = <T extends Bounds, G>(
  node: BoundsNode<T, G> | null,
  eligible: (entry: T) => boolean,
): BoundsNode<T, G> | null => {
  if (!node) return null;
  if (node.entries) {
    const entries = node.entries.filter(eligible);
    if (!entries.length) return null;
    return entries.length === node.entries.length ? node : { ...node, entries };
  }
  const left = filterNode(node.left, eligible),
    right = filterNode(node.right, eligible);
  if (!left) return right;
  if (!right) return left;
  return left === node.left && right === node.right ? node : { ...node, left, right };
};
const filterGroups = <T extends Bounds, G>(
  node: BoundsNode<T, G> | null,
  eligible: (group: G) => boolean,
  groupOf: (entry: T) => G,
): BoundsNode<T, G> | null => {
  if (!node) return null;
  if (node.uniform) return eligible(node.group!) ? node : null;
  if (node.entries) {
    const entries = node.entries.filter((entry) => eligible(groupOf(entry)));
    if (!entries.length) return null;
    return entries.length === node.entries.length ? node : { ...node, entries };
  }
  const left = filterGroups(node.left, eligible, groupOf),
    right = filterGroups(node.right, eligible, groupOf);
  if (!left) return right;
  if (!right) return left;
  return left === node.left && right === node.right ? node : { ...node, left, right };
};
const fromRoot = <T extends Bounds, G>(
  root: BoundsNode<T, G> | null,
  groupOf?: (entry: T) => G,
): BoundsIndex<T, G> => {
  // A conservative intersects predicate can reject an entire spatial subtree.
  // It receives both node and entry bounds, so false must exclude every point
  // in that box. Entry-only eligibility belongs in filter/filterGroups instead.
  const query = function* (
    bounds: Bounds,
    target?: readonly number[],
    radius?: number,
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T> {
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop()!;
      if (
        !overlaps(node, bounds) ||
        (radius !== undefined && !sphereTouches(node, target!, radius)) ||
        (intersects && !intersects(node))
      )
        continue;
      if (node.entries) {
        for (const entry of node.entries) {
          if (
            overlaps(entry, bounds) &&
            (radius === undefined || sphereTouches(entry, target!, radius)) &&
            (!intersects || intersects(entry))
          )
            yield entry;
        }
      } else {
        stack.push(node.left, node.right);
      }
    }
  };
  query.nearest = function* (
    bounds: Bounds,
    target: readonly number[],
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T> {
    if (!root) return;
    // Parallel heap columns retain the original comparisons and tie order without
    // allocating a wrapper for every visited spatial node and candidate entry.
    const nodes: (BoundsNode<T, G> | T)[] = [],
      costs: number[] = [],
      entries: boolean[] = [];
    const enqueue = (node: BoundsNode<T, G> | T, entry = false) => {
      if (!overlaps(node, bounds) || (intersects && !intersects(node))) return;
      let cost = 0;
      if (node.min.length === 3) {
        cost += Math.max(node.min[0] - target[0], 0, target[0] - node.max[0]) ** 2;
        cost += Math.max(node.min[1] - target[1], 0, target[1] - node.max[1]) ** 2;
        cost += Math.max(node.min[2] - target[2], 0, target[2] - node.max[2]) ** 2;
      } else
        for (let axis = 0; axis < node.min.length; axis++) {
          cost += Math.max(node.min[axis] - target[axis], 0, target[axis] - node.max[axis]) ** 2;
        }
      let index = nodes.length;
      nodes.push(node);
      costs.push(cost);
      entries.push(entry);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (costs[parent] <= cost) break;
        nodes[index] = nodes[parent];
        costs[index] = costs[parent];
        entries[index] = entries[parent];
        index = parent;
      }
      nodes[index] = node;
      costs[index] = cost;
      entries[index] = entry;
    };
    if (root) enqueue(root);
    while (nodes.length) {
      const node = nodes[0],
        entry = entries[0];
      const lastNode = nodes.pop()!,
        lastCost = costs.pop()!,
        lastEntry = entries.pop()!;
      if (nodes.length) {
        let index = 0;
        while (index * 2 + 1 < nodes.length) {
          let child = index * 2 + 1;
          if (child + 1 < nodes.length && costs[child + 1] < costs[child]) child++;
          if (costs[child] >= lastCost) break;
          nodes[index] = nodes[child];
          costs[index] = costs[child];
          entries[index] = entries[child];
          index = child;
        }
        nodes[index] = lastNode;
        costs[index] = lastCost;
        entries[index] = lastEntry;
      }
      if (entry) {
        yield node as T;
        continue;
      }
      const branch = node as BoundsNode<T, G>;
      if (branch.entries) for (const value of branch.entries) enqueue(value, true);
      else {
        enqueue(branch.left);
        enqueue(branch.right);
      }
    }
  };
  query.empty = !root;
  query.filter = (eligible: (entry: T) => boolean) => fromRoot(filterNode(root, eligible), groupOf);
  query.filterGroups = (eligible: (group: G) => boolean) => {
    if (!groupOf) throw new Error('Bounds index has no immutable groups');
    return fromRoot(filterGroups(root, eligible, groupOf), groupOf);
  };
  return query;
};
