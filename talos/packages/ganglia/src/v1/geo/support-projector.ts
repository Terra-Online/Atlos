import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createOrdinalBoundsIndex } from '#@/src/model/bounds.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';

type Projection = ReturnType<typeof projectPoint>;

const verticalIndices = new WeakMap<Surface[], ReturnType<typeof indexVerticalSupports>>();
export const releaseVerticalProjectionIndex = (surfaces: Surface[]) =>
  verticalIndices.delete(surfaces);
function indexVerticalSupports(surfaces: Surface[]) {
  const boxes = new Float64Array(surfaces.length * 6);
  const ordinals = new Uint32Array(surfaces.length);
  const fallback: number[] = [];
  const min: Vec3 = [0, 0, 0],
    max: Vec3 = [0, 0, 0];
  let count = 0;
  for (let ordinal = 0; ordinal < surfaces.length; ordinal++) {
    const surface = surfaces[ordinal];
    min.fill(Infinity);
    max.fill(-Infinity);
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
    // Near-singular fans do not provide a trustworthy finite spatial exclusion.
    if (!Number.isFinite(condition) || 64 * Number.EPSILON * condition >= 0.25) {
      fallback.push(ordinal);
      continue;
    }
    ordinals[count] = ordinal;
    const offset = count++ * 6;
    for (let axis = 0; axis < 3; axis++) {
      // projectPoint admits slightly negative barycentric weights. Include the
      // resulting extrapolation and coordinate roundoff before pruning a face.
      const padding =
        3e-8 * (max[axis] - min[axis]) +
        128 * Number.EPSILON * Math.max(1, Math.abs(min[axis]), Math.abs(max[axis])) * condition;
      boxes[offset + axis] = min[axis] - padding;
      boxes[offset + axis + 3] = max[axis] + padding;
    }
  }
  const certainBoxes = count === surfaces.length ? boxes : boxes.slice(0, count * 6);
  const certainOrdinals = count === surfaces.length ? ordinals : ordinals.slice(0, count);
  const fallbackOrdinals = Uint32Array.from(fallback);
  const query = createOrdinalBoundsIndex(certainBoxes);
  return { certainOrdinals, fallbackOrdinals, query };
}

/** Candidate faces from one immutable support mesh, in original input order. */
export function verticalProjectionCandidates(
  surfaces: Surface[],
  position: Vec3,
  maxVertical: number,
  horizontal = 0,
): Surface[] {
  // Preserve projectPoint's argument checks even when the spatial query is empty.
  projectPoint([], position, { maxVertical });
  if (!Number.isFinite(horizontal) || horizontal < 0)
    throw new Error('Invalid projection footprint');
  let index = verticalIndices.get(surfaces);
  if (!index) {
    index = indexVerticalSupports(surfaces);
    verticalIndices.set(surfaces, index);
  }
  const bounds = {
    min: [position[0] - horizontal, position[1] - maxVertical, position[2] - horizontal],
    max: [position[0] + horizontal, position[1] + maxVertical, position[2] + horizontal],
  };
  const { certainOrdinals, fallbackOrdinals, query } = index;
  const hits = Array.from(fallbackOrdinals);
  query.forEach(bounds, (ordinal) => hits.push(certainOrdinals[ordinal]));
  hits.sort((a, b) => a - b);
  return hits.map((ordinal) => surfaces[ordinal]);
}

// Device endpoints recur throughout action discovery. This cache belongs to one
// immutable support mesh; all projection inputs, including an explicit support
// identity, remain part of the key. Retain a bounded number of local projections.
export const createSupportProjector = (
  surfaces: Surface[],
  byId: Pick<ReadonlyMap<string, Surface>, 'get' | 'has'>,
) => {
  const projections = new Map<string, Projection>();
  return (position: Vec3, maxVertical: number, surface?: string): Projection => {
    const key = `${Object.is(position[0], -0) ? '-0' : position[0]},${Object.is(position[1], -0) ? '-0' : position[1]},${Object.is(position[2], -0) ? '-0' : position[2]}|${maxVertical}|${surface ?? ''}`;
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
