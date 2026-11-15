import type { Vec3 } from '#@/src/geometry.ts';

/** Count the visited ordered prefix along a complete trace. XZ uses the query
 * position band, while height permits the source projection tolerance. A visit
 * may occur inside a flight or a vertical span; it need not be a grounded stop. */
export function visitedWaypoints(
  trace: readonly Vec3[],
  waypoints: readonly Vec3[],
  maxVertical: number,
): number {
  const points = trace.length === 1 ? [trace[0], trace[0]] : trace;
  let visited = 0;
  let span = 1,
    fraction = 0;
  for (const waypoint of waypoints) {
    let found = false;
    for (; span < points.length; span++, fraction = 0) {
      const a = points[span - 1],
        b = points[span];
      const dx = b[0] - a[0],
        dz = b[2] - a[2],
        dy = b[1] - a[1];
      const squared = dx * dx + dz * dz;
      let near = fraction,
        far = 1;
      if (squared) {
        const center = ((waypoint[0] - a[0]) * dx + (waypoint[2] - a[2]) * dz) / squared;
        const gap = Math.hypot(a[0] + center * dx - waypoint[0], a[2] + center * dz - waypoint[2]);
        if (gap > 1e-6) continue;
        const half = Math.sqrt(Math.max(0, 1e-12 - gap * gap) / squared);
        near = Math.max(near, center - half);
        far = Math.min(far, center + half);
      } else if (Math.hypot(a[0] - waypoint[0], a[2] - waypoint[2]) > 1e-6) continue;
      const tolerance = maxVertical + 1e-6;
      if (dy) {
        const first = (waypoint[1] - tolerance - a[1]) / dy;
        const last = (waypoint[1] + tolerance - a[1]) / dy;
        near = Math.max(near, Math.min(first, last));
        far = Math.min(far, Math.max(first, last));
      } else if (Math.abs(a[1] - waypoint[1]) > tolerance) continue;
      // Keep the earliest accepted point so overlapping waypoint volumes can be
      // visited in order without forcing a detour through each volume's center.
      if (near <= far) {
        fraction = near;
        found = true;
        break;
      }
    }
    if (!found) return visited;
    visited++;
  }
  return visited;
}
