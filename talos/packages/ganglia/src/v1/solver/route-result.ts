import type { LocomotionOptions } from '#@/src/movement.ts';
import type { Route, GroundArrival } from '#@/src/route.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';

type Complete = Extract<Route, { status: 'complete' }>;
const sameWitness = (a: unknown, b: unknown) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

/** Admit an already built authored entrance at the root query's original XZ.
 * A navigation-height join is not physical travel when the query permits this
 * standing projection. Never apply this to local-window continuation origins.
 */
export function admitAuthoredStart(
  route: Complete,
  arrival: GroundArrival,
  maxVertical: number,
  locomotion: LocomotionOptions,
  evidence: unknown[],
): Complete {
  if (
    evidence.length !== 1 ||
    arrival.state !== 'available' ||
    'groundRange' in arrival ||
    route.start !== arrival.id ||
    route.arrivalCost !== arrival.cost ||
    !Number.isFinite(maxVertical) ||
    maxVertical < 0 ||
    route.boosts?.length ||
    (locomotion.stamina && locomotion.stamina.initial !== locomotion.stamina.capacity) ||
    route.segments.some(
      (segment) => segment.boost || segment.boostExpiry !== undefined || segment.requiredGait,
    )
  )
    return route;
  const firstAction = route.segments.findIndex((segment) => segment.mode !== 'walk');
  if (firstAction < 1) return route;
  const prefix = route.segments.slice(0, firstAction),
    action = route.segments[firstAction];
  const admitted = (p: typeof arrival.position) =>
    Math.hypot(p[0] - arrival.position[0], p[2] - arrival.position[2]) <= 1e-6 &&
    Math.abs(p[1] - arrival.position[1]) <= maxVertical + 1e-6;
  if (
    !admitted(route.points[0]) ||
    !admitted(action.points[0]) ||
    Math.abs(action.points[0][1] - arrival.position[1]) > 0.01 + 1e-6 ||
    !['launch', 'rope'].includes(action.mode) ||
    !action.connection ||
    action.traversal ||
    (action.gait !== undefined && action.gait !== 'run') ||
    (action.mode === 'launch' &&
      (!action.flight ||
        action.flight.kind !== 'flight' ||
        !sameWitness(action.flight.start, action.points[0]) ||
        !sameWitness(action.flight.end, action.points.at(-1)))) ||
    prefix.some(
      (segment) =>
        segment.connection ||
        segment.flight ||
        segment.traversal ||
        (segment.gait !== undefined && segment.gait !== 'run') ||
        !segment.points.every(admitted),
    ) ||
    (route.goalHit && route.goalHit.segment < firstAction)
  )
    return route;
  const source = evidence[0];
  if (
    !source ||
    typeof source !== 'object' ||
    !('connections' in source) ||
    !Array.isArray(source.connections)
  )
    return route;
  const built = source.connections.some(
    (connection: unknown) =>
      connection &&
      typeof connection === 'object' &&
      'id' in connection &&
      connection.id === action.connection &&
      'state' in connection &&
      connection.state === 'open' &&
      'mode' in connection &&
      connection.mode === action.mode &&
      !('requiredGait' in connection && connection.requiredGait !== undefined) &&
      !('requiredBoost' in connection && connection.requiredBoost !== undefined) &&
      !('terminal' in connection && connection.terminal !== undefined) &&
      !('traversal' in connection && connection.traversal !== undefined) &&
      'points' in connection &&
      sameWitness(connection.points, action.points) &&
      'times' in connection &&
      sameWitness(connection.times, action.times) &&
      sameWitness('flight' in connection ? connection.flight : undefined, action.flight),
  );
  if (!built) return route;
  const segments = route.segments.slice(firstAction);
  const points = [segments[0].points[0], ...segments.flatMap((segment) => segment.points.slice(1))];
  const length = segments.reduce(
    (sum, segment) =>
      sum +
      segment.points
        .slice(1)
        .reduce(
          (part, p, i) => part + Math.hypot(...p.map((v, axis) => v - segment.points[i][axis])),
          0,
        ),
    0,
  );
  const candidate = retimeGroundRoute(
    {
      ...route,
      points,
      segments,
      length,
      schedule: undefined,
      cost: route.arrivalCost + segments.reduce((sum, segment) => sum + segment.times.at(-1)!, 0),
      ...(route.goalHit
        ? { goalHit: { ...route.goalHit, segment: route.goalHit.segment - firstAction } }
        : {}),
    },
    locomotion,
  );
  return candidate.status === 'complete' && candidate.cost <= route.cost ? candidate : route;
}

