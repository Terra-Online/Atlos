import { loadNativeLibrary } from '#@/prototype/rust-kernel/native.ts';
import type { Graph, Node } from '#@/src/v1/route/routes.ts';
import type { RouteSearchFactory, RouteSearchRequest } from '#@/src/v1/search/route-search.ts';

interface NativeRouteResult {
  reversePath: Uint32Array;
  root: number;
  origin: number;
  cost: number;
  arrivalCost: number;
}
interface NativeRouteIndex {
  search(query: {
    positions: Float64Array;
    from: Uint32Array;
    to: Uint32Array;
    costs: Float64Array;
    seedNodes: Uint32Array;
    seedCosts: Float64Array;
    seedPriorities: Float64Array;
    goals: Uint32Array;
    targetKey: string;
    estimateDenominator?: number;
  }): NativeRouteResult | null;
}
const { RouteSearchIndex } = loadNativeLibrary() as {
  RouteSearchIndex: new (snapshot: {
    positions: Float64Array;
    from: Uint32Array;
    to: Uint32Array;
    costs: Float64Array;
  }) => NativeRouteIndex;
};
const positions = (nodes: readonly Node[]) => {
  const result = new Float64Array(nodes.length * 3);
  for (let index = 0; index < nodes.length; index++) result.set(nodes[index].position, index * 3);
  return result;
};
const encode = (base: Graph) => {
  const ids = new Map(base.nodes.map((node, index) => [node.id, index]));
  const from = new Uint32Array(base.edges.length),
    to = new Uint32Array(base.edges.length),
    costs = new Float64Array(base.edges.length);
  for (let index = 0; index < base.edges.length; index++) {
    const edge = base.edges[index];
    from[index] = ids.get(edge.from)!;
    to[index] = ids.get(edge.to)!;
    costs[index] = edge.cost;
  }
  return {
    ids,
    index: new RouteSearchIndex({ positions: positions(base.nodes), from, to, costs }),
  };
};

/** The factory receives only the prepared planner's immutable, accepted base.
 * Validation and reconstruction remain in routes.ts. No scene rows are copied
 * while endpoint/action overlays or the current target change.
 */
export const createRustRouteSearch: RouteSearchFactory = (base) => {
  let prepared: ReturnType<typeof encode> | undefined;
  return {
    search(query: RouteSearchRequest) {
      prepared ??= encode(base);
      const { ids, index } = prepared;
      const extraIds = new Map(
        query.nodes.map((node, index) => [node.id, base.nodes.length + index]),
      );
      const id = (key: string) => ids.get(key) ?? extraIds.get(key)!;
      const from = new Uint32Array(query.links.length),
        to = new Uint32Array(query.links.length),
        costs = new Float64Array(query.links.length);
      for (let index = 0; index < query.links.length; index++) {
        const edge = query.links[index];
        from[index] = id(edge.from);
        to[index] = id(edge.to);
        costs[index] = edge.cost;
      }
      const result = index.search({
        positions: positions(query.nodes),
        from,
        to,
        costs,
        seedNodes: Uint32Array.from(query.seeds, (seed) => id(seed.node)),
        seedCosts: Float64Array.from(query.seeds, (seed) => seed.travelled),
        seedPriorities: Float64Array.from(query.seeds, (seed) => seed.priority),
        goals: Uint32Array.from(query.goals, id),
        targetKey: query.targetKey,
        estimateDenominator: query.estimateDenominator,
      });
      if (!result) return;
      return {
        reversePath: Array.from(result.reversePath, (edge) =>
          edge < base.edges.length ? base.edges[edge] : query.links[edge - base.edges.length],
        ),
        root:
          result.root < base.nodes.length
            ? base.nodes[result.root].id
            : query.nodes[result.root - base.nodes.length].id,
        origin: query.seeds[result.origin].origin,
        cost: result.cost,
        arrivalCost: result.arrivalCost,
      };
    },
  };
};
