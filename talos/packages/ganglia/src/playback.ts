import type { Vec3 } from '#@/src/geometry.ts';
import type { MovementMode } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const finitePoint = (p: unknown): p is Vec3 =>
  Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

/** Sample the timed movement after the selected arrival has completed. Entry/teleport
 * overhead stays in route.arrivalCost; no flight is drawn from the player's old position.
 * This interpolates supplied trajectory samples, not a newly fitted parabola or spline.
 */
export function sampleJourney(
  route: Extract<Route, { status: 'complete' }>,
  seconds: number,
): { position: Vec3; mode: MovementMode | 'complete'; connection?: string } {
  if (route.status !== 'complete' || !Number.isFinite(seconds))
    throw new Error('Invalid journey sample');
  let remaining = Math.max(0, seconds);
  for (const segment of route.segments) {
    const duration = segment.times.at(-1)!;
    if (remaining < duration) {
      for (let i = 1; i < segment.times.length; i++) {
        if (remaining < segment.times[i]) {
          const fraction =
            (remaining - segment.times[i - 1]) / (segment.times[i] - segment.times[i - 1]);
          return {
            mode: segment.mode,
            position: [
              segment.points[i - 1][0] +
                (segment.points[i][0] - segment.points[i - 1][0]) * fraction,
              segment.points[i - 1][1] +
                (segment.points[i][1] - segment.points[i - 1][1]) * fraction,
              segment.points[i - 1][2] +
                (segment.points[i][2] - segment.points[i - 1][2]) * fraction,
            ] satisfies Vec3,
            ...(segment.connection === undefined ? {} : { connection: segment.connection }),
          };
        }
      }
    }
    remaining -= duration;
  }
  return { mode: 'complete', position: [...route.points.at(-1)!] };
}

/** Arc-length animation stays on the verified polyline; it never rounds through walls. */
export function sampleRoute(points: Vec3[], meters: number): Vec3 {
  if (!points.length || !points.every(finitePoint) || !Number.isFinite(meters))
    throw new Error('Invalid route sample');
  let remaining = Math.max(0, meters);
  for (let i = 1; i < points.length; i++) {
    const length = distance(points[i - 1], points[i]);
    if (length > 0 && remaining < length)
      return [
        points[i - 1][0] + ((points[i][0] - points[i - 1][0]) * remaining) / length,
        points[i - 1][1] + ((points[i][1] - points[i - 1][1]) * remaining) / length,
        points[i - 1][2] + ((points[i][2] - points[i - 1][2]) * remaining) / length,
      ] satisfies Vec3;
    remaining -= length;
  }
  return [...points.at(-1)!];
}
