type Point = [number, number];
import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import { createGoalProjector, findGoalHit, type GoalProjector } from '#@/src/model/goals.ts';
import { supportBounds } from '#@/src/model/supports.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { GroundArrival, GroundConnection, Route } from '#@/src/route.ts';
import type { FollowingSupport, PoseBounds } from '#@/src/solver/physical.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';
import { verticalProjectionCandidates } from '#@/src/v1/geo/support-projector.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
/* oxlint-disable no-await-in-loop -- each bounded layout is baked and queried in isolation */
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { roofSteps } from '#@/src/v1/solver/physical/following-steps.ts';
import type { SupportBox } from '#@/src/v1/solver/physical/moving-route.ts';

type Diagnostics = {
  assumption: 'placement-within-activity-range';
  placements: number;
  stepPlacements: number;
  limits: { placements: number; jumpCandidatesPerPlacement: number };
  truncated: boolean;
  outcomes: { device: string; reason: string; position?: Vec3 }[];
};
type Result = {
  route: Route;
  connections: GroundConnection[];
  supportBoxes: SupportBox[];
  diagnostics: Diagnostics;
};

import {
  vector,
  distance,
  shifted,
  corners,
  flatCuboid,
  roofContains,
  footprintOf,
  trianglesOf,
  flatSupport,
  overlaps,
  blockedBody,
  onBoxFace,
  joinedGeometry,
} from '#@/src/model/placement.ts';
const addBodies = (base: CollisionWorld, bodies: Vec3[][]): CollisionWorld => {
  const extra = createCollisionWorld(joinedGeometry({ positions: [], indices: [] }, bodies));
  return {
    bounds: base.bounds,
    trianglesInBounds: base.trianglesInBounds?.bind(base),
    sweepCapsule(a, b, profile) {
      return base.sweepCapsule(a, b, profile) ?? extra.sweepCapsule(a, b, profile);
    },
    ...(base.hasTrianglesInAabb && extra.hasTrianglesInAabb
      ? {
          hasTrianglesInAabb(
            minX: number,
            minY: number,
            minZ: number,
            maxX: number,
            maxY: number,
            maxZ: number,
          ) {
            return (
              base.hasTrianglesInAabb!(minX, minY, minZ, maxX, maxY, maxZ) ||
              extra.hasTrianglesInAabb!(minX, minY, minZ, maxX, maxY, maxZ)
            );
          },
        }
      : {}),
    ...(base.probeSphere && extra.probeSphere
      ? {
          probeSphere(center: Vec3, radius: number) {
            return base.probeSphere!(center, radius) || extra.probeSphere!(center, radius);
          },
        }
      : {}),
    groundAt(point, options) {
      const a = base.groundAt(point, options),
        b = extra.groundAt(point, options);
      if (!a) {
        return b;
      }
      if (!b) {
        return a;
      }
      return (options.radius ?? 0) > 0
        ? a.position[1] > b.position[1]
          ? a
          : b
        : Math.abs(a.position[1] - point[1]) <= Math.abs(b.position[1] - point[1])
          ? a
          : b;
    },
  };
};
const geometryOfTriangles = (triangles: Vec3[][]): CollisionGeometry => ({
  positions: triangles.flat(2),
  indices: Array.from({ length: triangles.length * 3 }, (_, i) => i),
});

const bodyWall = (bounds: PoseBounds) => ({
  ...bounds,
  max: [bounds.max[0], bounds.max[1] - 0.001, bounds.max[2]] as Vec3,
  state: 'active' as const,
});
const insideScope = (bounds: PoseBounds, scope: BuildOptions['bounds']) =>
  !scope ||
  [0, 2].every((axis, i) => bounds.min[axis] >= scope.min[i] && bounds.max[axis] <= scope.max[i]);

const validPoint = (point: Vec3) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);

