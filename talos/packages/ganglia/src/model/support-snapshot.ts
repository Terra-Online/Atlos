import type { Surface, Vec3 } from '#@/src/geometry.ts';
export interface SupportTriangle {
  vertices: [Vec3, Vec3, Vec3];
  determinant: number;
  min: Vec3;
  max: Vec3;
  polygonEdges: (number | null)[];
}
export interface SupportSnapshot {
  id: string;
  vertices: Vec3[];
  min: Vec3;
  max: Vec3;
  triangles?: SupportTriangle[];
}
// Geometry is shared across coarse and locally extended planners, while each
// planner still owns its ordering, indices, triangle IDs and mutable neighbours.
// Compare current contents on every lookup: rebuilding after caller mutation must
// see the new geometry, and existing planners must retain their previous snapshot.
const snapshots = new WeakMap<Surface, SupportSnapshot>();
export const releaseSupportSnapshot = (surface: Surface) => snapshots.delete(surface);
export const supportSnapshot = (surface: Surface): SupportSnapshot | null => {
  if (
    !surface ||
    typeof surface !== 'object' ||
    typeof surface.id !== 'string' ||
    !Array.isArray(surface.vertices) ||
    surface.vertices.length < 3
  )
    return null;
  const previous = snapshots.get(surface);
  let equal = previous?.id === surface.id && previous.vertices.length === surface.vertices.length;
  for (let index = 0; index < surface.vertices.length; index++) {
    const point = surface.vertices[index];
    if (!Array.isArray(point) || point.length !== 3) return null;
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(point[axis])) return null;
      if (equal && !Object.is(point[axis], previous!.vertices[index][axis])) equal = false;
    }
  }
  if (equal) return previous!;
  const vertices: Vec3[] = [],
    min: Vec3 = [Infinity, Infinity, Infinity],
    max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of surface.vertices) {
    const owned: Vec3 = [...point];
    vertices.push(owned);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], owned[axis]);
      max[axis] = Math.max(max[axis], owned[axis]);
    }
  }
  const snapshot = { id: surface.id, vertices, min, max };
  snapshots.set(surface, snapshot);
  return snapshot;
};
export const supportTriangles = (snapshot: SupportSnapshot): SupportTriangle[] => {
  if (snapshot.triangles) return snapshot.triangles;
  const vertices = snapshot.vertices,
    triangles: SupportTriangle[] = [];
  for (let fan = 1; fan + 1 < vertices.length; fan++) {
    const points: [Vec3, Vec3, Vec3] = [vertices[0], vertices[fan], vertices[fan + 1]];
    const [a, b, c] = points;
    const determinant = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(determinant) < 1e-12) continue;
    triangles.push({
      vertices: points,
      determinant,
      min: [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2])],
      max: [Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])],
      polygonEdges: [
        fan === 1 ? 0 : null,
        fan,
        fan + 1 === vertices.length - 1 ? vertices.length - 1 : null,
      ],
    });
  }
  snapshot.triangles = triangles;
  return triangles;
};
