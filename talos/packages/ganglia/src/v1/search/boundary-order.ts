interface Entry {
  midpoint: readonly number[];
}
type TreeNode<T> = { slot: number } & (
  | { entries: T[]; entrySlots: Int32Array; children?: never }
  | { entries?: never; entrySlots?: never; children: TreeNode<T>[] }
);
export type BoundaryTree<T> = TreeNode<T> & {
  count: number;
  entryCount: number;
};
// The static hierarchy owns group order and stable slots. Per-query ranks and
// eligibility live in compact arrays, without constructing another full tree.
export const boundaryTree = <T extends Entry>(
  entries: T[],
  size: number,
  height: number,
  diversity: number,
): BoundaryTree<T> => {
  let serial = 0;
  const build = (items: T[], slots: number[], scale: number): TreeNode<T> => {
    const slot = serial++;
    if (items.length < 2 || scale <= diversity) {
      return { slot, entries: items, entrySlots: Int32Array.from(slots) };
    }
    const groups = new Map<string, { items: T[]; slots: number[] }>();
    for (let i = 0; i < items.length; i++) {
      const edge = items[i];
      const p = edge.midpoint;
      const key = `${Math.floor(p[0] / scale)}/${Math.floor(p[1] / height)}/${Math.floor(p[2] / scale)}`;
      let group = groups.get(key);
      if (!group) {
        group = { items: [], slots: [] };
        groups.set(key, group);
      }
      group.items.push(edge);
      group.slots.push(slots[i]);
    }
    const children: TreeNode<T>[] = [];
    for (const group of groups.values()) {
      children.push(build(group.items, group.slots, scale / 2));
    }
    return { slot, children };
  };
  const rootSlots = new Array<number>(entries.length);
  for (let i = 0; i < entries.length; i++) rootSlots[i] = i;
  const tree = build(entries, rootSlots, size);
  return Object.assign(tree, {
    count: serial,
    entryCount: entries.length,
  });
};
export const boundaryOrderIterator = <T>(
  tree: BoundaryTree<T>,
  eligible: (entry: T) => boolean,
  compare: (a: T, b: T) => number,
  limit: number,
): Generator<T> => {
  if (limit <= 0) return (function* () {})();
  const best = new Array<T | null>(tree.count),
    included = new Uint8Array(tree.entryCount);
  const rank = (node: TreeNode<T>): T | null => {
    let first: T | null = null;
    if (node.entries) {
      const entries = node.entries;
      const slots = node.entrySlots;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!eligible(entry)) continue;
        included[slots[i]] = 1;
        if (first === null || compare(entry, first) < 0) first = entry;
      }
    } else {
      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        const candidate = rank(children[i]);
        if (candidate !== null && (first === null || compare(candidate, first) < 0))
          first = candidate;
      }
    }
    best[node.slot] = first;
    return first;
  };
  // A region appears in a globally sorted list at its least-ranked eligible edge.
  // Only regions actually visited by the round-robin prefix need sorting/streams.
  const stream = function* (node: TreeNode<T>): Generator<T> {
    if (node.entries) {
      const entries = node.entries;
      const slots = node.entrySlots;
      const picked: T[] = [];
      for (let i = 0; i < entries.length; i++) {
        if (included[slots[i]]) picked.push(entries[i]);
      }
      if (picked.length > 1) picked.sort(compare);
      yield* picked;
      return;
    }
    let active = node.children
      .filter((child) => best[child.slot] !== null)
      .sort((a, b) => compare(best[a.slot]!, best[b.slot]!))
      .slice(0, limit)
      .map(stream);
    while (active.length) {
      const pending = [];
      for (const iterator of active) {
        const next = iterator.next();
        if (!next.done) {
          yield next.value;
          pending.push(iterator);
        }
      }
      active = pending;
    }
  };
  if (rank(tree) === null) return (function* () {})();
  return (function* (): Generator<T> {
    const iterator = stream(tree);
    for (let count = 0; count < limit; count++) {
      const next = iterator.next();
      if (next.done) return;
      yield next.value;
    }
  })();
};

export const boundaryOrder = <T>(
  tree: BoundaryTree<T>,
  eligible: (entry: T) => boolean,
  compare: (a: T, b: T) => number,
  limit: number,
): T[] => Array.from(boundaryOrderIterator(tree, eligible, compare, limit));

// The limit applies before deduplication, matching an interleaved array followed
// by a Set. Repeated boundaries still occupy their original ordering slots.
export function* interleaveBoundaryOrders<T>(orders: Iterable<T>[], limit: number): Generator<T> {
  let active = orders.map((order) => order[Symbol.iterator]());
  const seen = new Set<T>();
  let count = 0;
  while (active.length && count < limit) {
    const pending = [];
    for (const iterator of active) {
      if (count >= limit) break;
      const next = iterator.next();
      if (next.done) continue;
      pending.push(iterator);
      count++;
      if (seen.has(next.value)) continue;
      seen.add(next.value);
      yield next.value;
    }
    active = pending;
  }
}