// known actions retain their source timing. only the newly introduced solids need
// another sweep; the same gravity/air-acceleration bound covers their arc chords.
const compatibleConnections = (
  connections: GroundConnection[],
  bodies: Vec3[][],
  jump: JumpRouteOptions,
) => {
  const added = createCollisionWorld(joinedGeometry({ positions: [], indices: [] }, bodies));
  const blocked = createWallChecker(
    bodies.map((body) => bodyWall(supportBounds([body]))),
    jump.profile,
  );
  return connections.filter((connection) => {
    if (
      connection.points.length < 2 ||
      connection.times.length !== connection.points.length ||
      !connection.points.every(validPoint) ||
      !connection.times.every(Number.isFinite)
    ) {
      return false;
    }
    return connection.points.slice(1).every((point, index) => {
      const elapsed = connection.times[index + 1] - connection.times[index];
      if (elapsed < 0) {
        return false;
      }
      const acceleration =
        connection.mode === 'rope'
          ? 0
          : Math.hypot(
              Math.max(jump.model.gravity, jump.model.fallingGravity),
              Math.max(jump.model.airAcceleration ?? 0, jump.model.airDeceleration ?? 0),
            );
      const inflation = (acceleration * elapsed ** 2) / 8 + 0.01;
      return (
        !blocked(connection.points[index], point, inflation) &&
        !added.sweepCapsule(connection.points[index], point, { ...jump.profile, inflation })
      );
    });
  });
};

/**
 * @param supports actual source box colliders and their spherical activity limits
 * @param terrain immutable static collision; unidentified original box collision is never removed
 * @param world matching static collision index
 * @param starts grounded arrivals; unavailable, invalid and blocked arrivals cannot seed a route
 * @param goal grounded target or explicit interaction centre
 * @param options matching player settings, ground build and finite shared discovery budgets
 * @returns a resource-feasible route under one joint layout, retaining every selected
 * pose and the bounds of actually used roofs. Each box keeps its own activity sphere.
 * @throws for invalid player build settings or a failed native bake
 */
// Combine an already-indexed static projector with a small temporary roof
// overlay so per-placement queries never re-index the full static surface set.
const combineGoalProjectors = (base: GoalProjector, overlay: GoalProjector): GoalProjector => {
  const combined: GoalProjector = (target, options) => {
    const a = base(target, options);
    const b = overlay(target, options);
    if (!b.length) return a;
    if (!a.length) return b;
    if (options.interaction === undefined) return a[0].distance <= b[0].distance ? a : b;
    // Preserve [...surfaces, ...roofs] order on equal distance ties.
    const merged: typeof a = [];
    let i = 0,
      j = 0;
    while (i < a.length && j < b.length) {
      merged.push(a[i].distance <= b[j].distance ? a[i++] : b[j++]);
    }
    while (i < a.length) merged.push(a[i++]);
    while (j < b.length) merged.push(b[j++]);
    return merged;
  };
  combined.closest = (target, options) => {
    const a = base.closest(target, options);
    const b = overlay.closest(target, options);
    if (!a) return b;
    if (!b) return a;
    return a.distance <= b.distance ? a : b;
  };
  return combined;
};

