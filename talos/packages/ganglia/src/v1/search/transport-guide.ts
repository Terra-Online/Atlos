import type { Vec3, Surface } from '#@/src/geometry.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival } from '#@/src/route.ts';
import type { SceneTransfer } from '#@/src/solver/resources.ts';
import type { GroundTopology } from '#@/src/v1/reach/connectivity.ts';
import type { Graph } from '#@/src/v1/route/routes.ts';
import type { CandidateEdge } from '#@/src/v1/search/candidate-planner.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Propose a supported approach to known transport and a supported exit. Mesh
 * contacts rank guides only. Real physical windows must still admit the complete
 * movement, including the original source and the final interaction. */
export function createTransportGuide(
  surfaces: Surface[],
  graph: Graph,
  topology: GroundTopology,
  speed: number,
  maxVertical: number,
  transfers: readonly SceneTransfer[],
) {
  const project = createGoalProjector(surfaces);
  type Link = { to: number; points: Vec3[]; cost: number; device?: string };
  const adjacent: Link[][] = graph.nodes.map(() => []);
  for (const edge of graph.edges)
    if (edge.state === 'open') {
      adjacent[topology.ids.get(edge.from)!].push({
        to: topology.ids.get(edge.to)!,
        points: edge.points,
        cost: edge.cost,
      });
    }
  for (const { id, from, to } of transfers) {
    // A neighbouring navigation face can sit outside the moving roof itself.
    // Local controller ownership and swept clearance are checked in the leaf.
    const a = project(from, { maxVertical: 3, interaction: { radius: 3 } });
    const b = project(to, { maxVertical: 3, interaction: { radius: 3 } });
    for (const start of a)
      for (const end of b) {
        const source = topology.ids.get(start.surface)!,
          dest = topology.ids.get(end.surface)!;
        if (topology.components[source] === topology.components[dest]) continue;
        const points = [
          graph.nodes[source].position,
          start.position,
          end.position,
          graph.nodes[dest].position,
        ];
        const cost =
          2 + points.slice(1).reduce((sum, p, k) => sum + distance(points[k], p), 0) / speed;
        adjacent[source].push({ to: dest, points, cost, device: id });
        adjacent[dest].push({ to: source, points: [...points].reverse(), cost, device: id });
      }
  }
  return (starts: GroundArrival[], goal: Vec3, interaction: InteractionGoal) => {
    const contacts = project(goal, { maxVertical, interaction });
    if (!contacts.length) return;
    const goals = new Map(contacts.map((c) => [topology.ids.get(c.surface)!, c.position]));
    const scores = new Float64Array(graph.nodes.length).fill(Infinity);
    const prev = new Map<number, { from: number; edge: Link }>(),
      sources = new Map<number, GroundArrival>();
    const queue = createMinHeap<{ node: number; cost: number }>();
    for (const start of starts) {
      if (start.state !== 'available') continue;
      const face = project(start.position, { maxVertical })[0];
      if (!face) continue;
      const node = topology.ids.get(face.surface)!;
      if (start.cost >= scores[node]) continue;
      scores[node] = start.cost;
      sources.set(node, start);
      queue.push({ node, cost: start.cost });
    }
    while (queue.size) {
      const cur = queue.pop()!;
      if (cur.cost !== scores[cur.node]) continue;
      const contact = goals.get(cur.node);
      if (contact) {
        const chain: Link[] = [];
        let head = cur.node;
        while (prev.has(head)) {
          const entry = prev.get(head)!;
          chain.push(entry.edge);
          head = entry.from;
        }
        if (!chain.some((e) => e.device)) return;
        const arrival = sources.get(head)!,
          points: Vec3[] = [arrival.position],
          path: CandidateEdge[] = [];
        for (const edge of chain.reverse()) {
          for (const p of edge.points) if (distance(p, points.at(-1)!) > 1e-6) points.push(p);
          if (edge.device)
            path.push({
              index: -1,
              from: edge.device,
              to: edge.device,
              device: edge.device,
              points: edge.points,
              unresolved: true,
            });
        }
        if (distance(contact, points.at(-1)!) > 1e-6) points.push(contact);
        return {
          status: 'candidate' as const,
          arrival,
          points,
          path,
          unresolved: path,
          score: cur.cost,
        };
      }
      for (const edge of adjacent[cur.node]) {
        const cost = cur.cost + edge.cost;
        if (cost >= scores[edge.to]) continue;
        scores[edge.to] = cost;
        prev.set(edge.to, { from: cur.node, edge });
        queue.push({ node: edge.to, cost });
      }
    }
  };
}
