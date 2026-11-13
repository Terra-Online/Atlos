import type { Edge, Graph, Node } from '#@/src/v1/route/routes.ts';

export interface RouteSearchSeed {
  node: string;
  origin: string;
  travelled: number;
  priority: number;
}
export interface RouteSearchRequest {
  nodes: readonly Node[];
  links: readonly Edge[];
  seeds: readonly RouteSearchSeed[];
  goals: readonly string[];
  targetKey: string;
  estimateDenominator?: number;
}
export interface RouteSearchResult {
  /** Original Edge objects, from goal back to root, before shared reconstruction. */
  reversePath: Edge[];
  root: string;
  origin: string;
  cost: number;
  arrivalCost: number;
}
export interface PreparedRouteSearch {
  search(request: RouteSearchRequest): RouteSearchResult | undefined;
}
export type RouteSearchFactory = (base: Graph) => PreparedRouteSearch;
let prototype: RouteSearchFactory | undefined;
/** Install before preparing immutable planners. Mutable and standalone searches stay in TS. */
export function installRouteSearchPrototype(factory?: RouteSearchFactory) {
  const previous = prototype;
  prototype = factory;
  return previous;
}
export const createPreparedRouteSearch = (base: Graph) => prototype?.(base);
