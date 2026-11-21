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
  /** Zero-allocation synchronous box scan for hot internal loops (avoids generator overhead). */
  forEachBox(
    minX: number,
    minY: number,
    minZ: number,
    maxX: number,
    maxY: number,
    maxZ: number,
    visitor: (entry: T) => void,
  ): void;
  nearest(
    bounds: Bounds,
    target: readonly number[],
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T>;
  empty: boolean;
  filter(eligible: (entry: T) => boolean): BoundsIndex<T, G>;
  filterGroups(eligible: (group: G) => boolean): BoundsIndex<T, G>;
}

// Median partitioning avoids sorting every subtree. Equal centres form one
// partition, so coincident or elongated bounds still terminate in balanced leaves.
const selectMedian = (
  order: Uint32Array,
  minima: Float64Array,
  maxima: Float64Array,
  start: number,
  end: number,
  middle: number,
) => {
  while (end - start > 1) {
    const first = minima[order[start]] + maxima[order[start]];
    const last = minima[order[end - 1]] + maxima[order[end - 1]];
    const midIdx = (start + end) >>> 1;
    const mid = minima[order[midIdx]] + maxima[order[midIdx]];
    const lo = first < last ? first : last;
    const hi = first > last ? first : last;
    const pivot = lo > (hi < mid ? hi : mid) ? lo : hi < mid ? hi : mid;
    let lower = start;
    let current = start;
    let upper = end;
    while (current < upper) {
      const id = order[current];
      const value = minima[id] + maxima[id];
      if (value < pivot) {
        order[current] = order[lower];
        order[lower] = id;
        lower++;
        current++;
      } else if (value > pivot) {
        upper--;
        order[current] = order[upper];
        order[upper] = id;
      } else {
        current++;
      }
    }
    if (middle < lower) end = lower;
    else if (middle >= upper) start = upper;
    else return;
  }
};

export const createBoundsTree = <T extends Bounds, G = unknown>(
  surfaces: readonly T[],
): BoundsNode<T, G> | null => {
  const count = surfaces.length;
  if (count === 0) return null;
  const entries = [...surfaces];
  // Packed build-only columns avoid revisiting nested entry bounds at every
  // level. Leaves retain the original entries and no scratch columns.
  const order = new Uint32Array(count);
  const lower0 = new Float64Array(count);
  const lower1 = new Float64Array(count);
  const lower2 = new Float64Array(count);
  const upper0 = new Float64Array(count);
  const upper1 = new Float64Array(count);
  const upper2 = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    order[index] = index;
    const entry = entries[index];
    lower0[index] = entry.min[0];
    lower1[index] = entry.min[1];
    lower2[index] = entry.min[2];
    upper0[index] = entry.max[0];
    upper1[index] = entry.max[1];
    upper2[index] = entry.max[2];
  }
  const build = (start: number, end: number): BoundsNode<T, G> => {
    let min0 = Infinity,
      min1 = Infinity,
      min2 = Infinity;
    let max0 = -Infinity,
      max1 = -Infinity,
      max2 = -Infinity;
    for (let index = start; index < end; index++) {
      const id = order[index];
      const l0 = lower0[id],
        u0 = upper0[id];
      const l1 = lower1[id],
        u1 = upper1[id];
      const l2 = lower2[id],
        u2 = upper2[id];
      if (l0 < min0) min0 = l0;
      if (u0 > max0) max0 = u0;
      if (l1 < min1) min1 = l1;
      if (u1 > max1) max1 = u1;
      if (l2 < min2) min2 = l2;
      if (u2 > max2) max2 = u2;
    }
    const min = [min0, min1, min2];
    const max = [max0, max1, max2];
    const size = end - start;
    if (size <= 8) {
      const leaf = new Array<T>(size);
      for (let i = 0; i < size; i++) leaf[i] = entries[order[start + i]];
      return { min, max, entries: leaf };
    }
    const s0 = max0 - min0;
    const s1 = max1 - min1;
    const s2 = max2 - min2;
    const middle = (start + end) >>> 1;
    if (s0 >= s1 && s0 >= s2) selectMedian(order, lower0, upper0, start, end, middle);
    else if (s1 >= s2) selectMedian(order, lower1, upper1, start, end, middle);
    else selectMedian(order, lower2, upper2, start, end, middle);
    return { min, max, left: build(start, middle), right: build(middle, end) };
  };
  return build(0, count);
};

