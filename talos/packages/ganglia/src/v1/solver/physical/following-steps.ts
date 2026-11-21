import type { CollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { jumpConnection } from '#@/src/model/flight.ts';
import { closestOnSurface, createGoalProjector } from '#@/src/model/goals.ts';
import { vector } from '#@/src/model/placement.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { GroundConnection } from '#@/src/route.ts';
import type { PoseBounds } from '#@/src/solver/physical.ts';
import type { JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { standingFoot } from '#@/src/v1/search/traversal.ts';

type Foot = ReturnType<typeof standingFoot>;
type Projector = ReturnType<typeof createGoalProjector>;

/** Discover entries onto a placed roof and exits toward the interaction in the
 * same layout. Both feet and the swept arc are checked against its solids. */
export function roofSteps(
  roofs: Surface[],
  bounds: PoseBounds,
  floor: number,
  world: CollisionWorld,
  projectFloor: Projector,
  projectLayout: Projector,
  surfaceById: ReadonlyMap<string, Surface>,
  goal: Vec3,
  options: JumpRouteOptions,
) {
  const { profile, model, walls, maxVertical, maxSlope } = options;
  const blocked = createWallChecker(walls, profile);
  const foot = (hit: { position: Vec3; surface: string }) =>
    standingFoot(hit, world, { profile, maxVertical, maxSlope, blocked, project: projectLayout });
  const deck = roofs
    .map((surface) =>
      foot({
        surface: surface.id,
        position: vector(
          (k) => surface.vertices.reduce((sum, p) => sum + p[k], 0) / surface.vertices.length,
        ),
      }),
    )
    .filter((p) => !p.reason);
  const links: GroundConnection[] = [];
  const tested = new Set<string>();
  const usedIds = new Set(options.connections?.map((edge) => edge.id));
  let serial = 0;
  let remaining = options.maxCandidates;
  const connect = (from: Foot, to: Foot) => {
    if (
      from.reason ||
      to.reason ||
      from.surface === to.surface ||
      to.position[1] - from.position[1] > model.maxJumpHeight
    )
      return;
    const key = JSON.stringify([from.position, to.position]);
    if (tested.has(key) || remaining === 0) return;
    remaining--;
    tested.add(key);
    const arc = jumpConnection(from.position, to.position, {
      ...model,
      mode: 'jump',
      walls,
      wallCheck: blocked,
      profile,
      sweep: (a, b, body) => world.sweepCapsule(a, b, body),
      funnelWorld: world,
    });
    if (!arc) return;
    let peak = arc.peakHorizontalSpeed ?? 0;
    for (let i = 1; i < arc.points.length; i++) {
      const a = arc.points[i - 1],
        b = arc.points[i];
      peak = Math.max(
        peak,
        Math.hypot(b[0] - a[0], b[2] - a[2]) / (arc.times[i] - arc.times[i - 1]),
      );
    }
    let id: string;
    do {
      id = 'following-step/' + serial++;
    } while (usedIds.has(id));
    links.push({
      ...arc,
      id,
      state: 'open',
      fromSurface: from.surface,
      toSurface: to.surface,
      endpointTolerance: Math.min(maxVertical, profile.radius),
      ...(peak > options.runAirSpeed + 1e-7 ? { requiredGait: 'sprint' as const } : {}),
    });
  };
  const center = vector((k) => (bounds.min[k] + bounds.max[k]) / 2);
  const entryLimit = Math.min(50, Math.floor(options.maxCandidates / 2));
  entries: for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    for (const radius of [2, 3, 4.5]) {
      const at: Vec3 = [
        center[0] + radius * Math.cos(angle),
        floor,
        center[2] + radius * Math.sin(angle),
      ];
      const hit = projectFloor(at, { maxVertical: model.maxJumpHeight })[0];
      if (!hit) continue;
      const from = foot(hit);
      for (const to of deck) {
        if (links.length >= entryLimit) break entries;
        connect(from, to);
      }
    }
  }
  // A reachable roof can itself satisfy the interaction. Additional exits
  // are needed when a separate raised platform contains the admissible goal.
  const contacts = projectLayout(goal, { maxVertical, interaction: options.interaction }).slice(
    0,
    32,
  );
  const goals = contacts.map(foot);
  // A large platform can be walked after landing. Its edge nearest the box
  // can clear the lip even when a jump aimed at the interaction centre cannot.
  for (const hit of contacts) {
    const face = surfaceById.get(hit.surface);
    const edge = face && closestOnSurface(face, center);
    if (!edge) continue;
    const dx = hit.position[0] - edge.position[0],
      dz = hit.position[2] - edge.position[2];
    const span = Math.hypot(dx, dz);
    if (span <= profile.radius) continue;
    for (const inset of [profile.radius, 2 * profile.radius]) {
      const t = Math.min(1, inset / span);
      const point = vector((k) => edge.position[k] + (hit.position[k] - edge.position[k]) * t);
      goals.push(foot({ position: point, surface: hit.surface }));
    }
  }
  const limit = entryLimit + Math.min(24, options.maxCandidates - entryLimit);
  for (const from of deck)
    for (const to of goals) {
      if (links.length >= limit) return links;
      connect(from, to);
    }
  return links;
}
