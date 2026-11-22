import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
  openGameAdapter,
  type GameAdapter,
  type SceneHooks,
} from '#@/bench/adapters/ganglia-v1/scene.ts';
import { openSceneLoader } from '#@/bench/scene-data/loader.ts';
import { createTimings, observePhysicalReport } from '#@/bench/timings.ts';
import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { verificationDefaults } from '#@/src/evaluation/policy.ts';
import type { Vec3, Wall } from '#@/src/geometry.ts';
import { physicalCoverage, physicalTileSpan } from '#@/src/model/coverage.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import {
  collisionName,
  groundName,
  gridTiles,
  manifestName,
  sha256,
  type Bounds,
  type Source,
  type StaticSupportMesh,
  tileKey,
} from '#@/src/scene-pack.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { createPhysicalPreparation } from '#@/src/solver/host.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { SceneNavigation, SceneResources, WindowRequest } from '#@/src/solver/resources.ts';

type Loader = Awaited<ReturnType<typeof openSceneLoader>>;
type Region = ReturnType<Loader['describe']>;
type Snapshot = Parameters<Parameters<Loader['withWindow']>[2]>[0];
type Report = Awaited<
  ReturnType<Awaited<ReturnType<GameAdapter['preparePhysicalRoute']>>['solve']>
>;
type Job = { status: 'ready'; region: Region; result?: Report };