// Immutable flat BVH storage for BoundsIndex.
// - nodeBoxes[n * 6 .. +5]: [minX, minY, minZ, maxX, maxY, maxZ]
// - nodeLeft[n] >= 0: internal node with children (nodeLeft[n], nodeRight[n])
// - nodeLeft[n] < 0: leaf covering packed entries [~nodeLeft[n], nodeRight[n])
// Filtered views share this immutable base and store only newly created pruned
// nodes/leaves in a small overlay (`extra*`), preserving O(changed) filterGroups
// while giving unfiltered queries contiguous TypedArray scans with zero GC load.
interface FlatBoundsBase<T extends Bounds, G> {
  nodeCount: number;
  nodeBoxes: Float64Array;
  nodeLeft: Int32Array;
  nodeRight: Int32Array;
  nodeUniform: Uint8Array | null;
  nodeGroup: (G | undefined)[] | null;
  entries: T[];
  entryBoxes: Float64Array;
  groupOf?: (entry: T) => G;
}

interface FlatBoundsOverlay<T extends Bounds, G> {
  // Overlay node IDs start at base.nodeCount.
  // For overlay leaves, nodeLeft[k] = ~startEntrySlot (indexing extraEntries/extraEntryBoxes).
  nodeBoxes: number[];
  nodeLeft: number[];
  nodeRight: number[];
  nodeUniform: number[] | null;
  nodeGroup: (G | undefined)[] | null;
  entries: T[];
  entryBoxes: number[];
}

const boxDistSq3 = (
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  tx: number,
  ty: number,
  tz: number,
): number => {
  const dx = minX > tx ? minX - tx : tx > maxX ? tx - maxX : 0;
  const dy = minY > ty ? minY - ty : ty > maxY ? ty - maxY : 0;
  const dz = minZ > tz ? minZ - tz : tz > maxZ ? tz - maxZ : 0;
  return dx * dx + dy * dy + dz * dz;
};

