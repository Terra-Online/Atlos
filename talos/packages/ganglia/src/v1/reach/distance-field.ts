import { createMinHeap } from '#@/src/v1/search/heap.ts';

export interface WeightedEdge {
  from: string;
  to: string;
  cost: number;
}
interface Root {
  id: string;
  cost: number;
}
export interface DistanceField {
  base: { get(id: string): WeightedEdge[] | undefined };
  reverse: boolean;
  lengthScale: number;
  roots: Root[];
  edges: WeightedEdge[];
  costs: Map<string, number>;
  work: { reset: boolean; expanded: number; edgeChecks: number; relaxed: number };
}

const sameEdge = (a: WeightedEdge, b: WeightedEdge) =>
  a.from === b.from && a.to === b.to && Object.is(a.cost, b.cost);
const sameRoots = (a: Root[], b: Root[]) =>
  a.length === b.length &&
  a.every((root, index) => root.id === b[index].id && Object.is(root.cost, b[index].cost));
// One direction's current shortest-distance field, owned by this route query.
// Added actions can only improve labels: seed their relaxed endpoints instead of
// traversing the unchanged ground graph again. A removed/changed action, root or
// base graph restarts the original Dijkstra. No previous query's field is retained.
export function advanceDistanceField(
  base: { get(id: string): WeightedEdge[] | undefined },
  edges: WeightedEdge[],
  roots: Root[],
  reverse: boolean,
  previous?: DistanceField,
  lengthScale = 1,
): DistanceField {
  const incremental =
    previous?.base === base &&
    previous.reverse === reverse &&
    previous.lengthScale === lengthScale &&
    sameRoots(previous.roots, roots) &&
    previous.edges.length <= edges.length &&
    previous.edges.every((edge, index) => sameEdge(edge, edges[index]));
  const work = { reset: !incremental, expanded: 0, edgeChecks: 0, relaxed: 0 };
  const state: DistanceField = incremental
    ? previous
    : {
        base,
        reverse,
        lengthScale,
        roots: roots.map((root) => ({ ...root })),
        edges: [],
        costs: new Map<string, number>(),
        work,
      };
  state.work = work;
  if (incremental && previous.edges.length === edges.length) return state;
  const extra = new Map<string, WeightedEdge[]>(),
    pending = createMinHeap<Root>();
  for (const edge of edges) {
    const from = reverse ? edge.to : edge.from;
    const outgoing = extra.get(from) ?? [];
    outgoing.push(edge);
    extra.set(from, outgoing);
  }
  const relax = (id: string, cost: number) => {
    if (cost >= (state.costs.get(id) ?? Infinity)) return;
    state.costs.set(id, cost);
    pending.push({ id, cost });
    work.relaxed++;
  };
  const visit = (entries: WeightedEdge[] | undefined, cost: number, scale: number) => {
    if (!entries) return;
    for (const edge of entries) {
      work.edgeChecks++;
      relax(reverse ? edge.from : edge.to, cost + edge.cost * scale);
    }
  };
  if (incremental) {
    for (let index = previous.edges.length; index < edges.length; index++) {
      const edge = edges[index],
        from = reverse ? edge.to : edge.from;
      const cost = state.costs.get(from);
      if (cost !== undefined) relax(reverse ? edge.from : edge.to, cost + edge.cost);
    }
  } else {
    for (const root of roots) relax(root.id, root.cost);
  }
  while (pending.size) {
    const current = pending.pop()!;
    if (current.cost !== state.costs.get(current.id)) continue;
    work.expanded++;
    // Scale the immutable original weights in place of cloning every graph edge
    // into metres. Extra action weights already use the field's length unit.
    visit(base.get(current.id), current.cost, lengthScale);
    visit(extra.get(current.id), current.cost, 1);
  }
  state.edges = edges.map(({ from, to, cost }) => ({ from, to, cost }));
  return state;
}
