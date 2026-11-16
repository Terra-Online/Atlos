import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import { type GoalProjector, createGoalProjector } from '#@/src/model/goals.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';
import { surfaceGraph } from '#@/src/v1/geo/surfaces.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
type Options = {
  build: BuildOptions;
  goal: Vec3;
  interaction?: InteractionGoal;
  model: JumpModel;
  /** Prepared geometric projection over these same immutable coarse surfaces. */
  project?: GoalProjector;
  /** complete inclusive XZ AABB candidates from this exact geometry, in input triangle order. */
  queryTriangles?: (bounds: NonNullable<BuildOptions['bounds']>) => number[];
};

/**
 * @param geometry complete selected collision, with non-walkable support faces already excluded
 * @param surfaces immutable coarse ground from the same collision and body profile
 * @param options matching build parameters, goal region and movement model
 * @returns finer support patches missing from the coarse mesh in the goal's local jump-access region
 * @throws when the bounded native refinement fails; returned patches still require physical action checks
 */
export const refineGoalGround = async (
  geometry: CollisionGeometry,
  surfaces: Surface[],
  {
    build,
    goal,
    interaction,
    model,
    queryTriangles,
    project = createGoalProjector(surfaces),
  }: Options,
) => {
  const duration = jumpDuration(goal[1], goal[1], { ...model, mode: 'jump' });
  if (!duration || !build.bounds) {
    return { surfaces: [], bounds: null };
  }
  // A goal region and one ordinary jump's horizontal reach cover its immediate
  // access supports. This is local resolution repair, not a limit on route hops.
  const reach =
    (interaction?.radius ?? 0) + duration * model.maxHorizontalSpeed + build.profile.radius;
  const bounds = {
    min: [
      Math.max(build.bounds.min[0], goal[0] - reach),
      Math.max(build.bounds.min[1], goal[2] - reach),
    ] as [number, number],
    max: [
      Math.min(build.bounds.max[0], goal[0] + reach),
      Math.min(build.bounds.max[1], goal[2] + reach),
    ] as [number, number],
  };
  if (bounds.min.some((value, axis) => value >= bounds.max[axis])) {
    return { surfaces: [], bounds };
  }
  const positions: number[] = [];
  const selected = queryTriangles?.(bounds);
  if (
    selected?.some(
      (id, index) =>
        !Number.isSafeInteger(id) ||
        id < 0 ||
        id >= geometry.indices.length / 3 ||
        (index > 0 && id <= selected[index - 1]),
    )
  ) {
    throw new Error('refinement triangle query must return sorted input triangle indices');
  }
  const count = selected?.length ?? geometry.indices.length / 3;
  for (let triangle = 0; triangle < count; triangle++) {
    const offset = (selected ? selected[triangle] : triangle) * 3;
    const a = geometry.indices[offset],
      b = geometry.indices[offset + 1],
      c = geometry.indices[offset + 2];
    if (
      selected === undefined &&
      !([0, 2] as const).every(
        (axis, index) =>
          Math.min(
            geometry.positions[a * 3 + axis],
            geometry.positions[b * 3 + axis],
            geometry.positions[c * 3 + axis],
          ) <= bounds.max[index] &&
          Math.max(
            geometry.positions[a * 3 + axis],
            geometry.positions[b * 3 + axis],
            geometry.positions[c * 3 + axis],
          ) >= bounds.min[index],
      )
    ) {
      continue;
    }
    for (const id of [a, b, c]) {
      positions.push(
        geometry.positions[id * 3],
        geometry.positions[id * 3 + 1],
        geometry.positions[id * 3 + 2],
      );
    }
  }
  if (!positions.length) {
    return { surfaces: [], bounds };
  }
  const fine = await buildGroundSurfaces(
    { positions, indices: Array.from({ length: positions.length / 3 }, (_, index) => index) },
    { ...build, bounds, cellSize: build.cellSize / 3 },
  );
  const graph = surfaceGraph(fine, { speed: 1 });
  const parents = new Map(fine.map((surface) => [surface.id, surface.id]));
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current) !== current) {
      current = parents.get(current)!;
    }
    while (parents.get(id) !== id) {
      const next = parents.get(id)!;
      parents.set(id, current);
      id = next;
    }
    return current;
  };
  for (const edge of graph.edges) {
    parents.set(root(edge.from), root(edge.to));
  }
  const covered = new Set<string>();
  for (const surface of fine) {
    if (covered.has(root(surface.id))) {
      continue;
    }
    if (
      surface.vertices.some(
        (point) =>
          project.closest(point, {
            maxVertical: build.cellHeight * 2,
            interaction: { radius: build.profile.radius },
          }) !== undefined,
      )
    ) {
      covered.add(root(surface.id));
    }
  }
  const ids = new Set(surfaces.map((surface) => surface.id));
  const additions: Surface[] = [];
  let serial = 0;
  for (const surface of fine) {
    // Mixing overlapping detail meshes can invalidate ordinary portal ownership.
    // Keep only wholly missing support components; partial passage refinement
    // needs a stitched replacement mesh rather than isolated triangle fragments.
    if (covered.has(root(surface.id))) {
      continue;
    }
    let id: string;
    do {
      id = `refined/${serial++}`;
    } while (ids.has(id));
    ids.add(id);
    additions.push({ ...surface, id });
  }
  return { surfaces: additions, bounds };
};