export const createBoundsIndex = <T extends Bounds, G = unknown>(
  surfaces: readonly T[],
  groupOf?: (entry: T) => G,
): BoundsIndex<T, G> => {
  const count = surfaces.length;
  if (count === 0) {
    const emptyBase: FlatBoundsBase<T, G> = {
      nodeCount: 0,
      nodeBoxes: new Float64Array(0),
      nodeLeft: new Int32Array(0),
      nodeRight: new Int32Array(0),
      nodeUniform: groupOf ? new Uint8Array(0) : null,
      nodeGroup: groupOf ? [] : null,
      entries: [],
      entryBoxes: new Float64Array(0),
      groupOf,
    };
    return fromFlat(emptyBase, -1, null);
  }

  const order = new Uint32Array(count);
  const lower0 = new Float64Array(count);
  const lower1 = new Float64Array(count);
  const lower2 = new Float64Array(count);
  const upper0 = new Float64Array(count);
  const upper1 = new Float64Array(count);
  const upper2 = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    order[index] = index;
    const entry = surfaces[index];
    lower0[index] = entry.min[0];
    lower1[index] = entry.min[1];
    lower2[index] = entry.min[2];
    upper0[index] = entry.max[0];
    upper1[index] = entry.max[1];
    upper2[index] = entry.max[2];
  }

  // Median splits of any range > 8 leave halves >= 4, so total nodes <= ceil(count/2) + 2.
  const maxNodes = Math.max(1, Math.ceil(count / 2) + 2);
  let nodeBoxes = new Float64Array(maxNodes * 6);
  let nodeLeft = new Int32Array(maxNodes);
  let nodeRight = new Int32Array(maxNodes);
  let nodeUniform = groupOf ? new Uint8Array(maxNodes) : null;
  const nodeGroup: (G | undefined)[] | null = groupOf ? new Array(maxNodes) : null;
  let nodeCount = 0;

  const build = (start: number, end: number): number => {
    const node = nodeCount++;
    let min0 = Infinity,
      min1 = Infinity,
      min2 = Infinity;
    let max0 = -Infinity,
      max1 = -Infinity,
      max2 = -Infinity;
    for (let index = start; index < end; index++) {
      const id = order[index];
      const l0 = lower0[id],
        u0 = upper0[id];
      const l1 = lower1[id],
        u1 = upper1[id];
      const l2 = lower2[id],
        u2 = upper2[id];
      if (l0 < min0) min0 = l0;
      if (u0 > max0) max0 = u0;
      if (l1 < min1) min1 = l1;
      if (u1 > max1) max1 = u1;
      if (l2 < min2) min2 = l2;
      if (u2 > max2) max2 = u2;
    }
    const nOff = node * 6;
    nodeBoxes[nOff] = min0;
    nodeBoxes[nOff + 1] = min1;
    nodeBoxes[nOff + 2] = min2;
    nodeBoxes[nOff + 3] = max0;
    nodeBoxes[nOff + 4] = max1;
    nodeBoxes[nOff + 5] = max2;

    if (end - start <= 8) {
      nodeLeft[node] = ~start;
      nodeRight[node] = end;
      if (groupOf) {
        const firstGroup = groupOf(surfaces[order[start]]);
        let uniform = 1;
        for (let index = start + 1; index < end; index++) {
          if (groupOf(surfaces[order[index]]) !== firstGroup) {
            uniform = 0;
            break;
          }
        }
        nodeGroup![node] = firstGroup;
        nodeUniform![node] = uniform;
      }
      return node;
    }

    const s0 = max0 - min0;
    const s1 = max1 - min1;
    const s2 = max2 - min2;
    const middle = (start + end) >>> 1;
    if (s0 >= s1 && s0 >= s2) selectMedian(order, lower0, upper0, start, end, middle);
    else if (s1 >= s2) selectMedian(order, lower1, upper1, start, end, middle);
    else selectMedian(order, lower2, upper2, start, end, middle);

    const left = build(start, middle);
    const right = build(middle, end);
    nodeLeft[node] = left;
    nodeRight[node] = right;
    if (groupOf) {
      nodeGroup![node] = nodeGroup![left];
      nodeUniform![node] =
        nodeUniform![left] && nodeUniform![right] && nodeGroup![left] === nodeGroup![right] ? 1 : 0;
    }
    return node;
  };

  build(0, count);

  if (nodeCount < maxNodes) {
    nodeBoxes = nodeBoxes.slice(0, nodeCount * 6);
    nodeLeft = nodeLeft.slice(0, nodeCount);
    nodeRight = nodeRight.slice(0, nodeCount);
    if (nodeUniform) nodeUniform = nodeUniform.slice(0, nodeCount);
    if (nodeGroup) nodeGroup.length = nodeCount;
  }

  // Pack entries and their 3D AABBs in leaf order for contiguous traversal.
  const packedEntries = new Array<T>(count);
  const entryBoxes = new Float64Array(count * 6);
  for (let slot = 0; slot < count; slot++) {
    const id = order[slot];
    packedEntries[slot] = surfaces[id];
    const eOff = slot * 6;
    entryBoxes[eOff] = lower0[id];
    entryBoxes[eOff + 1] = lower1[id];
    entryBoxes[eOff + 2] = lower2[id];
    entryBoxes[eOff + 3] = upper0[id];
    entryBoxes[eOff + 4] = upper1[id];
    entryBoxes[eOff + 5] = upper2[id];
  }

  const base: FlatBoundsBase<T, G> = {
    nodeCount,
    nodeBoxes,
    nodeLeft,
    nodeRight,
    nodeUniform,
    nodeGroup,
    entries: packedEntries,
    entryBoxes,
    groupOf,
  };
  return fromFlat(base, 0, null);
};

const createOverlay = <T extends Bounds, G>(hasGroups: boolean): FlatBoundsOverlay<T, G> => ({
  nodeBoxes: [],
  nodeLeft: [],
  nodeRight: [],
  nodeUniform: hasGroups ? [] : null,
  nodeGroup: hasGroups ? [] : null,
  entries: [],
  entryBoxes: [],
});

