import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import { type GoalProjector, createGoalProjector, findGoalHit } from '#@/src/model/goals.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';
import { surfaceGraph } from '#@/src/v1/geo/surfaces.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
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
 * Chart interiors are not clearance proofs: callers must use checkedGroundPlanner
 * and proveGroundRoute on every selected route before accepting the fallback. */
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

/** Only emit supported, swept spans after physical projection. Revalidating the
 * emitted chords prevents a long accepted seed trace from changing meaning when
 * it is split into ground/resource segments. Non-ground action feet stay exact. */
export function proveGroundRoute(
  route: import('#@/src/route.ts').Route,
  physical: import('#@/src/model/world.ts').PhysicalWorld,
  options: import('#@/src/route.ts').GroundOptions,
  target?: { position: Vec3; interaction?: InteractionGoal },
): import('#@/src/route.ts').Route {
  if (route.status !== 'complete') return route;
  // Boost pickup/expiry clocks were proved before this walking correction.
  // Rebuilding them needs the boost planner's complete expiry validation.
  if (route.boosts?.length || route.segments.some((s) => s.boost || s.boostExpiry !== undefined))
    return { status: 'no-verified-route' };
  const configured = physical.configured(route.placements);
  const rejected = () => ({ status: 'no-verified-route' as const });
  if (!route.segments.length) {
    const point = route.points[0];
    if (!point) return rejected();
    route = {
      ...route,
      segments: [{ mode: 'walk', points: [point, point], times: [0, 0] }],
    };
  }
  const segments: import('#@/src/movement.ts').Segment[] = [];
  for (const [index, segment] of route.segments.entries()) {
    if (segment.mode !== 'walk') {
      segments.push(segment);
      continue;
    }
    const points: Vec3[] = [];
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1],
        b = segment.points[i];
      if (!physical.covered(a, b)) return rejected();
      const feet = (p: Vec3) =>
        configured.standing(p) ?? configured.standing([p[0], p[1] + 0.01, p[2]]);
      const from = feet(a),
        to = feet(b);
      const trace = from && to && configured.walkTrace(from, to);
      if (!trace) return rejected();
      for (let j = 1; j < trace.length; j++)
        if (!configured.supportedSpan(trace[j - 1], trace[j], 1e-5)) return rejected();
      if (points.length && Math.hypot(...points.at(-1)!.map((v, k) => v - trace[0][k])) > 1e-5)
        return rejected();
      points.push(...(points.length ? trace.slice(1) : trace));
    }
    if (!points.length) return rejected();
    if (points.length === 1) points.push(points[0]);
    if (index === 0 && Math.hypot(...points[0].map((v, i) => v - segment.points[0][i])) > 0.02)
      return rejected();
    if (
      index === route.segments.length - 1 &&
      Math.hypot(...points.at(-1)!.map((v, i) => v - segment.points.at(-1)![i])) > 0.02
    )
      return rejected();
    if (
      index &&
      route.segments[index - 1].mode !== 'walk' &&
      Math.hypot(...points[0].map((v, i) => v - segment.points[0][i])) > 1e-5
    )
      return rejected();
    if (
      index + 1 < route.segments.length &&
      route.segments[index + 1].mode !== 'walk' &&
      Math.hypot(...points.at(-1)!.map((v, i) => v - segment.points.at(-1)![i])) > 1e-5
    )
      return rejected();
    const times = [0];
    for (let i = 1; i < points.length; i++)
      times.push(
        times[i - 1] + Math.hypot(...points[i].map((v, j) => v - points[i - 1][j])) / options.speed,
      );
    segments.push({ ...segment, points, times });
  }
  const points = segments.flatMap((s, i) => (i ? s.points.slice(1) : s.points));
  let result: import('#@/src/route.ts').Route = {
    ...route,
    segments,
    points,
    length: segments.reduce(
      (sum, s) =>
        sum +
        s.points
          .slice(1)
          .reduce((length, p, i) => length + Math.hypot(...p.map((v, j) => v - s.points[i][j])), 0),
      0,
    ),
    cost: route.arrivalCost + segments.reduce((sum, s) => sum + s.times.at(-1)!, 0),
  };
  if (target) {
    if (target.interaction) {
      const terminal = points.at(-1)!;
      if (!findGoalHit([terminal, terminal], target.position, target.interaction))
        return rejected();
      let found = false;
      for (const [index, segment] of segments.entries()) {
        const hit = findGoalHit(segment.points, target.position, target.interaction);
        if (!hit) continue;
        const time =
          segment.times[hit.index - 1] +
          hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]);
        const terminalEvent =
          index === segments.length - 1 &&
          Math.abs(time - segment.times.at(-1)!) <=
            4096 * Number.EPSILON * Math.max(1, segment.times.at(-1)!);
        if (target.interaction.airborne && !terminalEvent) return rejected();
        result.goalHit = {
          segment: index,
          position: terminalEvent ? terminal : hit.position,
          time: terminalEvent ? segment.times.at(-1)! : time,
        };
        found = true;
        break;
      }
      if (!found) return rejected();
    } else if (Math.hypot(...points.at(-1)!.map((v, i) => v - target.position[i])) > 0.02)
      return rejected();
  } else if (route.goalHit && route.segments[route.goalHit.segment]?.mode === 'walk')
    return rejected();
  if (options.locomotion) result = retimeGroundRoute(result, options.locomotion);
  return result;
}

export function checkedGroundPlanner(
  surfaces: Surface[],
  options: import('#@/src/route.ts').GroundOptions,
  physical: import('#@/src/model/world.ts').PhysicalWorld,
) {
  const planner = createGroundPlanner(surfaces, options),
    plan = planner.plan;
  planner.plan = (...args) =>
    proveGroundRoute(plan(...args), physical, options, {
      position: args[1],
      interaction: args[2]?.interaction,
    });
  return planner;
}
