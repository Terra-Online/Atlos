import type { Surface, Vec3 } from '#@/src/geometry.ts';

export function supportVertices(surface: Surface): Vec3[] | undefined {
  if (
    !surface ||
    typeof surface !== 'object' ||
    typeof surface.id !== 'string' ||
    !Array.isArray(surface.vertices) ||
    surface.vertices.length < 3
  )
    return undefined;
  return surface.vertices;
}

export function isSupportVertex(point: unknown): point is Vec3 {
  return (
    Array.isArray(point) &&
    point.length === 3 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    Number.isFinite(point[2])
  );
}
