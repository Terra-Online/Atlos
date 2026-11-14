import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import type { Route } from '@opendfieldmap/ganglia';
import {
  type SceneResources,
  type RouteResult,
  type WindowRequest,
} from '@opendfieldmap/ganglia/solver';
import { createPhysicalPreparation, type PhysicalWork } from '@opendfieldmap/ganglia/solver/host';

import {
  loadSceneData,
  type SceneData,
  type PhysicalRegion,
  type Source,
  type PhysicalFiles,
  type RegionBuild,
} from '#@/bench/scene-data.ts';
import { createTimings } from '#@/bench/timings.ts';
import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

type Report = {
  status?: 'candidate' | 'unavailable';
  optimizing?: boolean;
  route?: Route;
  reason?: string;
  supportBoxes?: RouteResult['supportBoxes'];
  diagnostics?: unknown;
};
type Job = { status: 'ready'; region: PhysicalRegion; result?: Report };
// The game adapter owns exporter validation and normalization; no frontend modules are loaded.
export type GameAdapter = {
  preparePhysicalRoute(
    resources: PhysicalFiles,
    request: WindowRequest,
    context: { cache: unknown },
  ): Promise<{ input?: PhysicalInput; solve(options: { work: PhysicalWork }): Promise<Report> }>;
};

export async function loadScene(
  dataRoot: string,
  extractor: string,
  concurrency: number,
  scene = 'map02',
  build?: RegionBuild,
) {
  const loadingStarted = performance.now();
  const dataset = await loadSceneData(dataRoot, scene, build);
  const entry = resolve(extractor, 'packages/extractor/src/game/physical-input.ts');
  const resolvedKernel = createRequire(entry).resolve('@opendfieldmap/ganglia/solver');
  const kernelRoot = resolve(dirname(resolvedKernel), '../..');
  const sourceRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const kernelDigest = async (base: string) => {
    const hash = createHash('sha256');
    for (const name of (await readdir(resolve(base, 'src'), { recursive: true })).sort()) {
      if (name.endsWith('.ts'))
        hash.update(name + '\0').update(await readFile(resolve(base, 'src', name)));
    }
    return hash.digest('hex');
  };
  const kernelSha256 = await kernelDigest(kernelRoot);
  if (kernelSha256 !== (await kernelDigest(sourceRoot)))
    throw new Error(
      'Game adapter resolves a different Ganglia source; check its workspace dependency before benchmarking',
    );
  const { preparePhysicalRoute } = (await import(
    pathToFileURL(resolve(extractor, 'packages/extractor/src/game/physical-input.ts')).href
  )) as GameAdapter;
  const adapterHash = createHash('sha256');
  for (const directory of ['packages/extractor/src', 'packages/formats/src']) {
    for (const name of (await readdir(resolve(extractor, directory), { recursive: true })).sort()) {
      if (name.endsWith('.ts'))
        adapterHash
          .update(`${directory}/${name}\0`)
          .update(await readFile(resolve(extractor, directory, name)));
    }
  }
  const gameAdapterSha256 = adapterHash.digest('hex');
  const inputLoadMs = dataset.inputLoadMs;
  const prepared = prepareSceneResources(
    dataset,
    preparePhysicalRoute,
    concurrency,
    gameAdapterSha256,
  );
  prepared.timings.preparationMs = performance.now() - loadingStarted - inputLoadMs;
  return {
    input: {
      kind: 'scene' as const,
      scene: {
        scene: dataset.navigation.scene,
        source: dataset.navigation.source,
        walls: [],
        navigation: dataset.navigation,
      },
      resources: prepared.resources,
      locomotion: dataset.locomotion,
    },
    inputLoadMs,
    timings: prepared.timings,
    verifyInputs: prepared.verifyInputs,
    verify: prepared.verify,
    metadata: {
      scene: dataset.navigation.scene,
      source: dataset.navigation.source,
      hashes: dataset.hashes,
      gameAdapterSha256,
      kernelSha256,
      resolvedKernel,
      rules: { maxVertical: dataset.navigation.options.maxVertical },
      get inputBytes() {
        return dataset.inputBytes;
      },
      execution: {
        mode: 'inline',
        workers: 0,
        lanes: concurrency,
        get memory() {
          return prepared.memory();
        },
      },
    },
  };
}