// Filtered views reuse untouched subtrees of `base` in O(changed nodes).
// Any surviving node from a previous overlay is emitted into `next` so chained
// filters stay single-level without accumulating indirection chains.
const buildFiltered = <T extends Bounds, G>(
  base: FlatBoundsBase<T, G>,
  root: number,
  prev: FlatBoundsOverlay<T, G> | null,
  mode: 'entry' | 'group',
  eligibleEntry?: (entry: T) => boolean,
  eligibleGroup?: (group: G) => boolean,
): { root: number; overlay: FlatBoundsOverlay<T, G> | null } => {
  if (root < 0) return { root: -1, overlay: null };
  const baseCount = base.nodeCount;
  const hasGroups = Boolean(base.groupOf);
  const next = createOverlay<T, G>(hasGroups);

  const pushNode = (
    b0: number,
    b1: number,
    b2: number,
    b3: number,
    b4: number,
    b5: number,
    left: number,
    right: number,
    uniform: number,
    group: G | undefined,
  ): number => {
    const id = baseCount + next.nodeLeft.length;
    next.nodeBoxes.push(b0, b1, b2, b3, b4, b5);
    next.nodeLeft.push(left);
    next.nodeRight.push(right);
    if (hasGroups) {
      next.nodeUniform!.push(uniform);
      next.nodeGroup!.push(group);
    }
    return id;
  };

  const visit = (node: number): number => {
    const isBase = node < baseCount;
    const k = isBase ? node : node - baseCount;
    const boxes = isBase ? base.nodeBoxes : prev!.nodeBoxes;
    const nOff = k * 6;
    const uniform = hasGroups ? (isBase ? base.nodeUniform![k] : prev!.nodeUniform![k]) : 0;
    const group = hasGroups ? (isBase ? base.nodeGroup![k] : prev!.nodeGroup![k]) : undefined;

    if (mode === 'group' && uniform) {
      if (!eligibleGroup!(group!)) return -1;
      // Uniform subtree is wholly eligible: keep base node directly; if it was
      // an overlay node from a prior filter, clone it into `next`.
      if (isBase) return node;
    }

    const left = isBase ? base.nodeLeft[k] : prev!.nodeLeft[k];
    const right = isBase ? base.nodeRight[k] : prev!.nodeRight[k];

    if (left < 0) {
      const start = ~left;
      const srcEntries = isBase ? base.entries : prev!.entries;
      const srcBoxes = isBase ? base.entryBoxes : prev!.entryBoxes;
      const outStart = next.entries.length;
      let kept = 0;
      for (let i = start; i < right; i++) {
        const entry = srcEntries[i];
        const ok = mode === 'entry' ? eligibleEntry!(entry) : eligibleGroup!(base.groupOf!(entry));
        if (ok) {
          kept++;
          next.entries.push(entry);
          const eOff = i * 6;
          next.entryBoxes.push(
            srcBoxes[eOff],
            srcBoxes[eOff + 1],
            srcBoxes[eOff + 2],
            srcBoxes[eOff + 3],
            srcBoxes[eOff + 4],
            srcBoxes[eOff + 5],
          );
        }
      }
      if (kept === 0) return -1;
      if (isBase && kept === right - start) {
        // Unchanged base leaf: roll back appended entries and reuse base node.
        next.entries.length = outStart;
        next.entryBoxes.length = outStart * 6;
        return node;
      }
      return pushNode(
        boxes[nOff],
        boxes[nOff + 1],
        boxes[nOff + 2],
        boxes[nOff + 3],
        boxes[nOff + 4],
        boxes[nOff + 5],
        ~outStart,
        outStart + kept,
        uniform,
        group,
      );
    }

    const newLeft = visit(left);
    const newRight = visit(right);
    if (newLeft < 0) return newRight;
    if (newRight < 0) return newLeft;
    if (isBase && newLeft === left && newRight === right) return node;
    return pushNode(
      boxes[nOff],
      boxes[nOff + 1],
      boxes[nOff + 2],
      boxes[nOff + 3],
      boxes[nOff + 4],
      boxes[nOff + 5],
      newLeft,
      newRight,
      uniform,
      group,
    );
  };

  const newRoot = visit(root);
  if (newRoot < 0) return { root: -1, overlay: null };
  return { root: newRoot, overlay: next.nodeLeft.length > 0 ? next : null };
};