export const planFollowingRoute = async (
  supports: FollowingSupport[],
  terrain: CollisionGeometry,
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  {
    surfaces,
    build,
    jump,
    onProgress,
    firstFeasible,
    onCandidate,
    checkpoint,
  }: {
    surfaces: Surface[];
    build: BuildOptions;
    jump: JumpRouteOptions;
    firstFeasible?: boolean;
    onCandidate?: (value: Result) => Promise<void>;
    onProgress?: (value: Record<string, unknown>) => void;
    checkpoint?: () => Promise<void>;
  },
): Promise<Result> => {
  const validBudget = [jump.maxLinks, jump.maxCandidates].every(
    (value) => Number.isSafeInteger(value) && value >= 0,
  );
  const maxPlacements = validBudget ? Math.min(jump.maxLinks, jump.maxCandidates) : 0;
  const perPlacement = maxPlacements ? Math.floor(jump.maxCandidates / maxPlacements) : 0;
  const diagnostics: Diagnostics = {
    assumption: 'placement-within-activity-range',
    placements: 0,
    stepPlacements: 0,
    limits: { placements: maxPlacements, jumpCandidatesPerPlacement: perPlacement },
    truncated: false,
    outcomes: [],
  };
  let best: Result = {
    route: { status: 'no-verified-route' },
    connections: [],
    supportBoxes: [],
    diagnostics,
  };
  const outcome = (device: string, reason: string, position?: Vec3) =>
    diagnostics.outcomes.push({ device, reason, ...(position ? { position } : {}) });
  if (!validBudget || !maxPlacements) {
    outcome('', validBudget ? 'placement-budget-empty' : 'invalid-placement-budget');
    return best;
  }
  const arrivals = starts.filter(
    (start) =>
      start.state === 'available' &&
      validPoint(start.position) &&
      Number.isFinite(start.cost) &&
      start.cost >= 0,
  );
  if (!arrivals.length) {
    outcome('', 'no-available-starts');
    return best;
  }
  const definitions: { support: FollowingSupport; bounds: PoseBounds }[] = [];
  for (const support of supports) {
    if (definitions.some((d) => d.support.id === support.id)) {
      outcome(support.id, 'duplicate-support-id');
      return best;
    }
    try {
      definitions.push({ support, bounds: supportBounds(support.bodies) });
    } catch {
      outcome(support.id, 'invalid-box-obstacle-geometry');
      return best;
    }
  }
  const project = createGoalProjector(surfaces);
  const bounded = <T>(values: T[]) => {
    diagnostics.truncated ||= values.length > maxPlacements;
    return values.slice(0, maxPlacements);
  };
  const projectNearby = (position: Vec3, maxVertical: number, horizontal: number) =>
    createGoalProjector(verticalProjectionCandidates(surfaces, position, maxVertical, horizontal))(
      position,
      { maxVertical, interaction: { radius: Math.hypot(horizontal, maxVertical), maxVertical } },
    ).filter(
      (hit) =>
        Math.hypot(hit.position[0] - position[0], hit.position[2] - position[2]) <= horizontal,
    );
  const surfaceById = new Map(surfaces.map((s) => [s.id, s]));
  const choices: {
    support: FollowingSupport;
    original: PoseBounds;
    supportTriangles: Vec3[][];
    sourceCollision: boolean;
    candidates: { position: Vec3; floor: number }[];
    steps: { position: Vec3; floor: number }[];
  }[] = [];
  for (const { support, bounds: original } of definitions) {
    await checkpoint?.();
    if (
      !validPoint(support.spawn) ||
      !Number.isFinite(support.maxDistance) ||
      support.maxDistance <= 0 ||
      !support.bodies.length ||
      support.bodies.some((body) => body.some((p) => !validPoint(p)))
    ) {
      outcome(support.id, 'invalid-support-definition');
      continue;
    }
    if (support.geometryKind !== 'box' || support.bodies.some((body) => !flatCuboid(body))) {
      outcome(support.id, 'solid-roof-unsupported');
      continue;
    }
    const bottomOffset = original.min[1] - support.spawn[1];
    if (
      support.bodies.some((body) => Math.abs(supportBounds([body]).min[1] - original.min[1]) > 1e-5)
    ) {
      outcome(support.id, 'solid-base-unsupported');
      continue;
    }
    const radius = Math.max(
      original.max[0] - support.spawn[0],
      support.spawn[0] - original.min[0],
      original.max[2] - support.spawn[2],
      support.spawn[2] - original.min[2],
    );
    const sourceScope = {
      min: [
        support.spawn[0] - support.maxDistance - radius,
        support.spawn[2] - support.maxDistance - radius,
      ] as Point,
      max: [
        support.spawn[0] + support.maxDistance + radius,
        support.spawn[2] + support.maxDistance + radius,
      ] as Point,
    };
    if (world.bounds) {
      for (let axis = 0; axis < 2; axis++) {
        sourceScope.min[axis] = Math.max(sourceScope.min[axis], world.bounds.min[axis]);
        sourceScope.max[axis] = Math.min(sourceScope.max[axis], world.bounds.max[axis]);
      }
    }
    if (sourceScope.min.some((value, axis) => value > sourceScope.max[axis])) {
      outcome(support.id, 'activity-range-outside-collision-scope');
      continue;
    }
    // Only source activity ranges near this puzzle can contribute placements.
    // Far bodies still remain in definitions and therefore retain their collision.
    const nearby = arrivals.some((start) => {
      const delta = vector((k) => goal[k] - start.position[k]);
      const squared = delta.reduce((sum, v) => sum + v * v, 0);
      const t = squared
        ? Math.max(
            0,
            Math.min(
              1,
              delta.reduce((sum, v, k) => sum + v * (support.spawn[k] - start.position[k]), 0) /
                squared,
            ),
          )
        : 0;
      return (
        distance(
          support.spawn,
          vector((k) => start.position[k] + t * delta[k]),
        ) <=
        support.maxDistance +
          radius +
          Math.max(jump.maxHorizontalDistance, jump.maxDrop, jump.model.maxJumpHeight)
      );
    });
    if (!nearby) {
      outcome(support.id, 'activity-range-outside-query-corridor');
      diagnostics.truncated = true;
      continue;
    }
    if (!insideScope(original, world.bounds ?? undefined)) {
      // Relocation needs source-body ownership evidence as well as target-space
      // coverage. A clipped original cannot be assumed absent from raw collision.
      outcome(support.id, 'original-body-outside-collision-scope');
      diagnostics.truncated = true;
      continue;
    }
    const supportTriangles = trianglesOf(terrain, world.trianglesInBounds?.(sourceScope));
    const sourceCollision = support.bodies.some((body) =>
      blockedBody(body, supportBounds([body]).min[1], supportTriangles),
    );
    const staticWorld = world;
    const anchors: Vec3[] = [[support.spawn[0], original.min[1], support.spawn[2]]];
    // Relay boxes can be useful before the final goal's neighbourhood. Probe
    // the approach corridor, but retain each box's own source activity sphere.
    for (const start of definitions.length > 1 ? arrivals : []) {
      const steps = Math.min(
        maxPlacements,
        Math.max(
          1,
          Math.ceil(
            distance(start.position, goal) /
              Math.max(build.cellSize, jump.maxHorizontalDistance / 2),
          ),
        ),
      );
      for (let i = 0; i <= steps; i++) {
        const p = vector((k) => start.position[k] + ((goal[k] - start.position[k]) * i) / steps);
        if (distance(p, support.spawn) > support.maxDistance + radius) continue;
        for (const hit of bounded(projectNearby(p, support.maxDistance, radius + build.cellSize))) {
          anchors.push(hit.position);
          const face = surfaceById.get(hit.surface);
          if (face)
            anchors.push(
              vector((k) => face.vertices.reduce((sum, v) => sum + v[k], 0) / face.vertices.length),
            );
        }
      }
    }
    const reach = jump.maxHorizontalDistance + radius + (jump.interaction?.radius ?? 0);
    for (const hit of bounded(
      project(goal, {
        maxVertical: support.maxDistance + Math.abs(bottomOffset),
        interaction: { radius: reach, maxVertical: support.maxDistance + Math.abs(bottomOffset) },
      }),
    )) {
      anchors.push(hit.position);
      const surface = surfaceById.get(hit.surface)!;
      for (const [i, a] of surface.vertices.entries()) {
        const b = surface.vertices[(i + 1) % surface.vertices.length];
        const dx = b[0] - a[0],
          dz = b[2] - a[2],
          squared = dx * dx + dz * dz;
        if (!squared) {
          continue;
        }
        const t = Math.max(
          0,
          Math.min(1, ((goal[0] - a[0]) * dx + (goal[2] - a[2]) * dz) / squared),
        );
        const clearance = radius + jump.profile.radius + build.cellSize * 2;
        for (const sign of [-1, 1]) {
          const anchor: Vec3 = [
            a[0] + t * dx + ((sign * dz) / Math.sqrt(squared)) * clearance,
            a[1] + t * (b[1] - a[1]),
            a[2] + t * dz - ((sign * dx) / Math.sqrt(squared)) * clearance,
          ];
          for (const nearby of projectNearby(anchor, support.maxDistance, build.cellSize))
            anchors.push(nearby.position);
        }
      }
    }
    const candidates: { position: Vec3; floor: number }[] = [];
    const steps: typeof candidates = [];
    const ordinaryCount = anchors.length;
    if (jump.interaction && original.max[1] - original.min[1] <= jump.model.maxJumpHeight) {
      // Sample floors around the goal at box-roof height. Goal projection alone
      // often returns the raised platform and misses the lower approach.
      const floorHeight = goal[1] - (original.max[1] - original.min[1]);
      for (let x = -7; x <= 7; x++) {
        for (let z = -7; z <= 7; z++) {
          const hits = project([goal[0] + x, floorHeight, goal[2] + z], {
            maxVertical: jump.model.maxJumpHeight + 2,
          });
          for (const hit of hits.slice(0, 2)) anchors.push(hit.position);
        }
      }
    }
    for (const [index, anchor] of anchors.entries()) {
      if (!insideScope(supportBounds([[anchor]]), world.bounds ?? undefined)) {
        continue;
      }
      const ground = staticWorld.groundAt(anchor, {
        maxUp: build.cellHeight * 3,
        maxDown: build.cellHeight * 3,
        maxSlope: build.maxSlope,
      });
      if (!ground) {
        continue;
      }
      const position: Vec3 = [
        ground.position[0],
        ground.position[1] - bottomOffset,
        ground.position[2],
      ];
      if (distance(position, support.spawn) > support.maxDistance) {
        outcome(support.id, 'placement-outside-activity-range', position);
        continue;
      }
      const delta = vector((axis) => position[axis] - support.spawn[axis]);
      const candidateBodies = support.bodies.map((body) => body.map((p) => shifted(p, delta)));
      {
        // Remove individually impossible poses before spending a route trial. Do not
        // test against other boxes here: their final poses may change jointly.
        const bounds = supportBounds(candidateBodies);
        const initial = distance(position, support.spawn) < 1e-5;
        const local = trianglesOf(
          terrain,
          world.trianglesInBounds?.({
            min: [bounds.min[0], bounds.min[2]],
            max: [bounds.max[0], bounds.max[2]],
          }),
        );
        const obstacles = initial
          ? local.filter((triangle) => !candidateBodies.some((body) => onBoxFace(triangle, body)))
          : local;
        let reason: string | undefined;
        if (!insideScope(bounds, world.bounds ?? undefined))
          reason = 'placement-outside-collision-scope';
        else if (!initial && sourceCollision) reason = 'source-collision-ownership-unresolved';
        else if (jump.walls.some((wall) => wall.state !== 'inactive' && overlaps(bounds, wall)))
          reason = 'placement-intersects-exclusion';
        else if (
          candidateBodies.some(
            (body) =>
              !flatSupport(footprintOf(body, ground.position[1]), ground.position[1], local),
          )
        )
          reason = 'placement-base-unsupported';
        else if (candidateBodies.some((body) => blockedBody(body, ground.position[1], obstacles)))
          reason = 'placement-collision-blocked';
        if (reason) {
          outcome(support.id, reason, position);
          continue;
        }
      }
      if (
        !jump.interaction &&
        createWallChecker(
          candidateBodies.map((body) => bodyWall(supportBounds([body]))),
          jump.profile,
        )(goal, goal)
      ) {
        outcome(support.id, 'placement-blocks-goal', position);
        continue;
      }
      const list = index < ordinaryCount ? candidates : steps;
      if (list.some((other) => distance(position, other.position) < build.cellSize)) {
        continue;
      }
      list.push({ position, floor: ground.position[1] });
    }
    candidates.sort((a, b) => distance(a.position, goal) - distance(b.position, goal));
    const initialIndex = candidates.findIndex(
      ({ position }) => distance(position, support.spawn) < 1e-5,
    );
    if (initialIndex > 0) {
      candidates.unshift(candidates.splice(initialIndex, 1)[0]);
    }
    if (steps.length) {
      steps.push(
        ...candidates.filter(
          (p) => !steps.some((q) => distance(p.position, q.position) < build.cellSize),
        ),
      );
      const rank = (p: (typeof steps)[number]) => {
        const roof: Vec3 = [
          p.position[0],
          p.floor + original.max[1] - original.min[1],
          p.position[2],
        ];
        const inGoal = findGoalHit([roof, roof], goal, jump.interaction!);
        return (
          distance(roof, goal) + (inGoal ? 0 : 10) + 0.015 * distance(roof, arrivals[0].position)
        );
      };
      // A box already standing on the upper floor cannot be the step up to it.
      // Check the clearance above the proposed roof before spending a layout bake.
      for (let i = steps.length - 1; i >= 0; i--) {
        const pose = steps[i];
        const feet: Vec3 = [
          pose.position[0],
          pose.floor + original.max[1] - original.min[1] + 0.01,
          pose.position[2],
        ];
        if (
          (pose.floor >= goal[1] && !findGoalHit([feet, feet], goal, jump.interaction!)) ||
          world.sweepCapsule(feet, feet, jump.profile)
        )
          steps.splice(i, 1);
      }
      steps.sort((a, b) => rank(a) - rank(b));
    }
    if (candidates.length || steps.length)
      choices.push({ support, original, supportTriangles, sourceCollision, candidates, steps });
  }
  type Pick = { choice: (typeof choices)[number]; position: Vec3; floor: number };
  choices.sort(
    (a, b) =>
      distance(a.support.spawn, goal) - distance(b.support.spawn, goal) ||
      a.support.id.localeCompare(b.support.id),
  );
  const stepChoices = choices
    .filter((c) => c.steps.length)
    .sort(
      (a, b) => a.original.max[1] - a.original.min[1] - (b.original.max[1] - b.original.min[1]),
    );
  const ordinary = choices.filter((c) => c.candidates.length);
  function* subsets(
    count: number,
    offset = 0,
    prefix: typeof choices = [],
  ): Generator<typeof choices> {
    if (!count) {
      yield prefix;
      return;
    }
    for (let i = offset; i <= ordinary.length - count; i++)
      yield* subsets(count - 1, i + 1, [...prefix, ordinary[i]]);
  }
  function* poses(group: typeof choices): Generator<Pick[]> {
    const queue = [group.map(() => 0)],
      seen = new Set([queue[0].join(',')]);
    for (let head = 0; head < queue.length; head++) {
      const indices = queue[head];
      yield group.map((choice, i) => ({ choice, ...choice.candidates[indices[i]] }));
      for (let i = 0; i < group.length; i++) {
        if (indices[i] + 1 >= group[i].candidates.length) continue;
        const next = [...indices];
        next[i]++;
        const key = next.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          queue.push(next);
        }
      }
    }
  }
  function* layouts(count: number, allowance: number): Generator<Pick[]> {
    // Balance exploration of nearby subsets with changing their candidate poses.
    // Diagonal pose enumeration prevents one box's long candidate list from
    // monopolizing a pair; round-robin subsets avoid source-array ownership.
    const groups = subsets(count),
      active: Generator<Pick[]>[] = [];
    const width = Math.max(1, Math.ceil(Math.sqrt(allowance)));
    let exhausted = false;
    while (true) {
      while (!exhausted && active.length < width) {
        const next = groups.next();
        if (next.done) exhausted = true;
        else active.push(poses(next.value));
      }
      if (!active.length) return;
      for (let i = 0; i < active.length;) {
        const next = active[i].next();
        if (next.done) active.splice(i, 1);
        else {
          yield next.value;
          i++;
        }
      }
    }
  }
  // A roof depends on its local collision neighbourhood, not on distant box poses.
  // Keep exact local geometry in the key so neighbouring moved bodies still force
  // a fresh bake; the cache belongs only to this immutable terrain/build query.
  const roofCache = new Map<string, Surface[]>();
  // Reserve trials for each layout size: single-box misses must not consume the
  // entire allowance before a joint configuration can be considered.
  const depth = Math.min(ordinary.length, maxPlacements);
  diagnostics.truncated ||= depth < ordinary.length;
  function* stepLayouts(): Generator<Pick[]> {
    const limit = Math.min(32, maxPlacements);
    for (let index = 0; diagnostics.stepPlacements < limit; index++) {
      let found = false;
      for (const choice of stepChoices) {
        const pose = choice.steps[index];
        if (!pose) continue;
        found = true;
        diagnostics.stepPlacements++;
        yield [{ choice, ...pose }];
        if (diagnostics.stepPlacements >= limit || best.route.status === 'complete') return;
      }
      if (!found) break;
    }
  }
  function* ordinaryLayouts(): Generator<Pick[]> {
    for (let count = 1; count <= depth; count++) {
      const allowance = Math.floor((maxPlacements - diagnostics.placements) / (depth - count + 1));
      let spent = 0;
      for (const layout of layouts(count, allowance)) {
        if (spent >= allowance) {
          diagnostics.truncated = true;
          break;
        }
        spent++;
        diagnostics.placements++;
        yield layout;
      }
    }
  }
  for (const stepping of [true, false]) {
    for (const layout of stepping ? stepLayouts() : ordinaryLayouts()) {
      // Honor cooperative request deadlines between box layouts so slow multi-box
      // evaluations cannot run past the query cutoff without yielding.
      await checkpoint?.();
      onProgress?.({
        phase: stepping ? 'following-step-placement' : 'following-placement',
        completed: stepping ? diagnostics.stepPlacements : diagnostics.placements,
        total: stepping ? Math.min(32, maxPlacements) : maxPlacements,
      });
      const selected = layout.map(({ choice, position, floor }) => {
        const delta = vector((axis) => position[axis] - choice.support.spawn[axis]);
        const bodies = choice.support.bodies.map((body) =>
          body.map((point) => shifted(point, delta)),
        );
        return { ...choice, position, floor, bodies, bounds: supportBounds(bodies) };
      });
      const selectedIds = new Set(selected.map((p) => p.support.id));
      const fixed = definitions.filter((d) => !selectedIds.has(d.support.id));
      const otherBodies = fixed.map((d) => corners(d.bounds));
      const bodies = [...otherBodies, ...selected.flatMap((p) => p.bodies)];
      const allBounds = [
        ...fixed.map((d) => ({ id: d.support.id, bounds: d.bounds })),
        ...selected.map((p) => ({ id: p.support.id, bounds: p.bounds })),
      ];
      let rejected = false;
      for (const placed of selected) {
        const { support, position, floor, bounds } = placed;
        const initial = distance(position, support.spawn) < 1e-5;
        let reason: string | undefined;
        if (distance(position, support.spawn) > support.maxDistance)
          reason = 'placement-outside-activity-range';
        else if (!initial && placed.sourceCollision)
          reason = 'source-collision-ownership-unresolved';
        else if (!insideScope(bounds, world.bounds ?? undefined))
          reason = 'placement-outside-collision-scope';
        else if (jump.walls.some((w) => w.state !== 'inactive' && overlaps(bounds, w)))
          reason = 'placement-intersects-exclusion';
        else if (
          placed.bodies.some(
            (body) => !flatSupport(footprintOf(body, floor), floor, placed.supportTriangles),
          )
        )
          reason = 'placement-base-unsupported';
        else if (
          allBounds.some(
            (other) =>
              other.id !== support.id &&
              bounds.min.every(
                (v, axis) =>
                  Math.min(bounds.max[axis], other.bounds.max[axis]) -
                    Math.max(v, other.bounds.min[axis]) >
                  1e-5,
              ),
          )
        )
          reason = 'placement-collision-blocked';
        else {
          const obstacles = initial
            ? placed.supportTriangles.filter(
                (triangle) => !placed.bodies.some((body) => onBoxFace(triangle, body)),
              )
            : placed.supportTriangles;
          if (placed.bodies.some((body) => blockedBody(body, floor, obstacles)))
            reason = 'placement-collision-blocked';
        }
        if (reason) {
          outcome(support.id, reason, position);
          rejected = true;
          break;
        }
      }
      if (rejected) continue;
      const placedWorld = addBodies(world, bodies);
      const placedWalls = [...jump.walls, ...bodies.map((body) => bodyWall(supportBounds([body])))];
      const blocked = createWallChecker(placedWalls, jump.profile);
      if (!jump.interaction && blocked(goal, goal)) {
        outcome('', 'placement-blocks-goal');
        continue;
      }
      const usableStarts = arrivals.filter((start) => {
        const feet = shifted(start.position, [0, 0.01, 0]);
        return (
          insideScope(
            {
              min: [feet[0] - jump.profile.radius, feet[1], feet[2] - jump.profile.radius],
              max: [
                feet[0] + jump.profile.radius,
                feet[1] + jump.profile.height,
                feet[2] + jump.profile.radius,
              ],
            },
            world.bounds ?? undefined,
          ) &&
          !blocked(start.position, start.position) &&
          !placedWorld.sweepCapsule(feet, feet, jump.profile)
        );
      });
      if (!usableStarts.length) {
        outcome('', 'placement-blocks-all-starts');
        continue;
      }
      const roofs: Surface[] = [];
      const padding = jump.profile.radius + build.cellSize * 4;
      for (const placed of selected) {
        const bounds: NonNullable<BuildOptions['bounds']> = {
          min: [placed.bounds.min[0] - padding, placed.bounds.min[2] - padding],
          max: [placed.bounds.max[0] + padding, placed.bounds.max[2] + padding],
        };
        if (build.bounds)
          for (let axis = 0; axis < 2; axis++) {
            bounds.min[axis] = Math.max(bounds.min[axis], build.bounds.min[axis]);
            bounds.max[axis] = Math.min(bounds.max[axis], build.bounds.max[axis]);
          }
        if (bounds.min.some((v, axis) => v >= bounds.max[axis])) continue;
        const localBodies = bodies.filter((body) =>
          overlaps(supportBounds([body]), {
            min: [bounds.min[0], -Infinity, bounds.min[1]],
            max: [bounds.max[0], Infinity, bounds.max[1]],
          }),
        );
        const key = JSON.stringify([placed.support.id, placed.position, bounds, localBodies]);
        let baked = roofCache.get(key);
        if (!baked) {
          await checkpoint?.();
          const staticTriangles = trianglesOf(terrain, world.trianglesInBounds?.(bounds));
          baked = await buildGroundSurfaces(
            joinedGeometry(geometryOfTriangles(staticTriangles), localBodies),
            { ...build, bounds },
          );
          if (roofCache.size >= 256) roofCache.delete(roofCache.keys().next().value!);
          roofCache.set(key, baked);
        }
        roofs.push(
          ...baked
            .filter((surface) =>
              placed.bodies.some((body) => {
                const top = Math.max(...body.map((p) => p[1]));
                return surface.vertices.every(
                  (p) => Math.abs(p[1] - top) <= build.cellHeight * 3 && roofContains(body, p),
                );
              }),
            )
            .map((surface, index) => ({
              ...surface,
              id: `following/${placed.support.id}/${index}`,
            })),
        );
      }
      if (!roofs.length) {
        outcome('', 'placed-roof-unmapped');
        continue;
      }
      const layoutSurfaces = [...surfaces, ...roofs];
      const settings = {
        ...jump,
        groundPlanner: undefined,
        connections: compatibleConnections(jump.connections ?? [], bodies, jump),
        walls: placedWalls,
        maxCandidates: perPlacement,
        maxShortcutCandidates: 0,
      };
      const search = () => {
        if (!stepping)
          return planJumpRoute(layoutSurfaces, placedWorld, usableStarts, goal, settings);
        const links = roofSteps(
          roofs,
          selected[0].bounds,
          selected[0].floor,
          placedWorld,
          project,
          combineGoalProjectors(project, createGoalProjector(roofs)),
          surfaceById,
          goal,
          { ...settings, maxCandidates: jump.maxCandidates },
        );
        const connections = [...settings.connections, ...links];
        const route: Route = links.length
          ? createGroundPlanner(layoutSurfaces, settings).plan(usableStarts, goal, {
              interaction: jump.interaction,
              connections,
            })
          : { status: 'no-verified-route' };
        return { route, connections, diagnostics: { truncated: true } };
      };
      const result = search();
      diagnostics.truncated ||= Boolean(
        result.diagnostics.truncated ||
        result.route.search?.truncated ||
        (result.route.status === 'complete' && result.route.locomotion?.search?.truncated),
      );
      if (result.route.status !== 'complete') {
        for (const p of selected) outcome(p.support.id, 'placed-box-route-unavailable', p.position);
        continue;
      }
      const points = result.route.segments.flatMap((segment) =>
        segment.mode === 'walk' ? segment.points : [segment.points[0], segment.points.at(-1)!],
      );
      const used = selected.filter((placed) => {
        const project = createGoalProjector(
          roofs.filter((r) => r.id.startsWith(`following/${placed.support.id}/`)),
        );
        return points.some((p) => project(p, { maxVertical: build.cellHeight * 3 }).length);
      });
      const route = jump.locomotion
        ? retimeGroundRoute(result.route, jump.locomotion)
        : result.route;
      diagnostics.truncated ||= Boolean(
        route.search?.truncated ||
        (route.status === 'complete' && route.locomotion?.search?.truncated),
      );
      if (route.status !== 'complete') {
        outcome('', 'placement-resource-infeasible');
        continue;
      }
      for (const p of selected)
        outcome(
          p.support.id,
          distance(p.position, p.support.spawn) < 1e-5 ? 'accepted-initial-pose' : 'accepted',
          p.position,
        );
      if (best.route.status !== 'complete' || route.cost < best.route.cost) {
        best = {
          // Every selected pose is part of the joint collision snapshot, even when
          // a moved box clears a path without being used as a stepping surface.
          route: {
            ...route,
            placements: selected.map((p) => ({ device: p.support.id, position: p.position })),
          },
          connections: result.connections,
          supportBoxes: used.map((p) => ({
            device: p.support.id,
            family: 'following-box',
            role: 'use',
            ...p.bounds,
          })),
          diagnostics,
        };
        if (stepping) {
          if (firstFeasible) return best;
          await onCandidate?.(best);
        }
      }
    }
  }
  return best;
};
