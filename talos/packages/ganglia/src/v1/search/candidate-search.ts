import type { Vec3 } from '#@/src/geometry.ts';

export interface CandidateSearchGraph {
  nodeCount(): number;
  node(index: number): { expand?: number; logical?: number };
  edgeCount(): number;
  edge(index: number): {
    to: number;
    penalty: number;
    length: number;
    key?: string;
    points?: Vec3[];
  };
  adjacency(node: number): number[];
  expand(component: number): void;
  flush(): number[];
}
export interface CandidateSearchRequest {
  end: number;
  starts: { node: number; cost: number; origin: number }[];
  excluded: ReadonlySet<number | string>;
  regions: { fromComponent?: number; toComponent?: number; min: Vec3; max: Vec3 }[];
}
export interface CandidateSearchResult {
  score: number;
  origin: number;
  path: number[];
}
export type CandidateSearchFactory = (graph: CandidateSearchGraph) => {
  plan(request: CandidateSearchRequest): CandidateSearchResult | undefined;
};
let prototype: CandidateSearchFactory | undefined;
/** Install before preparing a planner. Existing instances retain their search implementation. */
export function installCandidateSearchPrototype(factory?: CandidateSearchFactory) {
  const previous = prototype;
  prototype = factory;
  return previous;
}
export const createCandidateSearch = (graph: CandidateSearchGraph) => prototype?.(graph);
