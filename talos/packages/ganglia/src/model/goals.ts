import type { Vec3, Surface } from '#@/src/geometry.ts';
import { type Bounds, createBoundsIndex } from '#@/src/model/bounds.ts';
import { supportSnapshot } from '#@/src/model/support-snapshot.ts';
import { projectPoint } from '#@/src/model/support.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';

export type GoalProjectionOptions =
  | { maxVertical: number; interaction?: InteractionGoal }
  | { maxVertical?: number; interaction: InteractionGoal };
export interface GoalProjector {
  (target: Vec3, options: GoalProjectionOptions): GoalProjection[];
  /** The same witness as the first full projection, without retaining other surfaces. */
  closest(target: Vec3, options: GoalProjectionOptions): GoalProjection | undefined;
}

type Plane = (point: Vec3) => number;
export interface GoalProjection {
  surface: string;
  position: Vec3;
  distance: number;
}

interface GoalClip {
  maxVertical?: number;
  facing?: { forwardX: number; forwardZ: number; sine: number; cosine: number };
}
const finitePoint = (point: unknown): point is Vec3 =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distanceSquared = (a: readonly number[], b: readonly number[]) => {
  let squared = 0;
  for (let axis = 0; axis < a.length; axis++) squared += (a[axis] - b[axis]) ** 2;
  return squared;
};
const boundsDistanceSquared = (bounds: Bounds, target: Vec3) => {
  let squared = 0;
  for (let axis = 0; axis < 3; axis++) {
    const distance = Math.max(bounds.min[axis] - target[axis], 0, target[axis] - bounds.max[axis]);
    squared += distance * distance;
  }
  return squared;
};
// Keep dot-product accumulation in the original coordinate order. Scalar
// intermediates avoid transient vectors during repeated landing projections.
const dot3 = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
  let sum = 0;
  sum += ax * bx;
  sum += ay * by;
  sum += az * bz;
  return sum;
};
const closestOnEdge = (target: Vec3, a: Vec3, b: Vec3): Vec3 => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const lengthSquared = dot3(dx, dy, dz, dx, dy, dz);
  const fraction =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            dot3(target[0] - a[0], target[1] - a[1], target[2] - a[2], dx, dy, dz) / lengthSquared,
          ),
        );
  return [a[0] + fraction * dx, a[1] + fraction * dy, a[2] + fraction * dz];
};
const closestOnTriangle = (target: Vec3, a: Vec3, b: Vec3, c: Vec3): Vec3 => {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    abz = b[2] - a[2];
  const acx = c[0] - a[0],
    acy = c[1] - a[1],
    acz = c[2] - a[2];
  const atx = target[0] - a[0],
    aty = target[1] - a[1],
    atz = target[2] - a[2];
  const aa = dot3(abx, aby, abz, abx, aby, abz),
    bb = dot3(acx, acy, acz, acx, acy, acz);
  const cross = dot3(abx, aby, abz, acx, acy, acz);
  const determinant = aa * bb - cross * cross;
  if (determinant > 1e-20) {
    const atab = dot3(atx, aty, atz, abx, aby, abz),
      atac = dot3(atx, aty, atz, acx, acy, acz);
    const u = (bb * atab - cross * atac) / determinant;
    const v = (aa * atac - cross * atab) / determinant;
    if (u >= 0 && v >= 0 && u + v <= 1) {
      return [a[0] + u * abx + v * acx, a[1] + u * aby + v * acy, a[2] + u * abz + v * acz];
    }
  }
  let best = closestOnEdge(target, a, b),
    squared = distanceSquared(target, best);
  const second = closestOnEdge(target, b, c),
    secondSquared = distanceSquared(target, second);
  if (secondSquared < squared) {
    best = second;
    squared = secondSquared;
  }
  const third = closestOnEdge(target, c, a);
  if (distanceSquared(target, third) < squared) best = third;
  return best;
};
const clipPolygon = (vertices: Vec3[], signedDistance: Plane): Vec3[] => {
  const output: Vec3[] = [];
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index],
      b = vertices[(index + 1) % vertices.length];
    const aDistance = signedDistance(a),
      bDistance = signedDistance(b);
    const aInside = aDistance >= 0,
      bInside = bDistance >= 0;
    if (aInside) output.push(a);
    if (aInside !== bInside) {
      const fraction = aDistance / (aDistance - bDistance);
      output.push([
        a[0] + fraction * (b[0] - a[0]),
        a[1] + fraction * (b[1] - a[1]),
        a[2] + fraction * (b[2] - a[2]),
      ] satisfies Vec3);
    }
  }
  return output;
};
export const closestOnSurface = (
  surface: Surface,
  target: Vec3,
  planes: Plane[] = [],
): GoalProjection | null => {
  let best: Vec3 | null = null,
    shortest = Infinity;
  const a = surface.vertices[0];
  for (let fan = 1; fan + 1 < surface.vertices.length; fan++) {
    const b = surface.vertices[fan],
      c = surface.vertices[fan + 1];
    const areaXZ = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    if (Math.abs(areaXZ) < 1e-10) continue;
    if (!planes.length) {
      const point = closestOnTriangle(target, a, b, c);
      const squared = distanceSquared(target, point);
      if (squared < shortest) {
        best = point;
        shortest = squared;
      }
      continue;
    }
    let polygon = [a, b, c];
    for (const plane of planes) polygon = clipPolygon(polygon, plane);
    if (!polygon.length) continue;
    const candidates = [];
    if (polygon.length < 3) {
      candidates.push(closestOnEdge(target, polygon[0], polygon.at(-1)!));
    } else {
      for (let index = 1; index + 1 < polygon.length; index++) {
        candidates.push(closestOnTriangle(target, polygon[0], polygon[index], polygon[index + 1]));
      }
    }
    for (const point of candidates) {
      const squared = distanceSquared(target, point);
      if (squared < shortest) {
        best = point;
        shortest = squared;
      }
    }
  }
  return best && { surface: surface.id, position: best, distance: Math.sqrt(shortest) };
};
/** Prepare repeated foot-position or interaction-region goal queries.
 * Surfaces must be selected convex ground polygons for one scene, state and body.
 * The index owns a snapshot. Rebuild it when the ground changes.
 *
 * Without interaction, maxVertical selects the same single vertical projection as
 * projectPoint. Interaction radius is an explicitly supplied 3D sphere around the
 * target. Optional interaction.maxVertical independently clips standing heights.
 * Explicit facing and halfAngle (degrees, 0 < halfAngle <= 90) restrict candidates
 * to the target's horizontal forward cone. These fields must be provided together.
 * Results contain one nearest feasible standing point per eligible surface, ordered
 * by target distance. This finite set does not solve continuous region-entry cost.
 * Callers must check reachability, wall state and interaction line of sight.
 */
