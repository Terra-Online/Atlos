import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import type { LocomotionOptions } from '#@/src/movement.ts';
import type { GroundOptions, Route } from '#@/src/route.ts';
import type {
  WindowRequest,
  WindowJob,
  Corridor,
  WindowResources,
} from '#@/src/solver/resources.ts';
import { catalogEvidenceRevision, isActionCatalogFrozen } from '#@/src/v1/route/action-catalog.ts';
import { pruneGroundDetours } from '#@/src/v1/route/ground-detours.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { releaseSupportCaches } from '#@/src/v1/solver/physical/support-cache.ts';
import { physicalWork } from '#@/src/v1/solver/physical/work.ts';
import { composeRoutes } from '#@/src/v1/solver/route-result.ts';
type Complete = Extract<Route, { status: 'complete' }>;
type PreparedGround = {
  surfaces: Surface[];
  options: GroundOptions;
  project: ReturnType<typeof createGoalProjector>;
  planner?: ReturnType<typeof createGroundPlanner>;
};

/** One immutable resource snapshot, owned by a solver with fixed walls and locomotion.
 * Ground planning is synchronous, so concurrent queries can reuse its preparation.
 * A resource key change replaces the slot while existing queries finish their work.
 */
export function createWindowGroundCache() {
  let current: { key: string; value: Promise<PreparedGround> } | undefined;
  const clear = () => {
    // A retired load can finish later. Its projector owns its snapshot, so only
    // release the raw-input lookup memos after preparation has completed.
    if (current)
      void current.value.then(
        (data) => releaseSupportCaches(data.surfaces),
        () => {},
      );
    current = undefined;
  };
  return {
    get(key: string, load: () => Promise<{ surfaces: Surface[]; options: GroundOptions }>) {
      if (current?.key !== key) {
        clear();
        const value = load().then((data) => ({
          ...data,
          project: createGoalProjector(data.surfaces),
        }));
        current = { key, value };
        void value.catch(() => {
          if (current?.value === value) current = undefined;
        });
      }
      return current.value;
    },
    clear,
  };
}

export type WindowConfig = {
  tileSpan: number;
  gridSpan: number;
  maxTiles: number;
  margin: number;
  locomotion: LocomotionOptions;
  /** Vertical candidate projection allowance. Horizontal deviation stays within 0.5 m. */
  maxTargetError?: number;
  /** Unknown/action trajectories are indivisible; only ground guide spans may be split. */
  transfers?: Vec3[][];
};
const interpolate = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Poll one bounded region at a time. Candidate points only select windows;
 * completion requires physical routes and one continuous resource schedule. */
