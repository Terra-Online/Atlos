import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import { findGoalHit, type GoalProjector } from '#@/src/model/goals.ts';
import { createPhysicalWorld, type PreparedBase } from '#@/src/model/world.ts';
import type { GroundConnection, Route } from '#@/src/route.ts';
import type { PhysicalInput, SweptSupport } from '#@/src/solver/physical.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';
import { routeFrom, type Graph } from '#@/src/v1/route/routes.ts';
import type { SourceFace } from '#@/src/v1/solver/physical/moving-ground.ts';
import {
  createMovingRouteAnnotator,
  faceInterval,
  type SupportBox,
} from '#@/src/v1/solver/physical/moving-route.ts';
import type { PhysicalQuery } from '#@/src/v1/solver/physical/solve.ts';

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

// Pose bounds alone cannot distinguish rotation from translation. Require every
// retained cap vertex of every body to have the same translated counterpart.
const translating = (support: SweptSupport, from: number, to: number): Vec3 | null => {
  const a = support.poses?.[from],
    b = support.poses?.[to];
  if (!a || !b || support.family === 'seesaw' || support.circular) return null;
  const delta = b.min.map((v, i) => v - a.min[i]) as Vec3;
  if (delta.some((v, i) => !Number.isFinite(v) || Math.abs(b.max[i] - a.max[i] - v) > 1e-5))
    return null;
  const caps = (pose: number) => {
    const bodies = new Map<number, Vec3[]>();
    for (const [i, surface] of support.surfaces.entries())
      for (const span of support.surfacePoses?.[i] ?? [])
        if (span.fromPose === pose && span.toPose === pose)
          bodies.set(span.body, [...(bodies.get(span.body) ?? []), ...surface.vertices]);
    return bodies;
  };
  const first = caps(from),
    last = caps(to);
  if (!first.size || first.size !== last.size) return null;
  for (const [body, vertices] of first) {
    const other = last.get(body);
    if (
      !other ||
      vertices.some(
        (p) => !other.some((q) => p.every((v, i) => Math.abs(v + delta[i] - q[i]) <= 1e-5)),
      ) ||
      other.some(
        (q) => !vertices.some((p) => p.every((v, i) => Math.abs(v + delta[i] - q[i]) <= 1e-5)),
      )
    )
      return null;
  }
  return delta;
};

