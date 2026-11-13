import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';
import { surfaceGraph } from '#@/src/v1/geo/surfaces.ts';
import { type GoalProjector, createGoalProjector } from '#@/src/v1/motion/goals.ts';
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