export function createGoalProjector(surfaces: Surface[]): GoalProjector {
  if (!Array.isArray(surfaces)) throw new Error('Invalid goal surfaces');
  const ids = new Set<string>();
  let coordinateScale = 1;
  const snapshot = surfaces.map((surface, index) => {
    const owned = supportSnapshot(surface);
    if (!owned || ids.has(owned.id)) throw new Error('Invalid goal surface');
    ids.add(owned.id);
    for (let axis = 0; axis < 3; axis++)
      coordinateScale = Math.max(
        coordinateScale,
        Math.abs(owned.min[axis]),
        Math.abs(owned.max[axis]),
      );
    return { id: owned.id, vertices: owned.vertices, index, min: owned.min, max: owned.max };
  });
  const query = createBoundsIndex(snapshot);
  // Repeated action endpoints share only immutable geometric projection proofs.
  // Keep ownership separate from returned witnesses and bound arbitrary query history.
  const projections = new Map<string, GoalProjection[]>();
  const closestProjections = new Map<string, GoalProjection | null>();
  let witnesses = 0;
  const copyValue = (value: GoalProjection) => ({
    ...value,
    position: [...value.position] satisfies Vec3,
  });
  const copy = (values: GoalProjection[]) => values.map(copyValue);
  const projectionKey = (target: Vec3, { maxVertical, interaction }: GoalProjectionOptions) =>
    JSON.stringify([
      target.map((value) => (Object.is(value, -0) ? '-0' : value)),
      maxVertical,
      interaction?.radius,
      interaction?.maxVertical,
      interaction?.facing,
      interaction?.halfAngle,
    ]);
  const remember = (key: string, values: GoalProjection[]) => {
    // A broad interaction can return thousands of surfaces. Retaining those
    // results evicts frequently reused point proofs and makes entry count a
    // misleading memory bound. Return large results without caching them.
    if (values.length > 1024) return values;
    while (projections.size >= 65536 || witnesses + values.length > 65536) {
      const oldest = projections.keys().next().value!;
      witnesses -= projections.get(oldest)!.length;
      projections.delete(oldest);
    }
    witnesses += values.length;
    projections.set(key, copy(values));
    return values;
  };
  const project = (target: Vec3, options: GoalProjectionOptions): GoalProjection[] => {
    if (!finitePoint(target) || !options) throw new Error('Invalid goal query');
    const { maxVertical, interaction } = options;
    const key = projectionKey(target, options);
    const cached = projections.get(key);
    if (interaction === undefined) {
      if (!Number.isFinite(maxVertical) || maxVertical! < 0)
        throw new Error('Invalid goal projection height');
      if (cached) return copy(cached);
      const bounds = {
        min: [target[0], target[1] - maxVertical!, target[2]],
        max: [target[0], target[1] + maxVertical!, target[2]],
      };
      const candidates = [...query(bounds)].sort((a, b) => a.index - b.index);
      let best: GoalProjection | null = null;
      for (const surface of candidates) {
        const projected = projectPoint([surface], target, { maxVertical: maxVertical! });
        if (!projected) continue;
        const distance = Math.abs(projected.position[1] - target[1]);
        if (!best || distance < best.distance) best = { ...projected, distance };
      }
      return remember(key, best ? [best] : []);
    }
    const clip = interactionClip(interaction);
    if (cached) return copy(cached);
    const radius = interaction.radius;
    const bounds = {
      min: target.map((value) => value - radius),
      max: target.map((value) => value + radius),
    };
    if (interaction.maxVertical !== undefined) {
      bounds.min[1] = Math.max(bounds.min[1], target[1] - interaction.maxVertical);
      bounds.max[1] = Math.min(bounds.max[1], target[1] + interaction.maxVertical);
    }
    const candidates: (GoalProjection & { index: number })[] = [];
    const planes = planesFromClip(target, clip);
    for (const surface of query(bounds, target, radius)) {
      const candidate = closestOnSurface(surface, target, planes);
      if (candidate && candidate.distance <= radius)
        candidates.push({ ...candidate, index: surface.index });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.index - b.index);
    return remember(
      key,
      candidates.map(({ index, ...candidate }) => candidate),
    );
  };
  project.closest = (target: Vec3, options: GoalProjectionOptions): GoalProjection | undefined => {
    if (!finitePoint(target) || !options) throw new Error('Invalid goal query');
    const { interaction } = options;
    if (interaction === undefined) return project(target, options)[0];
    const clip = interactionClip(interaction);
    const key = projectionKey(target, options);
    const cached = closestProjections.get(key);
    if (cached !== undefined) return cached ? copyValue(cached) : undefined;
    const radius = interaction.radius;
    const bounds = {
      min: target.map((value) => value - radius),
      max: target.map((value) => value + radius),
    };
    if (interaction.maxVertical !== undefined) {
      bounds.min[1] = Math.max(bounds.min[1], target[1] - interaction.maxVertical);
      bounds.max[1] = Math.min(bounds.max[1], target[1] + interaction.maxVertical);
    }
    const planes = planesFromClip(target, clip);
    let best: GoalProjection | undefined;
    let bestIndex = Infinity;
    // Clipping and triangle projection can round a witness just beyond its box.
    // Use the entire snapshot's scale so even later boxes with larger coordinates
    // retain that allowance. This relaxes pruning only, never witness acceptance.
    const roundoff = 128 * Number.EPSILON * Math.max(coordinateScale, ...target.map(Math.abs));
    const touches = (candidate: Bounds) =>
      boundsDistanceSquared(candidate, target) <= radius * radius;
    for (const surface of query.nearest(bounds, target, touches)) {
      if (best && Math.sqrt(boundsDistanceSquared(surface, target)) > best.distance + roundoff)
        break;
      const candidate = closestOnSurface(surface, target, planes);
      if (!candidate || !(candidate.distance <= radius)) continue;
      if (
        !best ||
        candidate.distance < best.distance ||
        (candidate.distance === best.distance && surface.index < bestIndex)
      ) {
        best = {
          surface: candidate.surface,
          position: candidate.position,
          distance: candidate.distance,
        };
        bestIndex = surface.index;
      }
    }
    if (closestProjections.size >= 4096)
      closestProjections.delete(closestProjections.keys().next().value!);
    closestProjections.set(key, best ? copyValue(best) : null);
    return best;
  };
  return project;
}
/** Project a single goal. Reuse createGoalProjector for repeated queries. */
export function projectGoal(
  surfaces: Surface[],
  target: Vec3,
  options: GoalProjectionOptions,
): GoalProjection[] {
  return createGoalProjector(surfaces)(target, options);
}
function interactionPlanes(target: Vec3, interaction: InteractionGoal): Plane[] {
  return planesFromClip(target, interactionClip(interaction));
}
function interactionClip(interaction: InteractionGoal): GoalClip {
  if (
    !interaction ||
    !Number.isFinite(interaction.radius) ||
    interaction.radius < 0 ||
    (interaction.maxVertical !== undefined &&
      (!Number.isFinite(interaction.maxVertical) || interaction.maxVertical! < 0))
  ) {
    throw new Error('Invalid interaction goal range');
  }
  const clip: GoalClip = { maxVertical: interaction.maxVertical };
  if (interaction.facing !== undefined || interaction.halfAngle !== undefined) {
    if (
      !finitePoint(interaction.facing) ||
      Math.hypot(interaction.facing[0], interaction.facing[2]) === 0 ||
      !Number.isFinite(interaction.halfAngle) ||
      interaction.halfAngle! <= 0 ||
      interaction.halfAngle! > 90
    ) {
      throw new Error('Invalid interaction facing cone');
    }
    const length = Math.hypot(interaction.facing[0], interaction.facing[2]);
    const forwardX = interaction.facing[0] / length,
      forwardZ = interaction.facing[2] / length;
    const angle = (interaction.halfAngle! * Math.PI) / 180;
    const sine = Math.sin(angle),
      cosine = interaction.halfAngle === 90 ? 0 : Math.cos(angle);
    clip.facing = { forwardX, forwardZ, sine, cosine };
  }
  return clip;
}
function planesFromClip(target: Vec3, clip: GoalClip): Plane[] {
  const planes: Plane[] = [];
  if (clip.maxVertical !== undefined) {
    planes.push(
      (point: Vec3) => point[1] - target[1] + clip.maxVertical!,
      (point: Vec3) => target[1] + clip.maxVertical! - point[1],
    );
  }
  if (clip.facing) {
    const { forwardX, forwardZ, sine, cosine } = clip.facing;
    const forward = (point: Vec3) =>
      (point[0] - target[0]) * forwardX + (point[2] - target[2]) * forwardZ;
    const side = (point: Vec3) =>
      (point[0] - target[0]) * forwardZ - (point[2] - target[2]) * forwardX;
    planes.push(
      (point: Vec3) => forward(point) * sine + side(point) * cosine,
      (point: Vec3) => forward(point) * sine - side(point) * cosine,
    );
  }
  return planes;
}
/** Locate a hit along a supplied piecewise-linear trajectory. The caller owns
 * collision validation and safe termination after the hit. */