const fromFlat = <T extends Bounds, G>(
  base: FlatBoundsBase<T, G>,
  root: number,
  overlay: FlatBoundsOverlay<T, G> | null,
): BoundsIndex<T, G> => {
  const baseCount = base.nodeCount;
  const baseBoxes = base.nodeBoxes;
  const baseLeft = base.nodeLeft;
  const baseRight = base.nodeRight;
  const baseEntries = base.entries;
  const baseEntryBoxes = base.entryBoxes;

  // A conservative intersects predicate can reject an entire spatial subtree.
  // It receives both node and entry bounds, so false must exclude every point
  // in that box. Entry-only eligibility belongs in filter/filterGroups instead.
  const query = function* (
    bounds: Bounds,
    target?: readonly number[],
    radius?: number,
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T> {
    if (root < 0) return;
    const qMinX = bounds.min[0],
      qMinY = bounds.min[1],
      qMinZ = bounds.min[2];
    const qMaxX = bounds.max[0],
      qMaxY = bounds.max[1],
      qMaxZ = bounds.max[2];
    const hasSphere = radius !== undefined;
    const tx = hasSphere ? target![0] : 0;
    const ty = hasSphere ? target![1] : 0;
    const tz = hasSphere ? target![2] : 0;
    const rSq = hasSphere ? radius! * radius! : 0;
    // Scratch wrapper allocated only when a caller supplies an `intersects` callback.
    const nodeMin = intersects ? [0, 0, 0] : null;
    const nodeMax = intersects ? [0, 0, 0] : null;
    const nodeBounds: Bounds | null = intersects ? { min: nodeMin!, max: nodeMax! } : null;

    const stack: number[] = [root];
    if (!overlay) {
      // Unfiltered fast path: contiguous TypedArray scans, zero overlay checks.
      while (stack.length > 0) {
        const node = stack.pop()!;
        const nOff = node * 6;
        const bMinX = baseBoxes[nOff],
          bMinY = baseBoxes[nOff + 1],
          bMinZ = baseBoxes[nOff + 2];
        const bMaxX = baseBoxes[nOff + 3],
          bMaxY = baseBoxes[nOff + 4],
          bMaxZ = baseBoxes[nOff + 5];
        if (
          bMinX > qMaxX ||
          bMaxX < qMinX ||
          bMinY > qMaxY ||
          bMaxY < qMinY ||
          bMinZ > qMaxZ ||
          bMaxZ < qMinZ
        )
          continue;
        if (hasSphere && boxDistSq3(bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ, tx, ty, tz) > rSq)
          continue;
        if (intersects) {
          nodeMin![0] = bMinX;
          nodeMin![1] = bMinY;
          nodeMin![2] = bMinZ;
          nodeMax![0] = bMaxX;
          nodeMax![1] = bMaxY;
          nodeMax![2] = bMaxZ;
          if (!intersects(nodeBounds!)) continue;
        }
        const left = baseLeft[node];
        if (left >= 0) {
          stack.push(left, baseRight[node]);
          continue;
        }
        const start = ~left;
        const end = baseRight[node];
        for (let i = start; i < end; i++) {
          const eOff = i * 6;
          const eMinX = baseEntryBoxes[eOff],
            eMinY = baseEntryBoxes[eOff + 1],
            eMinZ = baseEntryBoxes[eOff + 2];
          const eMaxX = baseEntryBoxes[eOff + 3],
            eMaxY = baseEntryBoxes[eOff + 4],
            eMaxZ = baseEntryBoxes[eOff + 5];
          if (
            eMinX > qMaxX ||
            eMaxX < qMinX ||
            eMinY > qMaxY ||
            eMaxY < qMinY ||
            eMinZ > qMaxZ ||
            eMaxZ < qMinZ
          )
            continue;
          if (hasSphere && boxDistSq3(eMinX, eMinY, eMinZ, eMaxX, eMaxY, eMaxZ, tx, ty, tz) > rSq)
            continue;
          const entry = baseEntries[i];
          if (intersects && !intersects(entry)) continue;
          yield entry;
        }
      }
      return;
    }

    // Filtered overlay path.
    const ovBoxes = overlay.nodeBoxes;
    const ovLeft = overlay.nodeLeft;
    const ovRight = overlay.nodeRight;
    const ovEntries = overlay.entries;
    const ovEntryBoxes = overlay.entryBoxes;
    while (stack.length > 0) {
      const node = stack.pop()!;
      const isBase = node < baseCount;
      const k = isBase ? node : node - baseCount;
      const boxes = isBase ? baseBoxes : ovBoxes;
      const nOff = k * 6;
      const bMinX = boxes[nOff],
        bMinY = boxes[nOff + 1],
        bMinZ = boxes[nOff + 2];
      const bMaxX = boxes[nOff + 3],
        bMaxY = boxes[nOff + 4],
        bMaxZ = boxes[nOff + 5];
      if (
        bMinX > qMaxX ||
        bMaxX < qMinX ||
        bMinY > qMaxY ||
        bMaxY < qMinY ||
        bMinZ > qMaxZ ||
        bMaxZ < qMinZ
      )
        continue;
      if (hasSphere && boxDistSq3(bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ, tx, ty, tz) > rSq)
        continue;
      if (intersects) {
        nodeMin![0] = bMinX;
        nodeMin![1] = bMinY;
        nodeMin![2] = bMinZ;
        nodeMax![0] = bMaxX;
        nodeMax![1] = bMaxY;
        nodeMax![2] = bMaxZ;
        if (!intersects(nodeBounds!)) continue;
      }
      const left = isBase ? baseLeft[k] : ovLeft[k];
      const right = isBase ? baseRight[k] : ovRight[k];
      if (left >= 0) {
        stack.push(left, right);
        continue;
      }
      const start = ~left;
      const srcEntries = isBase ? baseEntries : ovEntries;
      const srcBoxes = isBase ? baseEntryBoxes : ovEntryBoxes;
      for (let i = start; i < right; i++) {
        const eOff = i * 6;
        const eMinX = srcBoxes[eOff],
          eMinY = srcBoxes[eOff + 1],
          eMinZ = srcBoxes[eOff + 2];
        const eMaxX = srcBoxes[eOff + 3],
          eMaxY = srcBoxes[eOff + 4],
          eMaxZ = srcBoxes[eOff + 5];
        if (
          eMinX > qMaxX ||
          eMaxX < qMinX ||
          eMinY > qMaxY ||
          eMaxY < qMinY ||
          eMinZ > qMaxZ ||
          eMaxZ < qMinZ
        )
          continue;
        if (hasSphere && boxDistSq3(eMinX, eMinY, eMinZ, eMaxX, eMaxY, eMaxZ, tx, ty, tz) > rSq)
          continue;
        const entry = srcEntries[i];
        if (intersects && !intersects(entry)) continue;
        yield entry;
      }
    }
  };

  query.nearest = function* (
    bounds: Bounds,
    target: readonly number[],
    intersects?: (bounds: Bounds) => boolean,
  ): Generator<T> {
    if (root < 0) return;
    const qMinX = bounds.min[0],
      qMinY = bounds.min[1],
      qMinZ = bounds.min[2];
    const qMaxX = bounds.max[0],
      qMaxY = bounds.max[1],
      qMaxZ = bounds.max[2];
    const tx = target[0],
      ty = target[1],
      tz = target[2];
    const nodeMin = intersects ? [0, 0, 0] : null;
    const nodeMax = intersects ? [0, 0, 0] : null;
    const nodeBounds: Bounds | null = intersects ? { min: nodeMin!, max: nodeMax! } : null;

    // Parallel heap columns retain the original comparisons and tie order without
    // allocating wrapper objects for visited nodes or candidate entries.
    // kind: 0 = tree node (id = node), 1 = base entry (id = slot), 2 = overlay entry (id = slot).
    const ids: number[] = [];
    const kinds: number[] = [];
    const costs: number[] = [];

    const pushHeap = (id: number, kind: number, cost: number) => {
      let index = ids.length;
      ids.push(id);
      kinds.push(kind);
      costs.push(cost);
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (costs[parent] <= cost) break;
        ids[index] = ids[parent];
        kinds[index] = kinds[parent];
        costs[index] = costs[parent];
        index = parent;
      }
      ids[index] = id;
      kinds[index] = kind;
      costs[index] = cost;
    };

    const enqueueNode = (node: number) => {
      const isBase = node < baseCount;
      const k = isBase ? node : node - baseCount;
      const boxes = isBase ? baseBoxes : overlay!.nodeBoxes;
      const nOff = k * 6;
      const bMinX = boxes[nOff],
        bMinY = boxes[nOff + 1],
        bMinZ = boxes[nOff + 2];
      const bMaxX = boxes[nOff + 3],
        bMaxY = boxes[nOff + 4],
        bMaxZ = boxes[nOff + 5];
      if (
        bMinX > qMaxX ||
        bMaxX < qMinX ||
        bMinY > qMaxY ||
        bMaxY < qMinY ||
        bMinZ > qMaxZ ||
        bMaxZ < qMinZ
      )
        return;
      if (intersects) {
        nodeMin![0] = bMinX;
        nodeMin![1] = bMinY;
        nodeMin![2] = bMinZ;
        nodeMax![0] = bMaxX;
        nodeMax![1] = bMaxY;
        nodeMax![2] = bMaxZ;
        if (!intersects(nodeBounds!)) return;
      }
      pushHeap(node, 0, boxDistSq3(bMinX, bMinY, bMinZ, bMaxX, bMaxY, bMaxZ, tx, ty, tz));
    };

    const enqueueEntry = (slot: number, isBase: boolean) => {
      const srcBoxes = isBase ? baseEntryBoxes : overlay!.entryBoxes;
      const eOff = slot * 6;
      const eMinX = srcBoxes[eOff],
        eMinY = srcBoxes[eOff + 1],
        eMinZ = srcBoxes[eOff + 2];
      const eMaxX = srcBoxes[eOff + 3],
        eMaxY = srcBoxes[eOff + 4],
        eMaxZ = srcBoxes[eOff + 5];
      if (
        eMinX > qMaxX ||
        eMaxX < qMinX ||
        eMinY > qMaxY ||
        eMaxY < qMinY ||
        eMinZ > qMaxZ ||
        eMaxZ < qMinZ
      )
        return;
      if (intersects) {
        const entry = isBase ? baseEntries[slot] : overlay!.entries[slot];
        if (!intersects(entry)) return;
      }
      pushHeap(
        slot,
        isBase ? 1 : 2,
        boxDistSq3(eMinX, eMinY, eMinZ, eMaxX, eMaxY, eMaxZ, tx, ty, tz),
      );
    };

    enqueueNode(root);
    while (ids.length > 0) {
      const id = ids[0];
      const kind = kinds[0];
      const lastId = ids.pop()!;
      const lastKind = kinds.pop()!;
      const lastCost = costs.pop()!;
      if (ids.length > 0) {
        let index = 0;
        const len = ids.length;
        while (index * 2 + 1 < len) {
          let child = index * 2 + 1;
          if (child + 1 < len && costs[child + 1] < costs[child]) child++;
          if (costs[child] >= lastCost) break;
          ids[index] = ids[child];
          kinds[index] = kinds[child];
          costs[index] = costs[child];
          index = child;
        }
        ids[index] = lastId;
        kinds[index] = lastKind;
        costs[index] = lastCost;
      }
      if (kind === 1) {
        yield baseEntries[id];
        continue;
      }
      if (kind === 2) {
        yield overlay!.entries[id];
        continue;
      }
      const isBase = id < baseCount;
      const k = isBase ? id : id - baseCount;
      const left = isBase ? baseLeft[k] : overlay!.nodeLeft[k];
      const right = isBase ? baseRight[k] : overlay!.nodeRight[k];
      if (left < 0) {
        const start = ~left;
        for (let slot = start; slot < right; slot++) enqueueEntry(slot, isBase);
      } else {
        enqueueNode(left);
        enqueueNode(right);
      }
    }
  };

  query.empty = root < 0;
  let sharedStack = new Int32Array(128);
  let stackInUse = false;
  query.forEachBox = (
    qMinX: number,
    qMinY: number,
    qMinZ: number,
    qMaxX: number,
    qMaxY: number,
    qMaxZ: number,
    visitor: (entry: T) => void,
  ) => {
    if (root < 0) return;
    const ownsShared = !stackInUse;
    if (ownsShared) stackInUse = true;
    let stack = ownsShared ? sharedStack : new Int32Array(128);
    try {
      let top = 0;
      stack[top++] = root;
      if (!overlay) {
        while (top > 0) {
          const node = stack[--top];
          const nOff = node * 6;
          if (
            baseBoxes[nOff] > qMaxX ||
            baseBoxes[nOff + 3] < qMinX ||
            baseBoxes[nOff + 1] > qMaxY ||
            baseBoxes[nOff + 4] < qMinY ||
            baseBoxes[nOff + 2] > qMaxZ ||
            baseBoxes[nOff + 5] < qMinZ
          )
            continue;
          const left = baseLeft[node];
          if (left >= 0) {
            if (top + 2 > stack.length) {
              const grown = new Int32Array(stack.length * 2);
              grown.set(stack);
              stack = grown;
              if (ownsShared) sharedStack = grown;
            }
            stack[top++] = left;
            stack[top++] = baseRight[node];
            continue;
          }
          const start = ~left;
          const end = baseRight[node];
          for (let i = start; i < end; i++) {
            const eOff = i * 6;
            if (
              baseEntryBoxes[eOff] > qMaxX ||
              baseEntryBoxes[eOff + 3] < qMinX ||
              baseEntryBoxes[eOff + 1] > qMaxY ||
              baseEntryBoxes[eOff + 4] < qMinY ||
              baseEntryBoxes[eOff + 2] > qMaxZ ||
              baseEntryBoxes[eOff + 5] < qMinZ
            )
              continue;
            visitor(baseEntries[i]);
          }
        }
        return;
      }
      const ovBoxes = overlay.nodeBoxes;
      const ovLeft = overlay.nodeLeft;
      const ovRight = overlay.nodeRight;
      const ovEntries = overlay.entries;
      const ovEntryBoxes = overlay.entryBoxes;
      while (top > 0) {
        const node = stack[--top];
        const isBase = node < baseCount;
        const k = isBase ? node : node - baseCount;
        const boxes = isBase ? baseBoxes : ovBoxes;
        const nOff = k * 6;
        if (
          boxes[nOff] > qMaxX ||
          boxes[nOff + 3] < qMinX ||
          boxes[nOff + 1] > qMaxY ||
          boxes[nOff + 4] < qMinY ||
          boxes[nOff + 2] > qMaxZ ||
          boxes[nOff + 5] < qMinZ
        )
          continue;
        const left = isBase ? baseLeft[k] : ovLeft[k];
        const right = isBase ? baseRight[k] : ovRight[k];
        if (left >= 0) {
          if (top + 2 > stack.length) {
            const grown = new Int32Array(stack.length * 2);
            grown.set(stack);
            stack = grown;
            if (ownsShared) sharedStack = grown;
          }
          stack[top++] = left;
          stack[top++] = right;
          continue;
        }
        const start = ~left;
        const srcEntries = isBase ? baseEntries : ovEntries;
        const srcBoxes = isBase ? baseEntryBoxes : ovEntryBoxes;
        for (let i = start; i < right; i++) {
          const eOff = i * 6;
          if (
            srcBoxes[eOff] > qMaxX ||
            srcBoxes[eOff + 3] < qMinX ||
            srcBoxes[eOff + 1] > qMaxY ||
            srcBoxes[eOff + 4] < qMinY ||
            srcBoxes[eOff + 2] > qMaxZ ||
            srcBoxes[eOff + 5] < qMinZ
          )
            continue;
          visitor(srcEntries[i]);
        }
      }
    } finally {
      if (ownsShared) stackInUse = false;
    }
  };
  query.filter = (eligible: (entry: T) => boolean) => {
    const filtered = buildFiltered(base, root, overlay, 'entry', eligible, undefined);
    return fromFlat(base, filtered.root, filtered.overlay);
  };
  query.filterGroups = (eligible: (group: G) => boolean) => {
    if (!base.groupOf) throw new Error('Bounds index has no immutable groups');
    const filtered = buildFiltered(base, root, overlay, 'group', undefined, eligible);
    return fromFlat(base, filtered.root, filtered.overlay);
  };
  return query;
};
