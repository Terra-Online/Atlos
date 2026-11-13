import type { BuildOptions } from '#@/src/build.ts';
import type { CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Surface, Vec3 } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
/* oxlint-disable no-await-in-loop -- each bounded layout is baked and queried in isolation */
import { createGoalProjector } from '#@/src/model/goals.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { GroundArrival, GroundConnection, Route } from '#@/src/route.ts';
import type { FollowingSupport, PoseBounds } from '#@/src/solver/physical.ts';
import { buildGroundSurfaces } from '#@/src/v1/geo/build.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import type { SupportBox } from '#@/src/v1/solver/physical/moving-route.ts';
import { supportBounds } from '#@/src/v1/solver/physical/supports.ts';

type Point = [number, number];
type Diagnostics = {
  assumption: 'placement-within-activity-range';
  placements: number;
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

const vector = (component: (axis: number) => number): Vec3 => [
  component(0),
  component(1),
  component(2),
];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, axis) => v - b[axis]));
const shifted = (point: Vec3, delta: Vec3): Vec3 => vector((axis) => point[axis] + delta[axis]);
const corners = ({ min, max }: PoseBounds): Vec3[] =>
  Array.from({ length: 8 }, (_, bits): Vec3 =>
    vector((axis) => (bits & (1 << axis) ? max : min)[axis]),
  );