export function prepareSceneResources(
  dataset: SceneData,
  preparePhysicalRoute: GameAdapter['preparePhysicalRoute'],
  concurrency: number,
  gameAdapterSha256: string,
) {
  let inputFailure: { error: unknown } | undefined;
  const failInput = (error: unknown): never => {
    inputFailure ??= { error };
    throw error;
  };
  let processRssSampledPeakBytes = process.memoryUsage().rss;
  let mainHeapUsedSampledPeakBytes = process.memoryUsage().heapUsed;
  const sampleMemory = () => {
    const memory = process.memoryUsage();
    processRssSampledPeakBytes = Math.max(processRssSampledPeakBytes, memory.rss);
    mainHeapUsedSampledPeakBytes = Math.max(mainHeapUsedSampledPeakBytes, memory.heapUsed);
  };
  const physicalInputs = new Map<
    string,
    {
      input: PhysicalInput;
      region: PhysicalRegion;
      verifier?: ReturnType<typeof createPhysicalWorld>;
    }
  >();
  const evaluatePhysical = createPhysicalVerifier(() =>
    [...physicalInputs.values()].map(
      (entry) =>
        (entry.verifier ??= createPhysicalWorld(entry.input, {
          bounds: entry.region.ground.build.bounds,
          tiles: entry.region.ground.tiles,
          tileSpan: entry.region.ground.build.cellSize * entry.region.ground.build.tileCells,
        })),
    ),
  );
  const verify = async (query: import('#@/src/solver/contract.ts').RouteQuery, route: Route) => {
    if (route.status === 'complete')
      for (const segment of route.segments) {
        const seeds = [
          ...segment.points,
          ...(segment.flight ? [segment.flight.start, segment.flight.end] : []),
        ];
        const region = dataset.regions.find((region) =>
          seeds.every(
            (point) =>
              point[0] >= region.ground.build.bounds.min[0] &&
              point[0] <= region.ground.build.bounds.max[0] &&
              point[2] >= region.ground.build.bounds.min[1] &&
              point[2] <= region.ground.build.bounds.max[1],
          ),
        );
        if (!region || [...physicalInputs.values()].some((entry) => entry.region === region))
          continue;
        // Normalization exposes raw facts independently of the chosen solver,
        // including after a timed-out worker was replaced.
        const normalized = await preparePhysicalRoute(
          region.files,
          {
            scene: dataset.navigation.scene,
            source: dataset.navigation.source,
            arrival: query.starts[0],
            target: query.goal,
            interaction: query.interaction,
            walls: [],
            waypoints: query.waypoints,
          },
          {
            cache: {
              begin: async () => region.binding,
              read: async (_slot: string, path: string) => {
                if (!dataset.inputs.has(path)) throw new Error('Verifier input was not preloaded');
                return dataset.inputs.get(path);
              },
            },
          },
        );
        const input = normalized.input;
        if (!input) throw new Error('Exporter did not provide normalized verifier input');
        physicalInputs.set(region.binding, { input, region });
      }
    return evaluatePhysical(query, route);
  };
  const preparationStarted = performance.now();
  // Lane-local caches keep mutable preparation isolated across concurrent solves.
  // Timed input reads are served from the preloaded snapshot.
  const caches = Array.from({ length: concurrency }, () => {
    const preparation = createPhysicalPreparation();
    const cache = {
      region: undefined as PhysicalRegion | undefined,
      async begin(files: PhysicalFiles) {
        if (
          !this.region ||
          files.ground !== this.region.files.ground ||
          files.collision !== this.region.files.collision ||
          files.movement !== this.region.files.movement
        )
          throw new Error('Physical preparation region mismatch');
        return this.region.binding;
      },
      read: async (_slot: string, path: string) => {
        if (!dataset.inputs.has(path)) throw new Error(`Physical input was not preloaded: ${path}`);
        return dataset.inputs.get(path);
      },
      preparation: {
        ...preparation,
        solve: (...args: Parameters<typeof preparation.solve>) => {
          if (!thisRegion()) throw new Error('Missing verifier input region');
          const region = thisRegion()!;
          const key = region.binding + JSON.stringify(args[0].ground.options.walls);
          if (!physicalInputs.has(key)) physicalInputs.set(key, { input: args[0], region });
          return preparation.solve(...args);
        },
      },
      clear: preparation.clear,
    };
    const thisRegion = () => cache.region;
    return cache;
  });
  const idle = [...caches];
  const waiting: ((cache: (typeof caches)[number]) => void)[] = [];
  const acquire = () => {
    const cache = idle.pop();
    return cache
      ? Promise.resolve(cache)
      : new Promise<(typeof caches)[number]>((resolve) => waiting.push(resolve));
  };
  const timings = createTimings(performance.now() - preparationStarted);
  const observe = (report: Report) => {
    timings.physical.calls++;
    const diagnostics = report.diagnostics;
    if (!diagnostics || typeof diagnostics !== 'object') return;
    // Count final physical reports once; provisional candidate emissions share
    // the same mutable diagnostics and would otherwise multiply these totals.
    if (
      'timingMs' in diagnostics &&
      diagnostics.timingMs &&
      typeof diagnostics.timingMs === 'object'
    )
      for (const [stage, milliseconds] of Object.entries(diagnostics.timingMs))
        if (typeof milliseconds === 'number')
          timings.physical.stagesMs[stage] = (timings.physical.stagesMs[stage] ?? 0) + milliseconds;
    if (
      'prepareReuse' in diagnostics &&
      diagnostics.prepareReuse &&
      typeof diagnostics.prepareReuse === 'object'
    )
      for (const [slot, reused] of Object.entries(diagnostics.prepareReuse)) {
        if (typeof reused !== 'boolean') continue;
        const count = (timings.physical.preparation[slot] ??= { hits: 0, misses: 0 });
        if (reused) count.hits++;
        else count.misses++;
      }
  };
  const resources: SceneResources<Source, Job> = {
    physical: async (job, request) => {
      try {
        const started = performance.now();
        const normalized = await preparePhysicalRoute(job.region.files, request, {
          cache: {
            begin: async () => job.region.binding,
            read: async (_slot: string, path: string) => {
              if (!dataset.inputs.has(path))
                throw new Error(`Physical input was not preloaded: ${path}`);
              return dataset.inputs.get(path);
            },
          },
        });
        if (!normalized.input)
          throw new Error('Game adapter does not expose normalized physical facts');
        physicalInputs.set(JSON.stringify([job.region.binding, request.walls]), {
          input: normalized.input,
          region: job.region,
        });
        timings.normalizationMs += performance.now() - started;
        return {
          input: normalized.input,
          revision: JSON.stringify([job.region.binding, gameAdapterSha256, request.walls]),
          coverage: {
            bounds: job.region.ground.build.bounds,
            tiles: job.region.ground.tiles,
            tileSpan: physicalTileSpan,
          },
        };
      } catch (error) {
        return failInput(error);
      }
    },
    query: async (scene, source, start, target, options) => {
      try {
        if (
          scene !== dataset.navigation.scene ||
          !isDeepStrictEqual(source, dataset.navigation.source)
        )
          throw new Error('Physical query snapshot mismatch');
        const region = await dataset.query(start, target, options);
        return region ? { status: 'ready', region } : null;
      } catch (error) {
        return failInput(error);
      }
    },
    solve: async (job, request, _start, work) => {
      const cache = await acquire();
      cache.region = job.region;
      try {
        let started = performance.now();
        const prepared = await preparePhysicalRoute(job.region.files, request, { cache });
        timings.normalizationMs += performance.now() - started;
        started = performance.now();
        const result = await prepared.solve({ work });
        timings.localSolveMs += performance.now() - started;
        observe(result);
        return { status: 'ready', region: job.region, result };
      } catch (error) {
        return failInput(error);
      } finally {
        sampleMemory();
        const next = waiting.shift();
        if (next) next(cache);
        else idle.push(cache);
      }
    },
    key: (job) => `${job.region.files.ground}:${dataset.hashes[job.region.files.ground]}`,
    physicalRevision: (job) =>
      concurrency === 1 ? JSON.stringify([job.region.binding, gameAdapterSha256]) : undefined,
    ground: async (job) => job.region.ground,
    route: (job) => {
      const result = job.result ?? {};
      // The adapter's final unavailable report omits its failed Route. Preserve
      // that explicit outcome without treating empty/provisional jobs as failures.
      return !result.route &&
        result.status === 'unavailable' &&
        result.optimizing === false &&
        result.reason === 'no-verified-route'
        ? { ...result, route: { status: 'no-verified-route' } }
        : result;
    },
    wait: async () => {},
    close: async () => {
      for (const cache of caches) cache.clear();
    },
  };
  return {
    resources,
    verify,
    timings,
    verifyInputs() {
      // A scene solver may preserve a validated tail after a provider error.
      // Incomplete input coverage must invalidate a benchmark even with that tail.
      if (inputFailure) throw inputFailure.error;
    },
    memory() {
      sampleMemory();
      return { processRssSampledPeakBytes, mainHeapUsedSampledPeakBytes };
    },
  };
}
