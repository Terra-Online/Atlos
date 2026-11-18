import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createGoalProjector, findGoalHit } from '#@/src/model/goals.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery, SolveOptions } from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import { physicalCoverage, physicalTileSpan, physicalWork } from '#@/src/solver/host.ts';
import type {
  PhysicalSnapshot,
  SceneResources,
  SceneTerminal,
  WindowJob,
} from '#@/src/solver/resources.ts';
import { standingFoot } from '#@/src/v1/search/traversal.ts';

type Complete = Extract<Route, { status: 'complete' }>;
export interface Entry extends SceneTerminal {
  /** Bind activation to the first real trigger crossing in the joined route. */
  bind(route: Complete): boolean;
}

export interface AirborneWindow<Job> {
  job: Job;
  snapshot: PhysicalSnapshot;
}

export async function loadAirborneWindow<Source, Job extends WindowJob>(
  scene: { scene: string; source: Source; walls: Wall[] },
  resources: SceneResources<Source, Job>,
  config: GangliaV1Config,
  query: RouteQuery,
  options: SolveOptions,
): Promise<AirborneWindow<Job> | undefined> {
  if (!query.interaction?.airborne || !resources.physical) return;
  const arrival = query.starts.find((a) => a.state === 'available');
  if (!arrival) return;
  const margin = config.gridSpan;
  const { bounds: extent, tiles: count } = physicalCoverage(query.goal, query.goal, { margin });
  if (count > config.maxTiles) return;
  const bounds: { min: [number, number]; max: [number, number] } = {
    min: [extent[0], extent[1]],
    max: [extent[2], extent[3]],
  };
  const tiles: { x: number; z: number }[] = [];
  for (
    let x = Math.floor(extent[0] / physicalTileSpan);
    x < Math.ceil(extent[2] / physicalTileSpan);
    x++
  )
    for (
      let z = Math.floor(extent[1] / physicalTileSpan);
      z < Math.ceil(extent[3] / physicalTileSpan);
      z++
    )
      tiles.push({ x, z });
  let job: Job | null;
  do {
    options.signal?.throwIfAborted();
    job = await resources.query(scene.scene, scene.source, query.goal, query.goal, {
      startBuild: true,
      margin,
      corridor: {
        kind: 'corridor-proposal',
        bounds,
        tiles,
        coarse: { regions: 0, edges: 0, path: [query.goal], halo: margin },
      },
    });
    if (!job || job.status === 'failed') return;
    if (job.status !== 'ready') await resources.wait(options.signal);
  } while (job.status !== 'ready');
  const snapshot = await resources.physical(job, {
    ...scene,
    arrival,
    target: query.goal,
    interaction: query.interaction,
  });
  return { job, snapshot };
}

/** Discover an airborne suffix from current physical/device facts. Its supported
 * entry is only a proposal until the original arrivals connect to it. No route
 * from an earlier query or authored itinerary is used as search input. */
