import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type {
  CandidateSearchFactory,
  CandidateSearchGraph,
} from '#@/src/v1/search/candidate-search.ts';

type NativeIndex = {
  appendNodes(expand: Int32Array, logical: Int32Array): void;
  appendEdges(
    to: Uint32Array,
    penalty: Float64Array,
    length: Float64Array,
    boxes: Float64Array,
  ): void;
  setRows(nodes: Uint32Array, offsets: Uint32Array, edges: Uint32Array): void;
  start(
    end: number,
    starts: Uint32Array,
    costs: Float64Array,
    origins: Uint32Array,
    excluded: Uint32Array,
    regions: Float64Array,
  ): Float64Array;
  resume(component: number, excluded: Uint32Array): Float64Array;
};
const { CandidateSearchIndex } = loadNativeLibrary() as {
  CandidateSearchIndex: new () => NativeIndex;
};

export const createRustCandidateSearch: CandidateSearchFactory = (graph: CandidateSearchGraph) => {
  const native = new CandidateSearchIndex();
  const keys = new Map<string, number>();
  let nodeCount = 0,
    edgeCount = 0,
    initialized = false;
  const sync = (excluded: ReadonlySet<number | string>) => {
    const nodes = graph.nodeCount(),
      edges = graph.edgeCount();
    if (nodes > nodeCount) {
      const expand = new Int32Array(nodes - nodeCount),
        logical = new Int32Array(nodes - nodeCount);
      for (let index = nodeCount; index < nodes; index++) {
        const node = graph.node(index);
        expand[index - nodeCount] = node.expand ?? -1;
        logical[index - nodeCount] = node.logical ?? -1;
      }
      native.appendNodes(expand, logical);
      nodeCount = nodes;
    }
    const addedBans: number[] = [];
    const hasKeys = [...excluded].some((value) => typeof value === 'string');
    if (edges > edgeCount) {
      const targets = new Uint32Array(edges - edgeCount),
        penalties = new Float64Array(edges - edgeCount),
        lengths = new Float64Array(edges - edgeCount),
        boxes: number[] = [];
      for (let index = edgeCount; index < edges; index++) {
        const edge = graph.edge(index),
          local = index - edgeCount;
        targets[local] = edge.to;
        penalties[local] = edge.penalty;
        lengths[local] = edge.length;
        if (edge.key !== undefined) keys.set(edge.key, index);
        if (
          excluded.has(index) ||
          (hasKeys && excluded.has(edge.key ?? JSON.stringify(['ground', index])))
        )
          addedBans.push(index);
        if (edge.points) {
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          for (const point of edge.points)
            for (let axis = 0; axis < 3; axis++) {
              min[axis] = Math.min(min[axis], point[axis]);
              max[axis] = Math.max(max[axis], point[axis]);
            }
          boxes.push(local, ...min, ...max);
        }
      }
      native.appendEdges(targets, penalties, lengths, Float64Array.from(boxes));
      edgeCount = edges;
    }
    const dirty = graph.flush();
    const rows = initialized ? dirty : Array.from({ length: nodes }, (_, index) => index);
    if (rows.length) {
      const offsets = new Uint32Array(rows.length + 1);
      for (let index = 0; index < rows.length; index++)
        offsets[index + 1] = offsets[index] + graph.adjacency(rows[index]).length;
      const packed = new Uint32Array(offsets.at(-1)!);
      for (let index = 0; index < rows.length; index++)
        packed.set(graph.adjacency(rows[index]), offsets[index]);
      native.setRows(Uint32Array.from(rows), offsets, packed);
    }
    initialized = true;
    return Uint32Array.from(addedBans);
  };
  const resolve = (values: ReadonlySet<number | string>) => {
    const result = new Set<number>();
    for (const value of values) {
      if (typeof value === 'number') {
        if (Number.isInteger(value) && value >= 0 && value < edgeCount) result.add(value);
        continue;
      }
      const known = keys.get(value);
      if (known !== undefined) {
        result.add(known);
        continue;
      }
      // Ground keys are implicit; avoid allocating one string for every static edge.
      try {
        const tuple: unknown = JSON.parse(value);
        if (
          Array.isArray(tuple) &&
          tuple.length === 2 &&
          tuple[0] === 'ground' &&
          Number.isInteger(tuple[1]) &&
          tuple[1] >= 0 &&
          tuple[1] < edgeCount &&
          graph.edge(tuple[1]).key === undefined &&
          value === JSON.stringify(tuple)
        )
          result.add(tuple[1]);
      } catch {
        /* Unknown stable keys may materialize in a later component. */
      }
    }
    return Uint32Array.from(result);
  };
  return {
    plan(request) {
      sync(request.excluded);
      let result = native.start(
        request.end,
        Uint32Array.from(request.starts.map((start) => start.node)),
        Float64Array.from(request.starts.map((start) => start.cost)),
        Uint32Array.from(request.starts.map((start) => start.origin)),
        resolve(request.excluded),
        Float64Array.from(
          request.regions.flatMap((region) => [
            region.fromComponent ?? -1,
            region.toComponent ?? -1,
            ...region.min,
            ...region.max,
          ]),
        ),
      );
      while (result[0] === 0) {
        const component = result[1];
        graph.expand(component);
        const excluded = sync(request.excluded);
        result = native.resume(component, excluded);
      }
      return result[0] === 1
        ? { score: result[1], origin: result[2], path: Array.from(result.subarray(3)) }
        : undefined;
    },
  };
};