export function findGoalHit(
  points: Vec3[],
  target: Vec3,
  interaction: InteractionGoal,
): { index: number; fraction: number; position: Vec3 } | null {
  if (
    !finitePoint(target) ||
    !Array.isArray(points) ||
    !points.length ||
    !points.every(finitePoint)
  ) {
    throw new Error('Invalid goal trajectory');
  }
  const planes = interactionPlanes(target, interaction);
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1],
      b = points[index];
    let near = 0,
      far = 1;
    for (const plane of planes) {
      const first = plane(a),
        last = plane(b);
      if (first < 0 && last < 0) {
        far = -1;
        break;
      }
      if (first < 0) near = Math.max(near, first / (first - last));
      if (last < 0) far = Math.min(far, first / (first - last));
    }
    if (near > far) continue;
    const delta = b.map((value, axis) => value - a[axis]);
    const offset = a.map((value, axis) => value - target[axis]);
    const quadratic = delta.reduce((sum, value) => sum + value * value, 0);
    const linear = delta.reduce((sum, value, axis) => sum + value * offset[axis], 0);
    const constant = distanceSquared(a, target) - interaction.radius ** 2;
    if (quadratic === 0) {
      if (constant <= 0) return { index, fraction: near, position: [...a] };
      continue;
    }
    const discriminant = linear * linear - quadratic * constant;
    if (discriminant < 0) continue;
    const root = Math.sqrt(discriminant);
    let fraction = Math.max(near, (-linear - root) / quadratic);
    if (fraction > Math.min(far, (-linear + root) / quadratic) + 1e-9) continue;
    fraction = Math.min(far, fraction);
    const position = [
      a[0] + fraction * delta[0],
      a[1] + fraction * delta[1],
      a[2] + fraction * delta[2],
    ] satisfies Vec3;
    return { index, fraction, position };
  }
  return null;
}