export async function discoverAirborneEntries<Source, Job extends WindowJob>(
  scene: { scene: string; source: Source; walls: Wall[] },
  resources: SceneResources<Source, Job>,
  config: GangliaV1Config,
  query: RouteQuery,
  options: SolveOptions,
  load: () => Promise<AirborneWindow<Job> | undefined>,
): Promise<Entry[]> {
  if (!query.interaction?.airborne || !resources.physical) return [];
  const window = await load();
  if (!window) return [];
  const { job, snapshot } = window;
  const input = snapshot.input;
  const facts = input.devices;
  if (!facts) return [];
  const world = createPhysicalWorld(input, snapshot.coverage);
  const boosts = facts.devices.filter(
    (d) =>
      d.kind === 'accelerate' &&
      d.resolved &&
      d.unitScale &&
      d.goal &&
      typeof d.duration === 'number' &&
      Number.isFinite(d.duration) &&
      d.duration > 0 &&
      Number.isFinite(d.boostMultiplier) &&
      d.boostMultiplier > 1 &&
      world.covered(d.goal.position, d.goal.position, 0),
  );
  if (!boosts.length) return [];
  const physical = world.configured();
  const project = createGoalProjector(input.ground.surfaces);
  const entries: Entry[] = [];

  boosts.sort(
    (a, b) =>
      Math.hypot(...a.goal!.position.map((v, i) => v - query.goal[i])) -
      Math.hypot(...b.goal!.position.map((v, i) => v - query.goal[i])),
  );
  let attempts = 0;
  for (const device of boosts) {
    if (attempts >= config.maxAttempts) break;
    options.signal?.throwIfAborted();
    const goal = device.goal!;
    const duration = device.duration;
    if (typeof duration !== 'number') continue;
    const access = [device];
    const devices = new Map(facts.devices.map((d) => [d.id, d]));
    for (const pair of facts.ropes) {
      const bottom = devices.get(pair.bottom),
        top = devices.get(pair.top);
      if (!bottom?.goal || !top?.goal) continue;
      const distance = (p: Vec3) => Math.hypot(...p.map((v, i) => v - goal.position[i]));
      // Enter an authored connector at the end opposite its goal-near exit.
      // The physical worker must still prove that connector and the boost chain.
      const entry = distance(top.goal.position) < distance(bottom.goal.position) ? bottom : top;
      if (entry.goal && world.covered(entry.goal.position, entry.goal.position, 0))
        access.push(entry);
    }
    for (const entry of access) {
      if (attempts >= config.maxAttempts) break;
      const sourceGoal = entry.goal!;
      const supported = project(sourceGoal.position, {
        maxVertical: input.ground.options.maxVertical,
        interaction: sourceGoal.interaction,
      });
      let foot: Vec3 | undefined;
      for (const proposal of supported) {
        const candidate = standingFoot(proposal, physical.world, {
          profile: input.ground.options.profile,
          maxVertical: input.ground.options.maxVertical,
          maxSlope: input.movement.maxSlope,
          blocked: physical.blocked,
          project,
        });
        if (
          !candidate.reason &&
          world.covered(candidate.position, candidate.position) &&
          findGoalHit(
            [candidate.position, candidate.position],
            sourceGoal.position,
            sourceGoal.interaction,
          )
        ) {
          foot = candidate.position;
          break;
        }
      }
      if (!foot) continue;
      attempts++;
      const request = {
        ...scene,
        arrival: {
          id: `device-entry/${entry.id}`,
          position: foot,
          cost: 0,
          state: 'available' as const,
        },
        target: query.goal,
        interaction: query.interaction,
        solverConfig: config,
      };
      let solved: Job | null;
      do {
        options.signal?.throwIfAborted();
        solved = await resources.solve(job, request, true, physicalWork(2), {
          signal: options.signal,
        });
        if (!solved || solved.status === 'failed') break;
        if (solved.status !== 'ready') await resources.wait(options.signal);
      } while (solved.status !== 'ready');
      if (!solved || solved.status !== 'ready') continue;
      const result = resources.route(solved);
      if (result.route?.status !== 'complete' || !result.route.goalHit) continue;
      entries.push({
        id: `discovered/${device.id}/${entry.id}`,
        route: result.route,
        supportBoxes: result.supportBoxes,
        bind(route) {
          let elapsed = 0;
          let pickup: { time: number; position: Vec3 } | undefined;
          for (const segment of route.segments) {
            const hit = findGoalHit(segment.points, goal.position, goal.interaction);
            if (hit) {
              pickup = {
                time:
                  elapsed +
                  segment.times[hit.index - 1] +
                  hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]),
                position: hit.position,
              };
              break;
            }
            elapsed += segment.times.at(-1)!;
          }
          if (!pickup) return false;
          elapsed = 0;
          let activeEnd = pickup.time;
          for (const segment of route.segments) {
            const end = elapsed + segment.times.at(-1)!;
            if (segment.boost?.id === device.id) {
              if (
                elapsed < pickup.time - 1e-6 ||
                elapsed >= pickup.time + duration - 1e-6 ||
                (segment.boostExpiry === undefined
                  ? end > pickup.time + duration + 1e-6
                  : Math.abs(elapsed + segment.boostExpiry - pickup.time - duration) > 1e-6)
              )
                return false;
              activeEnd = Math.max(
                activeEnd,
                segment.boostExpiry === undefined ? end : elapsed + segment.boostExpiry,
              );
            }
            elapsed = end;
          }
          route.boosts = route.boosts?.map((boost) =>
            boost.id === device.id
              ? { ...boost, position: pickup!.position, elapsed: activeEnd - pickup!.time }
              : boost,
          );
          return true;
        },
      });
    }
  }
  return entries;
}