const flatCuboid = (body: Vec3[]) => {
  if (body.length !== 8) {
    return false;
  }
  const axes = [1, 2, 4].map((index) => vector((axis) => body[index][axis] - body[0][axis]));
  if (axes.some((axis) => Math.hypot(...axis) < 1e-5)) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (
        Math.abs(axes[i].reduce((sum, v, axis) => sum + v * axes[j][axis], 0)) >
        Math.hypot(...axes[i]) * Math.hypot(...axes[j]) * 1e-5
      ) {
        return false;
      }
    }
  }
  if (
    body.some(
      (point, bits) =>
        distance(
          point,
          vector(
            (axis) =>
              body[0][axis] +
              axes.reduce((sum, basis, index) => sum + (bits & (1 << index) ? basis[axis] : 0), 0),
          ),
        ) > 1e-5,
    )
  ) {
    return false;
  }
  const bounds = supportBounds([body]);
  return (
    body.filter((point) => Math.abs(point[1] - bounds.max[1]) < 1e-5).length === 4 &&
    body.filter((point) => Math.abs(point[1] - bounds.min[1]) < 1e-5).length === 4
  );
};
const footprintOf = (body: Vec3[], height: number) => {
  const roof = body.filter((p) => Math.abs(p[1] - height) < 1e-5);
  const center: Point = [
    roof.reduce((sum, p) => sum + p[0], 0) / 4,
    roof.reduce((sum, p) => sum + p[2], 0) / 4,
  ];
  roof.sort(
    (a, b) =>
      Math.atan2(a[2] - center[1], a[0] - center[0]) -
      Math.atan2(b[2] - center[1], b[0] - center[0]),
  );
  return roof.map((p): Point => [p[0], p[2]]);
};
const roofContains = (body: Vec3[], point: Vec3) => {
  const roof = footprintOf(body, Math.max(...body.map((p) => p[1])));
  return roof.every((a, i) => side(a, roof[(i + 1) % roof.length], [point[0], point[2]]) >= -1e-6);
};
const area = (polygon: Point[]) =>
  Math.abs(
    polygon.reduce((sum, a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) / 2;
const side = (a: Point, b: Point, p: Point) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const clip = (polygon: Point[], a: Point, b: Point, inside: boolean): Point[] => {
  const result: Point[] = [];
  for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length];
    const from = side(a, b, p),
      to = side(a, b, q);
    const keepP = inside ? from >= 0 : from <= 0;
    const keepQ = inside ? to >= 0 : to <= 0;
    if (keepP) {
      result.push(p);
    }
    if (keepP !== keepQ) {
      const t = from / (from - to);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
};
const trianglesOf = (
  geometry: CollisionGeometry,
  selected = Array.from({ length: geometry.indices.length / 3 }, (_, i) => i),
) =>
  selected.map((i) =>
    [0, 1, 2].map((j): Vec3 => {
      const vertex = geometry.indices[i * 3 + j];
      return [
        geometry.positions[vertex * 3],
        geometry.positions[vertex * 3 + 1],
        geometry.positions[vertex * 3 + 2],
      ];
    }),
  );

// polygon subtraction proves coverage of the complete footprint, including holes smaller
// than a sampling interval. duplicate and overlapping source triangles cannot add coverage twice.
const flatSupport = (footprint: Point[], height: number, triangles: Vec3[][]) => {
  let uncovered = [footprint];
  for (const triangle of triangles) {
    if (triangle.some((p) => Math.abs(p[1] - height) > 1e-5)) {
      continue;
    }
    const ring = triangle.map((p): Point => [p[0], p[2]]);
    // upward faces are clockwise in XZ; clipping uses the opposite winding.
    if (side(ring[0], ring[1], ring[2]) >= -1e-9) {
      continue;
    }
    ring.reverse();
    const next: Point[][] = [];
    for (const polygon of uncovered) {
      let remainder = polygon;
      for (let i = 0; i < 3 && remainder.length; i++) {
        const outside = clip(remainder, ring[i], ring[(i + 1) % 3], false);
        if (area(outside) > 1e-9) {
          next.push(outside);
        }
        remainder = clip(remainder, ring[i], ring[(i + 1) % 3], true);
      }
    }
    uncovered = next;
    if (!uncovered.length) {
      return true;
    }
    if (uncovered.length > 256) {
      return false;
    }
  }
  return false;
};
const overlaps = (a: PoseBounds, b: PoseBounds) =>
  a.min.every((v, axis) => v <= b.max[axis] && a.max[axis] >= b.min[axis]);
const blockedBody = (bounds: PoseBounds, floor: number, triangles: Vec3[][]) =>
  triangles.some((triangle) => {
    const other = supportBounds([triangle]);
    return other.max[1] > floor + 1e-5 && overlaps(bounds, other);
  });
const onBoxFace = (triangle: Vec3[], body: Vec3[]) => {
  const axes = [1, 2, 4].map((index) => vector((axis) => body[index][axis] - body[0][axis]));
  const coordinates = triangle.map((point) =>
    axes.map((basis) => {
      const squared = basis.reduce((sum, value) => sum + value * value, 0);
      return (
        basis.reduce((sum, value, axis) => sum + value * (point[axis] - body[0][axis]), 0) / squared
      );
    }),
  );
  return (
    coordinates.every((point) => point.every((value) => value >= -1e-5 && value <= 1 + 1e-5)) &&
    axes.some(
      (_, axis) =>
        coordinates.every((point) => Math.abs(point[axis]) < 1e-5) ||
        coordinates.every((point) => Math.abs(point[axis] - 1) < 1e-5),
    )
  );
};

const joinedGeometry = (terrain: CollisionGeometry, bodies: Vec3[][]): CollisionGeometry => {
  const positions = Array.from(terrain.positions),
    indices = Array.from(terrain.indices);
  for (const body of bodies) {
    const base = positions.length / 3;
    positions.push(...body.flat());
    const center = vector((axis) => body.reduce((sum, point) => sum + point[axis] / 8, 0));
    for (const face of [
      [0, 4, 6, 2],
      [1, 3, 7, 5],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 2, 3, 1],
      [4, 5, 7, 6],
    ]) {
      const [a, b, c] = face.map((i) => body[i]);
      const u = b.map((v, axis) => v - a[axis]),
        v = c.map((value, axis) => value - a[axis]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      if (normal.reduce((sum, value, axis) => sum + value * (a[axis] - center[axis]), 0) < 0) {
        face.reverse();
      }
      indices.push(
        base + face[0],
        base + face[1],
        base + face[2],
        base + face[0],
        base + face[2],
        base + face[3],
      );
    }
  }
  return { positions, indices };
};
const addBodies = (base: CollisionWorld, bodies: Vec3[][]): CollisionWorld => {
  const extra = createCollisionWorld(joinedGeometry({ positions: [], indices: [] }, bodies));
  return {
    bounds: base.bounds,
    trianglesInBounds: base.trianglesInBounds?.bind(base),
    sweepCapsule(a, b, profile) {
      return base.sweepCapsule(a, b, profile) ?? extra.sweepCapsule(a, b, profile);
    },
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
 * @returns a resource-feasible route for one assumed box placement, with its actual support bounds
 * @throws for invalid player build settings or a failed native bake
 */
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
  }: {
    surfaces: Surface[];
    build: BuildOptions;
    jump: JumpRouteOptions;
    onProgress?: (value: Record<string, unknown>) => void;
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
    try {
      definitions.push({ support, bounds: supportBounds(support.bodies) });
    } catch {
      outcome(support.id, 'invalid-box-obstacle-geometry');
      return best;
    }
  }
  const project = createGoalProjector(surfaces);
  for (const { support, bounds: original } of definitions) {
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
    const otherBounds = definitions
      .filter((other) => other.support !== support)
      .map((other) => other.bounds);
    const others = otherBounds.map(corners);
    const otherTriangles = trianglesOf(joinedGeometry({ positions: [], indices: [] }, others));
    const supportTriangles = trianglesOf(terrain, world.trianglesInBounds?.(sourceScope));
    const triangles = [...supportTriangles, ...otherTriangles];
    // enclosing other boxes blocks motion without granting invented AABB roof support.
    const staticWorld = others.length
      ? { ...addBodies(world, others), groundAt: world.groundAt.bind(world) }
      : world;
    const walls = [...jump.walls, ...others.map((body) => bodyWall(supportBounds([body])))];
    const sourceCollision = blockedBody(original, original.min[1], triangles);
    const anchors: Vec3[] = [[support.spawn[0], original.min[1], support.spawn[2]]];
    const reach = jump.maxHorizontalDistance + radius + (jump.interaction?.radius ?? 0);
    for (const hit of project(goal, {
      maxVertical: support.maxDistance + Math.abs(bottomOffset),
      interaction: { radius: reach, maxVertical: support.maxDistance + Math.abs(bottomOffset) },
    }).slice(0, maxPlacements)) {
      anchors.push(hit.position);
      const surface = surfaces.find((face) => face.id === hit.surface)!;
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
          for (const nearby of project(anchor, {
            maxVertical: support.maxDistance,
            interaction: {
              radius: Math.hypot(support.maxDistance, build.cellSize),
              maxVertical: support.maxDistance,
            },
          })) {
            if (
              Math.hypot(nearby.position[0] - anchor[0], nearby.position[2] - anchor[2]) <=
              build.cellSize
            ) {
              anchors.push(nearby.position);
            }
          }
        }
      }
    }
    const candidates: { position: Vec3; floor: number }[] = [];
    for (const anchor of anchors) {
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
      if (candidates.some((other) => distance(position, other.position) < build.cellSize)) {
        continue;
      }
      candidates.push({ position, floor: ground.position[1] });
    }
    candidates.sort((a, b) => distance(a.position, goal) - distance(b.position, goal));
    const initialIndex = candidates.findIndex(
      ({ position }) => distance(position, support.spawn) < 1e-5,
    );
    if (initialIndex > 0) {
      candidates.unshift(candidates.splice(initialIndex, 1)[0]);
    }
    for (const { position, floor } of candidates) {
      const delta = vector((axis) => position[axis] - support.spawn[axis]);
      const bodies = support.bodies.map((body) => body.map((point) => shifted(point, delta)));
      const placed = supportBounds(bodies);
      if (
        !jump.interaction &&
        createWallChecker(
          bodies.map((body) => bodyWall(supportBounds([body]))),
          jump.profile,
        )(goal, goal)
      ) {
        outcome(support.id, 'placement-blocks-goal', position);
        continue;
      }
      if (diagnostics.placements >= maxPlacements) {
        diagnostics.truncated = true;
        break;
      }
      diagnostics.placements++;
      onProgress?.({
        phase: 'following-placement',
        completed: diagnostics.placements,
        total: maxPlacements,
      });
      if (distance(position, support.spawn) > 1e-5 && sourceCollision) {
        outcome(support.id, 'source-collision-ownership-unresolved', position);
        continue;
      }
      if (!insideScope(placed, world.bounds ?? undefined)) {
        outcome(support.id, 'placement-outside-collision-scope', position);
        continue;
      }
      if (bodies.some((body) => !flatSupport(footprintOf(body, floor), floor, supportTriangles))) {
        outcome(support.id, 'placement-base-unsupported', position);
        continue;
      }
      const initial = distance(position, support.spawn) < 1e-5;
      if (
        otherBounds.some((other) =>
          placed.min.every(
            (value, axis) =>
              Math.min(placed.max[axis], other.max[axis]) - Math.max(value, other.min[axis]) > 1e-5,
          ),
        )
      ) {
        outcome(support.id, 'placement-collision-blocked', position);
        continue;
      }
      const obstacles = initial
        ? triangles.filter((triangle) => !bodies.some((body) => onBoxFace(triangle, body)))
        : triangles;
      if (blockedBody(placed, floor, obstacles)) {
        outcome(support.id, 'placement-collision-blocked', position);
        continue;
      }
      const placedWorld = addBodies(staticWorld, bodies);
      const placedWalls = [...walls, ...bodies.map((body) => bodyWall(supportBounds([body])))];
      const blocked = createWallChecker(placedWalls, jump.profile);
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
        outcome(support.id, 'placement-blocks-all-starts', position);
        continue;
      }
      const padding = jump.profile.radius + build.cellSize * 4;
      const localBounds = {
        min: [placed.min[0] - padding, placed.min[2] - padding] as Point,
        max: [placed.max[0] + padding, placed.max[2] + padding] as Point,
      };
      if (build.bounds) {
        for (let axis = 0; axis < 2; axis++) {
          localBounds.min[axis] = Math.max(localBounds.min[axis], build.bounds.min[axis]);
          localBounds.max[axis] = Math.min(localBounds.max[axis], build.bounds.max[axis]);
        }
      }
      if (localBounds.min.some((value, axis) => value >= localBounds.max[axis])) {
        outcome(support.id, 'placed-roof-outside-ground-build', position);
        continue;
      }
      const bakeTriangles = triangles.filter((triangle) =>
        overlaps(supportBounds([triangle]), {
          min: [localBounds.min[0], -Infinity, localBounds.min[1]],
          max: [localBounds.max[0], Infinity, localBounds.max[1]],
        }),
      );
      const baked = await buildGroundSurfaces(
        joinedGeometry(geometryOfTriangles(bakeTriangles), bodies),
        {
          ...build,
          bounds: localBounds,
        },
      );
      const roofs = baked
        .filter((surface) =>
          bodies.some((body) => {
            const top = Math.max(...body.map((p) => p[1]));
            return surface.vertices.every(
              (point) =>
                Math.abs(point[1] - top) <= build.cellHeight * 3 && roofContains(body, point),
            );
          }),
        )
        .map((surface, index): Surface => ({
          id: 'following/' + support.id + '/' + index,
          vertices: surface.vertices,
          portals: surface.portals,
        }));
      if (!roofs.length) {
        outcome(support.id, 'placed-roof-unmapped', position);
        continue;
      }
      // each search sees exactly one pose, with compatible known device actions.
      const result = planJumpRoute([...surfaces, ...roofs], placedWorld, usableStarts, goal, {
        ...jump,
        groundPlanner: undefined,
        connections: compatibleConnections(jump.connections ?? [], [...others, ...bodies], jump),
        walls: placedWalls,
        maxCandidates: perPlacement,
        maxShortcutCandidates: 0,
      });
      const roofProject = createGoalProjector(roofs);
      const usedRoof =
        result.route.status === 'complete' &&
        result.route.segments.some((segment) =>
          (segment.mode === 'walk'
            ? segment.points
            : [segment.points[0], segment.points.at(-1)!]
          ).some((point) => roofProject(point, { maxVertical: build.cellHeight * 3 }).length),
        );
      if (result.route.status !== 'complete' || !usedRoof) {
        outcome(support.id, 'placed-box-route-unavailable', position);
        continue;
      }
      const route = jump.locomotion
        ? retimeGroundRoute(result.route, jump.locomotion)
        : result.route;
      if (route.status !== 'complete') {
        outcome(support.id, 'placement-resource-infeasible', position);
        continue;
      }
      outcome(support.id, initial ? 'accepted-initial-pose' : 'accepted', position);
      if (best.route.status !== 'complete' || route.cost < best.route.cost) {
        best = {
          route,
          connections: result.connections,
          supportBoxes: [{ device: support.id, family: 'following-box', role: 'use', ...placed }],
          diagnostics,
        };
      }
    }
  }
  return best;
};