// A grounded completion is witnessed at the verified route endpoint. Its index
// and local time must be rebuilt when scheduling or detour removal splits walks.
export function hasTerminalGroundEvent(route: Extract<Route, { status: 'complete' }>) {
  const hit = route.goalHit,
    last = route.segments?.at(-1);
  return Boolean(
    hit &&
    last?.mode === 'walk' &&
    hit.segment === route.segments.length - 1 &&
    hit.time === last.times.at(-1) &&
    distanceSquared(hit.position, route.points.at(-1)!) <= 1e-18,
  );
}

export function markTerminalGoal(
  route: Extract<Route, { status: 'complete' }>,
): Extract<Route, { status: 'complete' }> {
  const point = route.points.at(-1)!;
  const segments: Extract<Route, { status: 'complete' }>['segments'] = route.segments.length
    ? route.segments
    : [{ mode: 'walk', points: [point, point], times: [0, 0] }];
  return {
    ...route,
    segments,
    goalHit: {
      segment: segments.length - 1,
      time: segments.at(-1)!.times.at(-1)!,
      position: [...point],
    },
  };
}

// Interaction completion owns the terminal point of an airborne collection action.
export function trimGoalFlight<T extends { points: Vec3[]; times: number[] }>(
  arc: T | null,
  target: Vec3,
  interaction: InteractionGoal,
): T | null {
  if (!arc) return null;
  const hit = findGoalHit(arc.points, target, interaction);
  if (!hit) return null;
  const time =
    arc.times[hit.index - 1] + hit.fraction * (arc.times[hit.index] - arc.times[hit.index - 1]);
  if (time <= 0) return null;
  const points = arc.points.slice(0, hit.index),
    times = arc.times.slice(0, hit.index);
  if (time > times.at(-1)!) {
    points.push(hit.position);
    times.push(time);
  }
  return { ...arc, points, times };
}