/** Candidate charts for narrow source support omitted by clearance erosion.
 * Candidates retain terrain support/body checks; actions use the ordinary
 * trajectory checks and navigation routes retain their native representation. */
export function narrowGoalSupports(
  geometry: CollisionGeometry,
  surfaces: Surface[],
  options: Options & {
    physical: import('#@/src/model/world.ts').PhysicalWorld;
    maxCandidates: number;
  },
) {
  const { build, goal, interaction, model, physical, maxCandidates } = options;
  const diagnostics = { candidates: 0, tested: 0, admitted: 0, truncated: false };
  const empty = () => ({ surfaces: [] as Surface[], diagnostics });
  const duration = jumpDuration(goal[1], goal[1], { ...model, mode: 'jump' });
  if (!duration || !build.bounds || maxCandidates <= 0) return empty();
  const reach =
    (interaction?.radius ?? 0) + duration * model.maxHorizontalSpeed + build.profile.radius;
  const bounds = {
    min: [
      Math.max(build.bounds.min[0], goal[0] - reach),
      Math.max(build.bounds.min[1], goal[2] - reach),
    ] as [number, number],
    max: [
      Math.min(build.bounds.max[0], goal[0] + reach),
      Math.min(build.bounds.max[1], goal[2] + reach),
    ] as [number, number],
  };
  if (bounds.min.some((v, i) => v >= bounds.max[i])) return empty();
  const selected = options.queryTriangles?.(bounds);
  if (
    selected?.some(
      (id, index) =>
        !Number.isSafeInteger(id) ||
        id < 0 ||
        id >= geometry.indices.length / 3 ||
        (index > 0 && id <= selected[index - 1]),
    )
  )
    throw new Error('Invalid narrow support triangle query');
  const project = options.project ?? createGoalProjector(surfaces);
  const candidates: { surface: Surface; point: Vec3; score: number }[] = [];
  const configured = physical.configured();
  for (let i = 0; i < (selected?.length ?? geometry.indices.length / 3); i++) {
    const index = selected?.[i] ?? i;
    const vertices = [0, 1, 2].map((j) => {
      const offset = geometry.indices[index * 3 + j] * 3;
      return [
        geometry.positions[offset],
        geometry.positions[offset + 1],
        geometry.positions[offset + 2],
      ] as Vec3;
    });
    if (
      ![0, 2].every(
        (axis, side) =>
          Math.min(...vertices.map((v) => v[axis])) <= bounds.max[side] &&
          Math.max(...vertices.map((v) => v[axis])) >= bounds.min[side],
      )
    )
      continue;
    const [a, b, c] = vertices,
      u = b.map((v, j) => v - a[j]),
      v = c.map((value, j) => value - a[j]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (
      normal[1] <= 0 ||
      normal[1] / Math.hypot(...normal) < Math.cos((build.maxSlope * Math.PI) / 180)
    )
      continue;
    const surface = { id: `narrow/${index}`, vertices };
    const nearest = createGoalProjector([surface]).closest(goal, {
      maxVertical: reach,
      interaction: { radius: reach },
    });
    if (
      !nearest ||
      nearest.position[1] + model.maxJumpHeight + (interaction?.radius ?? 0) < goal[1]
    )
      continue;
    const point = nearest.position;
    if (project(point, { maxVertical: build.cellHeight * 2 }).length) continue;
    candidates.push({ surface, point, score: nearest.distance });
  }
  candidates.sort((a, b) => a.score - b.score || a.surface.id.localeCompare(b.surface.id));
  const charts: Surface[] = [];
  diagnostics.candidates = candidates.length;
  for (const candidate of candidates) {
    if (diagnostics.tested >= maxCandidates) {
      diagnostics.truncated = true;
      break;
    }
    diagnostics.tested++;
    const point: Vec3 = [candidate.point[0], candidate.point[1] + 0.01, candidate.point[2]];
    if (!physical.covered(point, point)) continue;
    const feet = configured.standing(point);
    if (!feet || Math.hypot(...feet.map((v, i) => v - point[i])) > 1e-5) continue;
    charts.push(candidate.surface);
  }
  diagnostics.admitted = charts.length;
  return { surfaces: charts, diagnostics };
}