const walkingPoses = (support: SweptSupport, start: Vec3, target: Vec3) => {
  const candidates: { surface: Surface; box?: SupportBox }[] = [];
  const seen = new Set<string>();
  for (const [index, surface] of support.surfaces.entries()) {
    for (const span of support.surfacePoses?.[index] ?? []) {
      if (span.fromPose === span.toPose) {
        candidates.push({ surface });
        continue;
      }
      const key = `${span.body}/${span.fromPose}/${span.toPose}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const delta = translating(support, span.fromPose, span.toPose);
      if (!delta) continue;
      for (const [capIndex, cap] of support.surfaces.entries()) {
        if (
          !support.surfacePoses?.[capIndex]?.some(
            (s) =>
              s.body === span.body && s.fromPose === span.fromPose && s.toPose === span.fromPose,
          )
        )
          continue;
        const intervals = [start, target].map((p) =>
          faceInterval(p, p.map((v, i) => v - delta[i]) as Vec3, cap, 1e-6),
        );
        if (!intervals[0] || !intervals[1]) continue;
        const low = Math.max(intervals[0][0], intervals[1][0]),
          high = Math.min(intervals[0][1], intervals[1][1]);
        if (low > high) continue;
        const t = (low + high) / 2,
          pose = support.poses![span.fromPose];
        const shift = (p: Vec3) => p.map((v, i) => v + delta[i] * t) as Vec3;
        candidates.push({
          surface: { ...cap, vertices: cap.vertices.map(shift) },
          box: {
            device: support.id,
            family: support.family,
            role: 'use',
            min: shift(pose.min),
            max: shift(pose.max),
          },
        });
      }
    }
  }
  return candidates;
};

/** Retain provider transfers and walking wholly supported by one authored pose.
 * Navigation projections cannot add approaches or join distinct endpoints. */
export function prepareMovingDirect(
  input: PhysicalInput,
  prepared: PreparedBase,
  walls: Wall[],
  baseProject: GoalProjector,
) {
  const snapshot = createPhysicalWorld(
    { ...input, roundedWalls: walls },
    input.ground.build?.bounds && input.ground.tiles
      ? { bounds: input.ground.build.bounds, tiles: input.ground.tiles, tileSpan: physicalTileSpan }
      : 'complete',
    prepared,
  );
  const physical = snapshot.configured([]),
    profile = input.ground.options.profile;
  const graph: Graph = { nodes: [], edges: [] },
    nodes = new Map<string, Vec3>();
  const owners = new Map<string, Set<number>>();
  const connections: GroundConnection[] = [];
  const diagnostics = { nodes: 0, connections: 0, unsupportedEndpoints: 0, obstructedTransfers: 0 };
  const node = (point: Vec3, support: number) => {
    const id = JSON.stringify(point);
    if (!nodes.has(id)) {
      nodes.set(id, point);
      graph.nodes.push({ id, position: point });
    }
    const source = owners.get(id) ?? new Set<number>();
    source.add(support);
    owners.set(id, source);
    return id;
  };
  const endpoint = (support: SweptSupport, raw: Vec3, contactModel = physical): Vec3 | null => {
    const point: Vec3 = [raw[0], raw[1] + 0.01, raw[2]];
    if (!snapshot.covered(point, point)) return null;
    const feet = contactModel.standing(point),
      contact = contactModel.movingContact(support, point);
    return feet &&
      distance(feet, point) <= 1e-5 &&
      contact &&
      point[1] - contact.position[1] >= -1e-6 &&
      point[1] - contact.position[1] <= 0.01 + 1e-6
      ? point
      : null;
  };
  for (const [supportIndex, support] of (input.devices?.movingSupports ?? []).entries()) {
    if (support.circular || support.assumption !== 'phase-free-swept-support') continue;
    for (const [index, transfer] of support.transfers.entries()) {
      if (transfer.speed === null || !Number.isFinite(transfer.speed) || transfer.speed <= 0)
        continue;
      const a = endpoint(support, transfer.from),
        b = endpoint(support, transfer.to);
      if (!a || !b) {
        diagnostics.unsupportedEndpoints++;
        continue;
      }
      if (
        !snapshot.covered(a, b) ||
        physical.blocked(a, b) ||
        physical.world.sweepCapsule(a, b, profile)
      ) {
        diagnostics.obstructedTransfers++;
        continue;
      }
      const id = `moving-ride/${support.id}/${index}`,
        cost = distance(transfer.from, transfer.to) / transfer.speed;
      const from = node(a, supportIndex),
        to = node(b, supportIndex);
      // Existing phase-free rides expose the complete authored span both ways.
      for (const reverse of [false, true]) {
        const connection: GroundConnection = {
          id: id + (reverse ? '/reverse' : ''),
          state: 'open',
          mode: 'rope',
          traversal: 'moving-support',
          points: reverse ? [b, a] : [a, b],
          times: [0, cost],
          endpointTolerance: profile.radius,
        };
        connections.push(connection);
        graph.edges.push({
          from: reverse ? to : from,
          to: reverse ? from : to,
          ...connection,
          cost,
          connection: connection.id,
        });
      }
    }
  }
  diagnostics.nodes = graph.nodes.length;
  diagnostics.connections = connections.length;
  const supports = input.devices?.movingSupports ?? [];
  const sourceFaces = new Map<string, SourceFace[]>();
  for (const [index, support] of supports.entries())
    for (const [surfaceIndex, surface] of support.surfaces.entries())
      sourceFaces.set(surface.id, [{ support: index, surface: surfaceIndex }]);
  const selectedContact = (support: SweptSupport) =>
    createPhysicalWorld(
      {
        ...input,
        roundedWalls: walls,
        devices: { ...input.devices!, movingSupports: [support] },
      },
      input.ground.build?.bounds && input.ground.tiles
        ? {
            bounds: input.ground.build.bounds,
            tiles: input.ground.tiles,
            tileSpan: physicalTileSpan,
          }
        : 'complete',
      prepared,
    ).configured([]);
  const selectedPoses = new WeakMap<Route, SupportBox[]>();
  const annotateDefault = createMovingRouteAnnotator({
    supports,
    surfaces: supports.flatMap((s) => s.surfaces),
    baseSurfaces: input.ground.surfaces,
    baseProject,
    sourceFaces,
    tolerance: (input.ground.build?.cellHeight ?? 0.1) * 3,
  });
  return {
    diagnostics,
    annotate: (route: Route, connections: GroundConnection[]) =>
      selectedPoses.get(route) ?? annotateDefault(route, connections),
    plan(
      request: PhysicalQuery,
      sources?: ReadonlySet<number>,
    ): { route: Route; connections: GroundConnection[] } {
      if (request.arrival.state !== 'available' || request.interaction?.airborne)
        return { route: { status: 'unmapped' }, connections: [] };
      const start = request.arrival,
        settling = Math.max(0.5, input.movement.stepDown + (input.ground.build?.cellHeight ?? 0));
      const range = start.groundRange ?? [start.position[1] - settling, start.position[1] + 0.5];
      let walking: Route = { status: 'unmapped' };
      let localConnections: GroundConnection[] = [];
      for (const [supportIndex, support] of supports.entries()) {
        if (sources && !sources.has(supportIndex)) continue;
        if (support.circular || support.assumption !== 'phase-free-swept-support') continue;
        for (const { surface, box } of walkingPoses(support, start.position, request.target)) {
          const from = projectPoint([surface], start.position, {
            maxVertical: Math.max(...range.map((h) => Math.abs(h - start.position[1]))),
          });
          const to = projectPoint([surface], request.target, {
            maxVertical: request.interaction?.maxVertical ?? 0.02,
          });
          if (!from || !to || from.position[1] < range[0] || from.position[1] > range[1]) continue;
          const a: Vec3 = [from.position[0], from.position[1] + 0.01, from.position[2]],
            b: Vec3 = [to.position[0], to.position[1] + 0.01, to.position[2]];
          // Recheck an interpolated candidate against only its selected cap.
          // A neighbouring alternative pose must not lift any part of the walk.
          const contact = box
            ? selectedContact({ ...support, surfaces: [surface], transfers: [] })
            : physical;
          const trace = snapshot.covered(a, b) && contact.walkTrace(a, b);
          if (
            !trace ||
            (request.interaction
              ? !findGoalHit([trace.at(-1)!, trace.at(-1)!], request.target, request.interaction)
              : distance(trace.at(-1)!, request.target) > 0.02)
          )
            continue;
          const candidate = routeFrom(
            {
              nodes: [
                { id: 'from', position: trace[0] },
                { id: 'to', position: trace.at(-1)! },
              ],
              edges: [
                {
                  from: 'from',
                  to: 'to',
                  state: 'open',
                  mode: 'walk',
                  points: trace,
                  cost:
                    trace.reduce(
                      (length, p, i) => length + (i ? distance(trace[i - 1], p) : 0),
                      0,
                    ) / input.ground.options.speed,
                },
              ],
            },
            [{ ...start, node: 'from' }],
            'to',
            { walls, profile, locomotion: input.locomotion },
          );
          if (
            candidate.status === 'complete' &&
            (walking.status !== 'complete' || candidate.cost < walking.cost)
          ) {
            walking = candidate;
            if (box) selectedPoses.set(candidate, [box]);
          }
        }
      }
      // The authored initial cap may be below an independently supported source.
      // Board only a proved translating pose inside the original height band,
      // then charge the remaining authored displacement at its original speed.
      const projected = baseProject(start.position, {
        maxVertical: Math.max(...range.map((height) => Math.abs(height - start.position[1]))),
      }).filter(
        ({ position: p }) =>
          p[0] === start.position[0] &&
          p[2] === start.position[2] &&
          p[1] >= range[0] &&
          p[1] <= range[1],
      );
      const visited = new Set<string>();
      for (const [supportIndex, support] of supports.entries()) {
        if (sources && !sources.has(supportIndex)) continue;
        if (support.assumption !== 'phase-free-swept-support' || support.circular) continue;
        for (const [index, transfer] of support.transfers.entries()) {
          if (
            transfer.speed === null ||
            !Number.isFinite(transfer.speed) ||
            transfer.speed <= 0 ||
            transfer.body === undefined ||
            transfer.fromPose === undefined ||
            transfer.toPose === undefined
          )
            continue;
          for (const reverse of [false, true]) {
            const fromPose = reverse ? transfer.toPose : transfer.fromPose;
            const toPose = reverse ? transfer.fromPose : transfer.toPose;
            const delta = translating(support, fromPose, toPose);
            if (!delta) continue;
            const caps = support.surfaces.filter((_surface, i) =>
              support.surfacePoses?.[i]?.some(
                (span) => span.fromPose === fromPose && span.toPose === fromPose,
              ),
            );
            const terminal = support.surfaces.filter((_surface, i) =>
              support.surfacePoses?.[i]?.some(
                (span) => span.fromPose === toPose && span.toPose === toPose,
              ),
            );
            for (const cap of caps) {
              const capIndex = support.surfaces.indexOf(cap);
              if (
                !support.surfacePoses?.[capIndex]?.some(
                  (span) =>
                    span.body === transfer.body &&
                    span.fromPose === fromPose &&
                    span.toPose === fromPose,
                )
              )
                continue;
              for (const { position: feet } of projected) {
                const raw: Vec3 = [feet[0], feet[1] - 0.01, feet[2]];
                const interval = faceInterval(
                  raw,
                  raw.map((v, i) => v - delta[i]) as Vec3,
                  cap,
                  1e-6,
                );
                if (!interval) continue;
                const fraction = (interval[0] + interval[1]) / 2;
                if (fraction <= 0 || fraction >= 1) continue;
                const key = JSON.stringify([supportIndex, index, reverse, feet, fraction]);
                if (visited.has(key)) continue;
                visited.add(key);
                const end = feet.map((v, i) => v + delta[i] * (1 - fraction)) as Vec3;
                if (
                  request.interaction
                    ? !findGoalHit([end, end], request.target, request.interaction)
                    : distance(end, request.target) > 1e-6
                )
                  continue;
                const shift = (p: Vec3) => p.map((v, i) => v + delta[i] * fraction) as Vec3;
                const selected: SweptSupport = {
                  ...support,
                  surfaces: [
                    ...caps.map((surface) => ({
                      ...surface,
                      vertices: surface.vertices.map(shift),
                    })),
                    ...terminal,
                  ],
                  transfers: [],
                };
                const contact = selectedContact(selected);
                const a = endpoint(selected, raw, contact);
                const b = endpoint(selected, [end[0], end[1] - 0.01, end[2]], contact);
                if (
                  !a ||
                  !b ||
                  !snapshot.covered(a, b) ||
                  contact.blocked(a, b) ||
                  contact.world.sweepCapsule(a, b, profile)
                )
                  continue;
                const cost = distance(a, b) / transfer.speed;
                const connection: GroundConnection = {
                  id: `moving-ride/${support.id}/${index}/partial${reverse ? '/reverse' : ''}`,
                  state: 'open',
                  mode: 'rope',
                  traversal: 'moving-support',
                  points: [a, b],
                  times: [0, cost],
                  endpointTolerance: profile.radius,
                };
                const candidate = routeFrom(
                  {
                    nodes: [
                      { id: 'from', position: a },
                      { id: 'to', position: b },
                    ],
                    edges: [
                      { ...connection, from: 'from', to: 'to', cost, connection: connection.id },
                    ],
                  },
                  [{ ...start, node: 'from' }],
                  'to',
                  { walls, profile, locomotion: input.locomotion },
                );
                if (
                  candidate.status !== 'complete' ||
                  (walking.status === 'complete' && candidate.cost >= walking.cost)
                )
                  continue;
                walking = candidate;
                localConnections = [connection];
                selectedPoses.set(candidate, [
                  {
                    device: support.id,
                    family: support.family,
                    role: 'board',
                    min: shift(support.poses![fromPose].min),
                    max: shift(support.poses![fromPose].max),
                  },
                  {
                    device: support.id,
                    family: support.family,
                    role: 'leave',
                    ...support.poses![toPose],
                  },
                ]);
              }
            }
          }
        }
      }
      const arrivals = graph.nodes
        .filter(
          ({ position: p }) =>
            p[0] === start.position[0] &&
            p[2] === start.position[2] &&
            p[1] >= range[0] &&
            p[1] <= range[1],
        )
        .filter((n) => !sources || [...owners.get(n.id)!].some((owner) => sources.has(owner)))
        .sort((a, b) => {
          const delta =
            Math.abs(a.position[1] - start.position[1]) -
            Math.abs(b.position[1] - start.position[1]);
          const roundoff =
            32 *
            Number.EPSILON *
            Math.max(
              1,
              Math.abs(start.position[1]),
              Math.abs(a.position[1]),
              Math.abs(b.position[1]),
            );
          return Math.abs(delta) > roundoff
            ? delta
            : a.position[1] - b.position[1] || a.id.localeCompare(b.id);
        });
      const goals = graph.nodes
        .filter(({ position: p }) =>
          request.interaction
            ? findGoalHit([p, p], request.target, request.interaction)
            : distance(p, request.target) <= 1e-6,
        )
        .map((n) => n.id);
      if (!arrivals.length || !goals.length)
        return { route: walking, connections: localConnections };
      const route = routeFrom(graph, [{ ...start, node: arrivals[0].id }], goals, {
        walls,
        profile,
        locomotion: input.locomotion,
      });
      return walking.status === 'complete' &&
        (route.status !== 'complete' || walking.cost < route.cost)
        ? { route: walking, connections: localConnections }
        : { route, connections };
    },
  };
}
