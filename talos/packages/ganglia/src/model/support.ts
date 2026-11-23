import type { Surface, Vec3 } from '#@/src/geometry.ts';

/** Use C as the origin to match ground projection rounding at fan boundaries. */
export function verticalFanHeight(
  x: number,
  z: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(det) < 1e-10) return NaN;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
  if (u < -1e-8 || v < -1e-8 || u + v > 1 + 1e-8) return NaN;
  return u * ay + v * by + (1 - u - v) * cy;
}

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
      const y = verticalFanHeight(
        position[0],
        position[2],
        a[0],
        a[1],
        a[2],
        b[0],
        b[1],
        b[2],
        c[0],
        c[1],
        c[2],
      );
      const delta = Math.abs(y - position[1]);
      if (delta <= maxVertical && delta < error) {
        best = { surface: surface.id, position: [position[0], y, position[2]] };
        error = delta;
      }
    }
  }
  return best;
}
