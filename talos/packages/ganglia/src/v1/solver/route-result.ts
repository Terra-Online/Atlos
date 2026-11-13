import type { LocomotionOptions } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';

type Complete = Extract<Route, { status: 'complete' }>;

/** Recompute one continuous resource schedule; independently feasible pieces may
 * exhaust stamina or a timed boost when connected. Arrival overhead is paid once. */
export function composeRoutes(pieces: readonly Complete[], locomotion: LocomotionOptions): Route {
  const first = pieces[0];
  if (!first) return { status: 'no-verified-route' };
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
