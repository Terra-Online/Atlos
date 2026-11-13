import type { Vec3 } from '#@/src/geometry.ts';
import type { Segment } from '#@/src/movement.ts';
import type { Edge } from '#@/src/v1/route/routes.ts';
export { validateMotion } from '#@/src/model/motion.ts';
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
export function routeSegment(edge: Edge): Segment {
  const times = edge.times ? [...edge.times] : [0];
  if (!edge.times) {
    let length = 0;
    for (let i = 1; i < edge.points.length; i++) {
      length += distance(edge.points[i - 1], edge.points[i]);
      times.push(length);
    }
    for (let i = 1; i < times.length; i++)
      times[i] = length ? (times[i] / length) * edge.cost : edge.cost;
  }
  return {
    mode: edge.mode ?? 'walk',
    ...(edge.traversal === undefined ? {} : { traversal: edge.traversal }),
    points: edge.points.map((p): Vec3 => [...p]),
    times,
    ...(edge.connection === undefined ? {} : { connection: edge.connection }),
    ...(edge.requiredGait === undefined ? {} : { requiredGait: edge.requiredGait }),
  };
}