/** Recompute one continuous resource schedule; independently feasible pieces may
 * exhaust stamina or a timed boost when connected. Arrival overhead is paid once. */
export function composeRoutes(pieces: readonly Complete[], locomotion: LocomotionOptions): Route {
  const first = pieces[0];
  if (!first) return { status: 'no-verified-route' };
  // Geometry replay is not available at this composition boundary. Every piece
  // must therefore declare the same complete layout: a newly moved box can block
  // an earlier segment even when the pieces are individually feasible.
  type Placement = NonNullable<Complete['placements']>[number];
  let placements: Map<string, Placement> | undefined;
  for (const piece of pieces) {
    const layout = new Map<string, Placement>();
    for (const placement of piece.placements ?? []) {
      if (placement.position.length !== 3 || !placement.position.every(Number.isFinite))
        return { status: 'no-verified-route' };
      const previous = layout.get(placement.device);
      if (previous && previous.position.some((v, i) => v !== placement.position[i]))
        return { status: 'no-verified-route' };
      layout.set(placement.device, placement);
    }
    if (placements) {
      if (layout.size !== placements.size) return { status: 'no-verified-route' };
      for (const [device, placement] of placements) {
        const next = layout.get(device);
        if (!next || placement.position.some((v, i) => v !== next.position[i]))
          return { status: 'no-verified-route' };
      }
    } else placements = layout;
  }
  for (let i = 1; i < pieces.length; i++) {
    const end = pieces[i - 1].points.at(-1);
    const start = pieces[i].points[0];
    if (!end || !start || Math.hypot(...end.map((v, axis) => v - start[axis])) > 1e-6)
      return { status: 'no-verified-route' };
  }
  const segments = pieces.flatMap((piece) =>
    piece.segments.map(({ gait: _gait, ...segment }) => segment),
  );
  const last = pieces.at(-1)!;
  const searches = pieces.flatMap((piece) => (piece.search ? [piece.search] : []));
  // Work counts and expansion budgets add; the label bound is a peak. Preserve
  // uncertainty from constituent searches, even after a successful reschedule.
  const search = searches.length
    ? {
        truncated: searches.some((value) => value.truncated),
        expanded: searches.reduce((sum, value) => sum + value.expanded, 0),
        maxExpanded: searches.reduce((sum, value) => sum + value.maxExpanded, 0),
        maxLabels: Math.max(...searches.map((value) => value.maxLabels)),
      }
    : undefined;
  const route = retimeGroundRoute(
    {
      status: 'complete',
      ...(search ? { search } : {}),
      start: first.start,
      arrivalCost: first.arrivalCost,
      cost: first.arrivalCost + segments.reduce((sum, segment) => sum + segment.times.at(-1)!, 0),
      length: pieces.reduce((sum, piece) => sum + piece.length, 0),
      points: pieces.flatMap((piece, i) => (i ? piece.points.slice(1) : piece.points)),
      segments,
      placements: [...placements!.values()],
      boosts: pieces.flatMap((piece) => piece.boosts ?? []),
      ...(last.goalHit
        ? {
            goalHit: {
              ...last.goalHit,
              segment: segments.length - last.segments.length + last.goalHit.segment,
            },
          }
        : {}),
    },
    locomotion,
  );
  if (route.status !== 'complete') return route;
  const elapsed = new Map<string, number>();
  for (const segment of route.segments)
    if (segment.boost) {
      const before = elapsed.get(segment.boost.id) ?? 0;
      if (
        segment.boostExpiry !== undefined
          ? Math.abs(before + segment.boostExpiry - segment.boost.duration) > 1e-6
          : before + segment.times.at(-1)! > segment.boost.duration + 1e-6
      )
        return { status: 'no-verified-route' };
      elapsed.set(segment.boost.id, before + segment.times.at(-1)!);
    }
  return route;
}