export async function loadPackedScene(options: {
  directory: string;
  routing: string;
  extractor: string;
  scene: string;
  source: Source;
  memoryBudget: number;
  fixedBounds?: Bounds;
  hooks?: SceneHooks;
}) {
  const started = performance.now();
  const { directory, routing, scene, source, fixedBounds } = options;
  const files = {
    ground: join(directory, groundName),
    collision: join(directory, collisionName),
    movement: join(routing, 'movement-settings-current.json'),
    devices: join(routing, `${scene}-traversal-devices.json`),
  };
  const hashes: Record<string, string> = {};
  let inputBytes = 0;
  const read = async <T>(path: string) => {
    const bytes = await readFile(path);
    inputBytes += bytes.length;
    hashes[path] = sha256(bytes);
    return JSON.parse(bytes.toString()) as T;
  };
  const [navigation, movement, devices] = await Promise.all([
    read<SceneNavigation & { scene: string; source: Source }>(
      join(routing, `${scene}-ground-all.json`),
    ),
    read<{
      source: Source;
      defaultProfile: PhysicalInput['ground']['options']['profile'];
      sustainedSprint: PhysicalInput['locomotion'];
    }>(files.movement),
    read<{ source: Source; staticSupports?: StaticSupportMesh[] }>(files.devices),
  ]);
  if (
    navigation.scene !== scene ||
    !isDeepStrictEqual(navigation.source, source) ||
    !isDeepStrictEqual(movement.source, source) ||
    !isDeepStrictEqual(devices.source, source) ||
    !isDeepStrictEqual(navigation.options.profile, movement.defaultProfile) ||
    !movement.sustainedSprint
  )
    throw new Error(`Incompatible routing resources for ${scene}`);
  const loader = await openSceneLoader(
    directory,
    scene,
    source,
    options.memoryBudget,
    devices.staticSupports,
  );
  const { settings, selection } = loader.manifest;
  if (
    !isDeepStrictEqual(settings.profile, movement.defaultProfile) ||
    settings.cellSize * settings.tileCells !== physicalTileSpan
  )
    throw new Error(`Incompatible physical pack settings for ${scene}`);
  hashes[join(directory, manifestName)] = loader.digest;
  const fixed = fixedBounds && loader.describe(fixedBounds);
  const inputLoadMs = performance.now() - started;
  const { preparePhysicalRoute, gameAdapterSha256, kernelSha256, resolvedKernel } =
    await openGameAdapter(options.extractor);
  const transform = options.hooks?.transformInput ?? ((input: PhysicalInput) => input);
  const preparation = createPhysicalPreparation();
  const visited = new Map<string, Region>();
  const preparedRegions = new Map<string, Region>();
  const held = new Map<
    string,
    {
      snapshot: import('#@/src/solver/resources.ts').PhysicalSnapshot;
      raw: Snapshot;
      release: () => void;
    }
  >();
  // Prepared TS graphs can retain the raw geometry. Keep one window and charge
  // it for as long as the preparation can reference it.
  let warm: { raw: Snapshot; release: () => void } | undefined;
  const clearWarm = () => {
    preparation.clear();
    warm?.release();
    warm = undefined;
  };
  const retainedRaw = (region: Region) => {
    if (warm?.raw.revision === region.revision) return warm.raw;
    return [...held.values()].find(({ raw }) => raw.revision === region.revision)?.raw;
  };
  let releaseGround: (() => void) | undefined;
  const releasePhysical = () => {
    for (const { release } of held.values()) release();
    held.clear();
  };
  let signal: AbortSignal | undefined;
  let inputFailure: unknown;

  const timings = createTimings(performance.now() - started - inputLoadMs);
  const coverage = (region: Region) => ({
    bounds: region.bounds,
    tiles: region.tiles,
    tileSpan: physicalTileSpan,
  });
  const revision = (region: Region, walls: Wall[] = []) =>
    JSON.stringify([region.revision, gameAdapterSha256, walls]);
  const window = (region: Region) => ({ ...region.bounds, tiles: region.tiles });
  const withRaw = async <T>(
    region: Region,
    activeSignal: AbortSignal | undefined,
    use: (raw: Snapshot) => T | Promise<T>,
  ) => {
    activeSignal?.throwIfAborted();
    const existing = retainedRaw(region);
    return existing ? use(existing) : loader.withWindow(window(region), activeSignal, use);
  };
  const payloads = new WeakMap<Snapshot, ReadonlyMap<string, unknown>>();
  const normalize = async (
    snapshot: Snapshot,
    region: Region,
    request: WindowRequest,
    forSolve = false,
  ) => {
    const started = performance.now();
    let values = payloads.get(snapshot);
    if (!values) {
      const build = { ...settings, bounds: region.bounds, tiles: region.tiles };
      const identity = { scene, source, selection, coverage: snapshot.collision.coverage };
      const ground = {
        ...identity,
        version: 1,
        build,
        surfaces: snapshot.ground.surfaces,
        tiles: snapshot.ground.tiles,
        options: {
          ...navigation.options,
          profile: settings.profile,
          portals: snapshot.ground.portals,
          walls: snapshot.collision.walls,
          locomotion: movement.sustainedSprint,
        },
      };
      const collision = {
        ...snapshot.collision,
        ...identity,
        options: build,
        exclusions: snapshot.collision.walls,
      };
      values = new Map<string, unknown>([
        [files.ground, ground],
        [files.collision, collision],
        [files.devices, devices],
        [files.movement, movement],
      ]);
      payloads.set(snapshot, values);
    }
    const payload = values;
    const prepared = await preparePhysicalRoute(files, request, {
      cache: {
        begin: async () => region.revision,
        read: async (_slot: string, path: string) => payload.get(path),
        ...(forSolve && {
          preparation: {
            ...preparation,
            solve(...args: Parameters<typeof preparation.solve>) {
              args[0] = transform(args[0]);
              return preparation.solve(...args);
            },
          },
        }),
      },
    });
    timings.normalizationMs += performance.now() - started;
    return prepared;
  };
  const fail = (error: unknown): never => {
    if (!signal?.aborted) inputFailure ??= error;
    throw error;
  };
  const resources: SceneResources<Source, Job> = {
    async query(requestScene, requestSource, start, target, request) {
      if (requestScene !== scene || !isDeepStrictEqual(requestSource, source))
        throw new Error('Physical query snapshot mismatch');
      const [x0, z0, x1, z1] = physicalCoverage(start, target, request).bounds;
      try {
        const region =
          fixed ??
          loader.describe({
            min: [x0, z0],
            max: [x1, z1],
            tiles: request.corridor.tiles,
          });
        return { status: 'ready', region };
      } catch (error) {
        return fail(error);
      }
    },
    async physical({ region }, request) {
      try {
        signal?.throwIfAborted();
        const key = revision(region, request.walls);
        const existing = held.get(key);
        if (existing) return existing.snapshot;
        if (warm && warm.raw.revision !== region.revision) clearWarm();
        return await withRaw(region, signal, async (borrowed) => {
          const prepared = await normalize(borrowed, region, request);
          if (!prepared.input) throw new Error('Missing normalized physical pack input');
          visited.set(region.revision, region);
          const snapshot = {
            input: transform(prepared.input),
            revision: key,
            coverage: coverage(region),
          };
          held.set(key, { snapshot, raw: borrowed, release: borrowed.retain() });
          return snapshot;
        });
      } catch (error) {
        return fail(error);
      }
    },
    async solve({ region }, request, _start, work, solveOptions) {
      try {
        const activeSignal = solveOptions?.signal ?? signal;
        if (warm && warm.raw.revision !== region.revision) clearWarm();
        return await withRaw(region, activeSignal, async (snapshot) => {
          warm ??= { raw: snapshot, release: snapshot.retain() };
          const prepared = await normalize(snapshot, region, request, true);
          const started = performance.now();
          const result = await prepared.solve({
            work,
            signal: activeSignal,
            onProgress: options.hooks?.onProgress,
          });
          timings.localSolveMs += performance.now() - started;
          observePhysicalReport(timings, result.diagnostics);
          visited.set(region.revision, region);
          activeSignal?.throwIfAborted();
          return { status: 'ready' as const, region, result };
        });
      } catch (error) {
        clearWarm();
        return fail(error);
      }
    },
    async ground({ region }) {
      // Ganglia keeps one prepared ground slot per scene solver.
      releaseGround?.();
      releaseGround = undefined;
      try {
        if (warm && warm.raw.revision !== region.revision) clearWarm();
        const use = ({
          ground,
          walls,
          retain,
        }: Parameters<Parameters<Loader['withGround']>[2]>[0]) => {
          releaseGround = retain();
          return {
            surfaces: ground.surfaces,
            options: {
              ...navigation.options,
              portals: ground.portals,
              profile: settings.profile,
              walls,
              locomotion: movement.sustainedSprint,
            },
          };
        };
        signal?.throwIfAborted();
        const existing = retainedRaw(region);
        return existing
          ? use({
              ground: existing.ground,
              walls: existing.collision.walls,
              retain: () => existing.retain('ground'),
            })
          : await loader.withGround(window(region), signal, use);
      } catch (error) {
        return fail(error);
      }
    },
    key: ({ region }) => region.revision,
    physicalRevision: ({ region }) => revision(region),
    route: ({ result }) =>
      result?.status === 'unavailable' &&
      result.optimizing === false &&
      !result.route &&
      result.reason === 'no-verified-route'
        ? { ...result, route: { status: 'no-verified-route' } }
        : (result ?? {}),
    wait: async () => {},
    close: async () => {
      clearWarm();
      releaseGround?.();
      releasePhysical();
      visited.clear();
      await loader.close();
    },
  };
  return {
    input: {
      kind: 'scene' as const,
      scene: { ...navigation, walls: [] as Wall[], navigation },
      locomotion: movement.sustainedSprint,
      resources,
    },
    files,
    /** Query-independent physical preparation. The callback must finish copying
     * geometry before its borrowed loader snapshot is released. */
    async prepareSnapshot<T>(bounds: Bounds, use: (input: PhysicalInput) => Promise<T>) {
      const region = fixed ?? loader.describe(bounds);
      const position: Vec3 = [
        (bounds.min[0] + bounds.max[0]) / 2,
        0,
        (bounds.min[1] + bounds.max[1]) / 2,
      ];
      return withRaw(region, undefined, async (raw) => {
        const prepared = await normalize(raw, region, {
          scene,
          source,
          arrival: { id: 'scene-preparation', position, cost: 0, state: 'available' },
          target: position,
          walls: navigation.options.walls ?? [],
        });
        if (!prepared.input) throw new Error('Missing normalized preparation input');
        const result = await use(transform(prepared.input));
        preparedRegions.set(region.revision, region);
        return result;
      });
    },
    loaderStats() {
      const memory = process.memoryUsage();
      return {
        ...loader.stats(),
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        arrayBufferBytes: memory.arrayBuffers,
      };
    },
    inputLoadMs,
    timings,
    beginRequest(nextSignal: AbortSignal) {
      signal = nextSignal;
      inputFailure = undefined;
      visited.clear();
      for (const [key, region] of preparedRegions) visited.set(key, region);
    },
    endRequest() {
      releasePhysical();
      signal = undefined;
    },
    verifyInputs() {
      if (inputFailure !== undefined) throw inputFailure;
    },
    async verify(query: RouteQuery, route: Route) {
      const selected = new Map<string, Region>();
      if (route.status === 'complete') {
        if (fixed) selected.set(fixed.revision, fixed);
        else {
          const scopes = [...visited.values()].map((region) => ({
            region,
            tiles: new Set(region.tiles.map(tileKey)),
          }));
          const radius = settings.profile.radius;
          const sweep = (a: Vec3, b: Vec3): Bounds => ({
            min: [Math.min(a[0], b[0]) - radius, Math.min(a[2], b[2]) - radius],
            max: [Math.max(a[0], b[0]) + radius, Math.max(a[2], b[2]) + radius],
          });
          const select = (legs: readonly Bounds[]) => {
            for (const { region, tiles } of scopes) {
              if (
                legs.every(
                  (leg) =>
                    leg.min.every(
                      (v, axis) =>
                        v >= region.bounds.min[axis] && leg.max[axis] <= region.bounds.max[axis],
                    ) &&
                    gridTiles(leg, physicalTileSpan, true).every((tile) =>
                      tiles.has(tileKey(tile)),
                    ),
                )
              )
                selected.set(region.revision, region);
            }
          };
          for (const segment of route.segments) {
            const legs = segment.points.map((point, i) =>
              sweep(segment.points[Math.max(0, i - 1)], point),
            );
            if (segment.mode !== 'walk') {
              if (segment.flight)
                for (const endpoint of [segment.flight.start, segment.flight.end])
                  legs.push(sweep(endpoint, endpoint));
              select(legs);
              continue;
            }
            for (const leg of legs) select([leg]);
          }
        }
      }
      const regions = [...selected.values()];
      const reused = warm && selected.has(warm.raw.revision) ? warm.raw : undefined;
      if (!reused && regions.length) clearWarm();
      const missing = regions.filter((region) => region.revision !== reused?.revision);
      return loader.withWindows(missing.map(window), undefined, async (snapshots) => {
        const byRevision = new Map(snapshots.map((snapshot) => [snapshot.revision, snapshot]));
        if (reused) byRevision.set(reused.revision, reused);
        const worlds: ReturnType<typeof createPhysicalWorld>[] = [];
        for (const region of regions) {
          const prepared = await normalize(byRevision.get(region.revision)!, region, {
            scene,
            source,
            arrival: query.starts[0],
            target: query.goal,
            interaction: query.interaction,
            waypoints: query.waypoints,
            walls: navigation.options.walls ?? [],
          });
          if (!prepared.input) throw new Error('Missing normalized verifier input');
          worlds.push(createPhysicalWorld(transform(prepared.input), coverage(region)));
        }
        return createPhysicalVerifier(() => worlds)(query, route);
      });
    },
    metadata: {
      scene,
      source,
      hashes,
      gameAdapterSha256,
      kernelSha256,
      resolvedKernel,
      rules: {
        maxVertical: navigation.options.maxVertical,
        verification: { version: 3, policy: verificationDefaults },
      },
      // Window reads are measured separately in the per-attempt loader diagnostics.
      inputBytes: inputBytes + loader.manifestBytes,
      execution: {
        mode: 'inline',
        workers: 0,
        lanes: 1,
      },
    },
  };
}