export function createWindowRoute<Request extends WindowRequest, Job extends WindowJob>(
  builder: WindowResources<Request, Job>,
  request: Request,
  points: Vec3[],
  settings: WindowConfig,
  groundCache = createWindowGroundCache(),
) {
  const physicalTileSpan = settings.tileSpan;
  const gridSpan = settings.gridSpan;
  const tiles = (a: Vec3, b: Vec3, margin: number) =>
    [0, 2].reduce(
      (count, axis) =>
        count *
        (Math.ceil(
          (Math.ceil((Math.max(a[axis], b[axis]) + margin) / gridSpan) * gridSpan) /
            physicalTileSpan,
        ) -
          Math.floor(
            (Math.floor((Math.min(a[axis], b[axis]) - margin) / gridSpan) * gridSpan) /
              physicalTileSpan,
          )),
      1,
    );
  if (
    !Number.isFinite(settings.tileSpan) ||
    settings.tileSpan <= 0 ||
    !Number.isFinite(settings.gridSpan) ||
    settings.gridSpan <= 0 ||
    !points.length ||
    points.some((p) => p.length !== 3 || !p.every(Number.isFinite)) ||
    !Number.isInteger(settings.maxTiles) ||
    settings.maxTiles < 1 ||
    settings.maxTiles > 512 ||
    !Number.isFinite(settings.margin) ||
    settings.margin <= 0
  )
    throw new Error('Invalid route window settings');
  const protectedEdges = new Set(
    (settings.transfers ?? []).flatMap((path) =>
      path.slice(1).map((p, i) => JSON.stringify([path[i], p])),
    ),
  );
  const candidates: Vec3[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i],
      previous = points[i - 1];
    // Ground straightening can leave a kilometre-long guide edge. Window
    // boundaries must not depend on the original polygon-centre density.
    const steps =
      previous && !protectedEdges.has(JSON.stringify([previous, point]))
        ? Math.max(
            1,
            Math.ceil(
              Math.hypot(point[0] - previous[0], point[2] - previous[2]) / (physicalTileSpan / 2),
            ),
          )
        : 1;
    if (previous)
      for (let step = 1; step < steps; step++)
        candidates.push(interpolate(previous, point, step / steps));
    candidates.push([...point]);
  }
  if (distance(candidates.at(-1)!, request.target) > 1e-6) candidates.push([...request.target]);
  const pieces: Complete[] = [];
  const evidence: unknown[] = [];
  const failures = new Map<string, string>();
  // Keep only the last full attempt in this root query. A completed bounded failure
  // is not a global reachability claim; identical work proceeds to the same fallback.
  let physicalFailure: { key: string; reason?: string; truncated: boolean } | undefined;
  let truncated = false;
  let cursor = 0,
    end = -1,
    stage = 0,
    expansion = 0,
    running = false;
  let position = request.arrival.position;
  const windowBounds = (last: number) => {
    const min: Vec3 = [...position],
      max: Vec3 = [...position];
    for (let i = cursor; i <= last; i++)
      for (const axis of [0, 2]) {
        min[axis] = Math.min(min[axis], candidates[i][axis]);
        max[axis] = Math.max(max[axis], candidates[i][axis]);
      }
    return { min, max };
  };
  const stages = ['walking', 'devices', 'all'] as const;
  const progress = (status: 'pending' | 'incomplete', reason?: string) => ({
    status,
    reason,
    diagnostics: { truncated },
    completedWindows: evidence.length,
    cursor,
    position,
    pieces: [...pieces],
    evidence: [...evidence],
    failures: [...failures],
    window: {
      firstPoint: cursor,
      lastPoint: end,
      points: candidates.slice(cursor, end + 1),
      stage: stages[stage],
      start: position,
      target: candidates[end],
      margin: settings.margin * (expansion + 1),
    },
  });
  let tail: ReturnType<typeof createWindowRoute<Request, Job>> | undefined;
  let tailCoversStart = false;
  return {
    async advanceTail(): Promise<
      | ReturnType<typeof progress>
      | { status: 'incomplete'; reason: string }
      | {
          status: 'partial';
          route: Complete;
          start: Vec3;
          end: Vec3;
          evidence: unknown[];
          diagnostics: { truncated: boolean };
          coversStart: boolean;
        }
    > {
      if (!tail) {
        let first = candidates.length - 1;
        const target = candidates.at(-1)!;
        const min: Vec3 = [...target],
          max: Vec3 = [...target];
        while (first > 0) {
          const point = candidates[first - 1];
          for (const axis of [0, 2]) {
            min[axis] = Math.min(min[axis], point[axis]);
            max[axis] = Math.max(max[axis], point[axis]);
          }
          if (tiles(min, max, settings.margin) > settings.maxTiles) break;
          first--;
        }
        if (first === candidates.length - 1)
          return { status: 'incomplete' as const, reason: 'tail-coverage-budget' };
        // A later visit to the same coordinates does not cover the omitted prefix.
        // Explicit support ranges require the original arrival's own projection proof.
        tailCoversStart =
          first === 0 &&
          request.arrival.state === 'available' &&
          request.arrival.groundRange === undefined &&
          candidates[first].every((value, axis) => value === request.arrival.position[axis]);
        tail = createWindowRoute(
          builder,
          {
            ...request,
            arrival: {
              id: 'target-approach',
              position: candidates[first],
              cost: 0,
              state: 'available',
            },
          },
          candidates.slice(first + 1),
          settings,
          groundCache,
        );
      }
      const result = await tail.advance();
      return result.status === 'complete'
        ? {
            status: 'partial' as const,
            route: result.route,
            start: result.route.points[0],
            end: result.route.points.at(-1)!,
            evidence: result.evidence,
            diagnostics: result.diagnostics,
            coversStart:
              tailCoversStart &&
              result.route.points[0].every(
                (value, axis) => value === request.arrival.position[axis],
              ),
          }
        : result;
    },
    async advance({
      maxWindows = Infinity,
      signal,
    }: { maxWindows?: number; signal?: AbortSignal } = {}): Promise<
      | ReturnType<typeof progress>
      | {
          status: 'complete';
          route: Complete;
          pieces: Complete[];
          evidence: unknown[];
          diagnostics: { truncated: boolean };
        }
    > {
      if (running) throw new Error('Window query already running');
      running = true;
      try {
        if (signal?.aborted) return progress('incomplete', 'aborted');
        while (cursor < candidates.length - 1 && distance(position, candidates[cursor]) <= 1e-6)
          cursor++;
        if (cursor >= candidates.length) {
          const route = composeRoutes(pieces, settings.locomotion);
          return route.status === 'complete'
            ? {
                status: 'complete' as const,
                route,
                pieces: [...pieces],
                evidence: [...evidence],
                diagnostics: { truncated },
              }
            : progress('incomplete', 'resource-schedule');
        }
        if (evidence.length >= maxWindows) return progress('incomplete', 'window-budget');
        const margin = settings.margin * (expansion + 1);
        if (end < cursor) {
          end = cursor;
          const bounds = windowBounds(end);
          while (end + 1 < candidates.length) {
            const next = candidates[end + 1];
            for (const axis of [0, 2]) {
              bounds.min[axis] = Math.min(bounds.min[axis], next[axis]);
              bounds.max[axis] = Math.max(bounds.max[axis], next[axis]);
            }
            if (tiles(bounds.min, bounds.max, margin) > settings.maxTiles) break;
            end++;
          }
        }
        const target = candidates[end];
        const bounds = windowBounds(end);
        if (tiles(bounds.min, bounds.max, margin) > settings.maxTiles)
          return progress('incomplete', 'coverage-budget');
        const key = JSON.stringify([position, target, margin, stage]);
        if (failures.has(key)) return progress('incomplete', failures.get(key));
        const lower = (axis: number) =>
          Math.floor((bounds.min[axis] - margin) / gridSpan) * gridSpan;
        const min: [number, number] = [lower(0), lower(2)];
        const upper = (axis: number) =>
          Math.ceil((bounds.max[axis] + margin) / gridSpan) * gridSpan;
        const max: [number, number] = [upper(0), upper(2)];
        const cells: Corridor['tiles'] = [];
        for (
          let x = Math.floor(min[0] / physicalTileSpan);
          x < Math.ceil(max[0] / physicalTileSpan);
          x++
        )
          for (
            let z = Math.floor(min[1] / physicalTileSpan);
            z < Math.ceil(max[1] / physicalTileSpan);
            z++
          )
            cells.push({ x, z });
        const corridor: Corridor = {
          kind: 'corridor-proposal',
          bounds: { min, max },
          tiles: cells,
          coarse: {
            regions: 0,
            edges: 0,
            path: [position, ...candidates.slice(cursor, end + 1)],
            halo: margin,
          },
        };
        const ground = await builder.query(request.scene, request.source, position, target, {
          startBuild: true,
          margin,
          corridor,
        });
        if (!ground || ground.status !== 'ready') {
          if (stage === 2) physicalFailure = undefined;
          if (!ground) return progress('incomplete', 'builder-unavailable');
          return ground.status === 'failed'
            ? progress('incomplete', ground.message)
            : progress('pending');
        }
        const final = end === candidates.length - 1;
        let supportedTarget = target;
        // Final interactions carry their own approach proof; an earlier window's
        // cached ground must not authorize replacements in that approach.
        let windowGround: PreparedGround | undefined;
        if (!final || !request.interaction) {
          const groundKey = builder.key(ground);
          windowGround = await groundCache.get(groundKey, () => builder.ground(ground));
          const vertical = settings.maxTargetError ?? 3;
          const supports = windowGround.project(target, {
            maxVertical: vertical,
            interaction: { radius: Math.hypot(vertical, 0.5), maxVertical: vertical },
          });
          const support = supports.find(
            (hit) => Math.hypot(hit.position[0] - target[0], hit.position[2] - target[2]) <= 0.5,
          );
          if (support) supportedTarget = support.position;
        }
        const local: Request = {
          ...request,
          arrival: {
            ...request.arrival,
            position,
            cost: pieces.length ? 0 : request.arrival.cost,
            ...(pieces.length ? { groundRange: undefined } : {}),
          },
          target: supportedTarget,
          interaction: final ? request.interaction : undefined,
          waypoints: [...(request.waypoints ?? []), ...coarseWaypoints([corridor])],
        };
        const evidenceRevision = stage === 2 ? catalogEvidenceRevision() : undefined;
        const revision =
          evidenceRevision === undefined ? undefined : builder.physicalRevision?.(ground);
        const physicalKey =
          revision === undefined
            ? undefined
            : JSON.stringify([
                revision,
                evidenceRevision,
                local.arrival,
                local.target,
                local.interaction,
                local.waypoints,
                local.walls,
                local.solverConfig,
              ]);
        if (stage === 2 && (physicalKey === undefined || physicalFailure?.key !== physicalKey))
          physicalFailure = undefined;
        const failed = physicalKey === undefined ? undefined : physicalFailure;
        let job: Job | null | undefined;
        if (!failed) {
          job = await builder.solve(ground, local, true, physicalWork(([0, 1, 2] as const)[stage]));
          if (!job || job.status !== 'ready') {
            if (stage === 2) physicalFailure = undefined;
            if (!job) return progress('incomplete', 'solver-unavailable');
            return job.status === 'failed'
              ? progress('incomplete', job.message)
              : progress('pending');
          }
        }
        if (signal?.aborted) return progress('incomplete', 'aborted');
        // Failure consumers use only reason/truncation, never a retained route or job.
        const result: ReturnType<typeof builder.route> = failed
          ? {
              reason: failed.reason,
              diagnostics: { truncated: failed.truncated },
            }
          : builder.route(job!);
        const route = result?.route;
        const diagnostics = result.diagnostics;
        const attemptTruncated =
          Boolean(
            diagnostics &&
            typeof diagnostics === 'object' &&
            'truncated' in diagnostics &&
            diagnostics.truncated === true,
          ) ||
          Boolean(
            route?.search?.truncated ||
            (route?.status === 'complete' && route.locomotion?.search?.truncated),
          );
        truncated ||= attemptTruncated;
        if (!failed && stage === 2)
          physicalFailure =
            physicalKey !== undefined && route && route.status !== 'complete'
              ? { key: physicalKey, reason: result.reason, truncated: attemptTruncated }
              : undefined;
        if (route?.status === 'complete') physicalFailure = undefined;
        if (route?.status === 'complete') {
          const exit = route.points.at(-1)!;
          if (pieces.length && distance(position, route.points[0]) > 1e-4)
            return progress('incomplete', 'entry-discontinuity');
          if (
            !(final && request.interaction) &&
            (Math.abs(exit[1] - target[1]) > (settings.maxTargetError ?? 3) ||
              Math.hypot(exit[0] - target[0], exit[2] - target[2]) > 0.5)
          ) {
            failures.set(key, 'target-projection-error');
          } else {
            // A device excursion can start in the preceding window and
            // return to its ground corridor in this one. Compare that
            // whole excursion before accepting the new route fragment.
            const previous = pieces.at(-1);
            const segments = [...(previous?.segments ?? []), ...route.segments];
            let accepted = route;
            let detours: { replacements: number; queries: number } | undefined;
            const length = (previous?.length ?? 0) + route.length;
            const direct = distance(previous?.points[0] ?? route.points[0], exit);
            if (
              // Frozen catalog queries use the physical pass for same-window pruning.
              // This approximate phase policy retains cross-window repairs and training.
              (previous || !isActionCatalogFrozen()) &&
              windowGround &&
              (segments.some((s) => s.mode !== 'walk') ||
                length > direct + 2 * windowGround.options.profile.radius)
            ) {
              const joined: Complete = {
                ...route,
                start: previous?.start ?? route.start,
                arrivalCost: previous?.arrivalCost ?? route.arrivalCost,
                cost: (previous?.cost ?? 0) + route.cost,
                length: (previous?.length ?? 0) + route.length,
                points: previous ? [...previous.points, ...route.points.slice(1)] : route.points,
                segments,
                boosts: [...(previous?.boosts ?? []), ...(route.boosts ?? [])],
                ...(route.goalHit
                  ? {
                      goalHit: {
                        ...route.goalHit,
                        segment: (previous?.segments.length ?? 0) + route.goalHit.segment,
                      },
                    }
                  : {}),
              };
              const planner = (windowGround.planner ??= createGroundPlanner(windowGround.surfaces, {
                ...windowGround.options,
                walls: [...windowGround.options.walls, ...request.walls],
                locomotion: settings.locomotion,
              }));
              const pruned = pruneGroundDetours(joined, planner, settings.locomotion);
              detours = { replacements: pruned.replacements, queries: pruned.queries };
              if (pruned.replacements && pruned.route.status === 'complete') {
                if (previous) pieces.pop();
                accepted = pruned.route;
              }
            }
            pieces.push(accepted);
            evidence.push({ ...result, ...(detours ? { detours } : {}) });
            position = exit;
            cursor = end + 1;
            end = -1;
            stage = 0;
            expansion = 0;
            return progress('pending');
          }
        } else failures.set(key, result?.reason ?? 'no-verified-route');
        if (stage < stages.length - 1) {
          stage++;
          return progress('pending');
        }
        if (expansion === 0) {
          expansion++;
          stage = 0;
          end = -1;
          return progress('pending');
        }
        // A long window can hide several independent action interfaces.
        // Resolve the nearer half before rejecting the whole corridor.
        if (end > cursor) {
          end = Math.floor((cursor + end) / 2);
          stage = 0;
          return progress('pending');
        }
        return progress('incomplete', failures.get(key));
      } finally {
        running = false;
      }
    },
  };
}

const coarseWaypoints = (corridors: Corridor[]): Vec3[] => {
  const paths = corridors.map((entry) => entry.coarse.path.slice(1, -1));
  const points: Vec3[] = [],
    seen = new Set<string>();
  for (let index = 0; index < Math.max(0, ...paths.map((path) => path.length)); index++) {
    for (const path of paths) {
      const point = path[index];
      if (!point) continue;
      const key = JSON.stringify(point);
      if (seen.has(key)) continue;
      seen.add(key);
      points.push([...point]);
    }
  }
  if (points.length <= 128) return points;
  return Array.from(
    { length: 128 },
    (_, index) => points[Math.round((index * (points.length - 1)) / 127)],
  );
};
