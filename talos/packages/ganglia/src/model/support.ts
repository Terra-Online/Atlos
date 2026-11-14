import type { Surface, Vec3 } from '#@/src/geometry.ts';

/** Project vertically onto a convex polygon's triangulated surface, without crossing a gap
 * or choosing a floor outside maxVertical. Detail-height meshes are the importer's responsibility.
 */
export function projectPoint(
  surfaces: Surface[],
  position: Vec3,
  { maxVertical }: { maxVertical: number },
): { surface: string; position: Vec3 } | null {
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every(Number.isFinite) ||
    !Number.isFinite(maxVertical) ||
    maxVertical < 0
  )
    throw new Error('Invalid ground projection');
  let best: { surface: string; position: Vec3 } | null = null,
    error = Infinity;
  for (const surface of surfaces) {
    const a = surface.vertices[0];
    for (let i = 1; i + 1 < surface.vertices.length; i++) {
      const b = surface.vertices[i],
        c = surface.vertices[i + 1];
      const det = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(det) < 1e-10) continue;
      const u = ((b[2] - c[2]) * (position[0] - c[0]) + (c[0] - b[0]) * (position[2] - c[2])) / det;
      const v = ((c[2] - a[2]) * (position[0] - c[0]) + (a[0] - c[0]) * (position[2] - c[2])) / det;
      if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) continue;
      const y = u * a[1] + v * b[1] + (1 - u - v) * c[1],
        delta = Math.abs(y - position[1]);
      if (delta <= maxVertical && delta < error) {
        best = { surface: surface.id, position: [position[0], y, position[2]] };
        error = delta;
      }
    }
  }
  return best;
}
