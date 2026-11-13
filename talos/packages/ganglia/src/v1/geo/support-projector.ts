import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createBoundsIndex } from '#@/src/model/bounds.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';

type Projection = ReturnType<typeof projectPoint>;

const verticalIndices = new WeakMap<Surface[], ReturnType<typeof indexVerticalSupports>>();
export const releaseVerticalProjectionIndex = (surfaces: Surface[]) =>
  verticalIndices.delete(surfaces);
function indexVerticalSupports(surfaces: Surface[]) {
  const entries = surfaces.map((surface, ordinal) => {
    const min: Vec3 = [Infinity, Infinity, Infinity],
      max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const point of surface.vertices)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    let condition = 1;
    const a = surface.vertices[0];
    for (let fan = 1; fan + 1 < surface.vertices.length; fan++) {
      const b = surface.vertices[fan],
        c = surface.vertices[fan + 1];
      const determinant = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(determinant) < 1e-10) continue;
      condition = Math.max(
        condition,
        ((Math.abs(a[0] - c[0]) + Math.abs(b[0] - c[0])) *
          (Math.abs(a[2] - c[2]) + Math.abs(b[2] - c[2]))) /
          Math.abs(determinant),
      );
    }
    const uncertain = !Number.isFinite(condition) || 64 * Number.EPSILON * condition >= 0.25;
    for (let axis = 0; axis < 3; axis++) {
      // projectPoint admits slightly negative barycentric weights. Include the
      // resulting extrapolation and coordinate roundoff before pruning a face.
      const padding =
        3e-8 * (max[axis] - min[axis]) +
        128 * Number.EPSILON * Math.max(1, Math.abs(min[axis]), Math.abs(max[axis])) * condition;
      min[axis] -= padding;
      max[axis] += padding;
    }
    return { surface, ordinal, min, max, uncertain };
  });
  // Near-singular fans do not provide a trustworthy finite spatial exclusion.
  const fallback = entries.filter((entry) => entry.uncertain);
  const query = createBoundsIndex(entries.filter((entry) => !entry.uncertain));
  return { fallback, query };
}

/** Candidate faces from one immutable support mesh, in original input order. */
export function verticalProjectionCandidates(
  surfaces: Surface[],
  position: Vec3,
  maxVertical: number,
): Surface[] {
  // Preserve projectPoint's argument checks even when the spatial query is empty.
  projectPoint([], position, { maxVertical });
  let index = verticalIndices.get(surfaces);
  if (!index) {
    index = indexVerticalSupports(surfaces);
    verticalIndices.set(surfaces, index);
  }
  const bounds = {
    min: [position[0], position[1] - maxVertical, position[2]],
    max: [position[0], position[1] + maxVertical, position[2]],
  };
  return [...index.query(bounds), ...index.fallback]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((entry) => entry.surface);
}

// Device endpoints recur throughout action discovery. This cache belongs to one
// immutable support mesh; all projection inputs, including an explicit support
// identity, remain part of the key. Retain a bounded number of local projections.
export const createSupportProjector = (surfaces: Surface[], byId: Map<string, Surface>) => {
  const projections = new Map<string, Projection>();
  return (position: Vec3, maxVertical: number, surface?: string): Projection => {
    const key = JSON.stringify([
      position.map((value) => (Object.is(value, -0) ? '-0' : value)),
      maxVertical,
      surface,
    ]);
    if (projections.has(key)) return projections.get(key)!;
    const candidates =
      surface === undefined
        ? verticalProjectionCandidates(surfaces, position, maxVertical)
        : [byId.get(surface)!];
    const result = projectPoint(candidates, position, { maxVertical });
    if (projections.size >= 2048) projections.delete(projections.keys().next().value!);
    projections.set(key, result);
    return result;
  };
};
