import { readFile, realpath, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { loadScene, type GameAdapter } from '#@/bench/adapters/ganglia-v1/scene.ts';
import {
  checkSetup,
  facilityAudit,
  type FacilityCatalog,
  resourcePath,
  scenarioInput,
  exercised,
  type MechanismBinding,
  type MechanismResult,
} from '#@/bench/mechanism-suite.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import { createTimings } from '#@/bench/timings.ts';
import { workerMemory, type WorkerRequest, type WorkerReply } from '#@/bench/workers.ts';
import { createPhysicalWorld, createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import type { Evaluation } from '#@/src/evaluation/route.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  RouteEvent,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import type { createPhysicalPreparation } from '#@/src/solver/host.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { prepareRouteSolver } from '#@/src/solver/prepare.ts';
import type { snapshotGangliaV1Config } from '#@/src/v1/prepare.ts';
import type { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';

if (!process.send) throw new Error('Mechanism worker requires IPC');
const send = (message: WorkerReply) => process.send!(message);
process.once('message', async (message: WorkerRequest) => {
  if (message.type !== 'setup') throw new Error('Mechanism worker requires setup');
  const setup = message.setup,
    binding = JSON.parse(await readFile(setup.dataRoot, 'utf8')) as MechanismBinding;
  const item = binding.item;
  let solver: PreparedRouteSolver | undefined, input: PhysicalInput | undefined;
  let verify:
    | ((q: RouteQuery, r: RouteResult['route']) => Promise<Evaluation> | Evaluation)
    | undefined;
  let missingCoverage = false,
    controller: AbortController | undefined;
  let inputBindings: unknown;
  const facilityAudits: ReturnType<typeof facilityAudit>[] = [];
  let activeId: number | undefined,
    activeEvents = false,
    lastEventKey = '',
    lastEventAt = 0;
  const progress = (event: Extract<RouteEvent, { type: 'progress' }>, detail?: string) => {
    if (activeId === undefined || !activeEvents) return;
    const now = performance.now(),
      key = detail ?? event.phase;
    if (key === lastEventKey && now - lastEventAt < 1000) return;
    lastEventKey = key;
    lastEventAt = now;
    send({ type: 'event', id: activeId, event, memory: workerMemory(), detail });
  };
  let physicalDiagnostics: unknown;
  let lastProgress: unknown;
  const initialize = async () => {
    checkSetup(item);
    const adapterEntry = resolve(
      binding.extractor,
      'packages/extractor/src/game/physical-input.ts',
    );
    const adapterKernel = resolve(
      dirname(createRequire(adapterEntry).resolve('@opendfieldmap/ganglia/solver')),
      '../..',
    );
    if ((await realpath(adapterKernel)) !== (await realpath(binding.kernel)))
      throw new Error('Game adapter resolves a different kernel from this diagnostic');
    const kernel = (await import(
      pathToFileURL(resolve(binding.kernel, 'src/solver/prepare.ts')).href
    )) as { prepareRouteSolver: typeof prepareRouteSolver };
    const host = (await import(
      pathToFileURL(resolve(binding.kernel, 'src/solver/host.ts')).href
    )) as { createPhysicalPreparation: typeof createPhysicalPreparation };
    if (item.setup.physical) {
      const files = {
        ground: resourcePath(item.setup.physical.ground, binding.roots),
        collision: resourcePath(item.setup.physical.collision, binding.roots),
        movement: resolve(binding.roots.exports, 'movement-settings-current.json'),
        devices: resolve(
          binding.deviceExports ?? binding.roots.exports,
          `${item.scene}-traversal-devices.json`,
        ),
      };
      const values = new Map<string, unknown>(),
        bindings: Record<string, unknown> = {};
      const read = async (_slot: string, file: string) => {
        if (values.has(file)) return values.get(file);
        progress({ type: 'progress', phase: 'prepare' }, `read:${_slot}`);
        const bytes = await readFile(file, 'utf8');
        progress({ type: 'progress', phase: 'prepare' }, `parse:${_slot}`);
        const raw = JSON.parse(bytes);
        progress({ type: 'progress', phase: 'prepare' }, `loaded:${_slot}`);
        values.set(file, raw);
        const info = await stat(file);
        bindings[file] = {
          bytes: info.size,
          modifiedMs: info.mtimeMs,
          source: raw.source,
          generator: raw.generator,
          exportRevision: raw.exportRevision,
        };
        return raw;
      };
      const requestRef = item.evidence.find(
        (e) => e.collection === '$' && e.file.startsWith('retained/'),
      );
      const saved = requestRef
        ? ((await read('request', resourcePath(requestRef.file, binding.roots))) as {
            walls?: import('#@/src/geometry.ts').Wall[];
          })
        : undefined;
      const adapter = (await import(
        pathToFileURL(resolve(binding.extractor, 'packages/extractor/src/game/physical-input.ts'))
          .href
      )) as GameAdapter;
      const normalized = await adapter.preparePhysicalRoute(
        files,
        {
          scene: item.scene,
          source: binding.suite.source,
          arrival: item.query.starts[0],
          target: item.query.goal,
          interaction: item.query.interaction,
          waypoints: item.query.waypoints,
          walls: saved?.walls ?? [],
        },
        { cache: { begin: async () => JSON.stringify(files), read } },
      );
      if (!normalized.input) throw new Error('Missing normalized physical input');
      const audit = facilityAudit(normalized.input, values.get(files.devices) as FacilityCatalog);
      facilityAudits.push(audit);
      inputBindings = { files, bindings, facilityAudits };
      if (audit.staticImport !== 'matched')
        throw new Error(
          'Missing or mismatched static facility imports: ' +
            [...audit.missing, ...audit.mismatched].join(','),
        );
      input = scenarioInput(normalized.input, item);
      if (
        !isDeepStrictEqual(input.ground.options.profile, binding.suite.sources[item.scene].profile)
      )
        throw new Error('Player profile differs from the selected source');
      const ground = input.ground as typeof input.ground & { tiles?: { x: number; z: number }[] };
      const bounds = ground.build?.bounds;
      if (!bounds || !Array.isArray(ground.tiles))
        throw new Error('Missing explicit physical coverage');
      const world = createPhysicalWorld(input, {
        bounds,
        tiles: ground.tiles,
        tileSpan: physicalTileSpan,
      });
      verify = createPhysicalVerifier(() => [world]);
      inputBindings = {
        files,
        bindings,
        selectedSource: binding.suite.sources[item.scene],
        explicitDeviceRebinding: !!binding.deviceExports,
        facilityAudits,
      };
      const physical = (await import(
        pathToFileURL(resolve(binding.kernel, 'src/v1/solver/physical/prepared.ts')).href
      )) as { preparePhysicalSolver: typeof preparePhysicalSolver };
      const policy = (await import(
        pathToFileURL(resolve(binding.kernel, 'src/v1/prepare.ts')).href
      )) as { snapshotGangliaV1Config: typeof snapshotGangliaV1Config };
      solver = await physical.preparePhysicalSolver(
        input,
        policy.snapshotGangliaV1Config(setup.config as GangliaV1Config),
        {
          observe(_result, _optimizing, diagnostics) {
            physicalDiagnostics = structuredClone(diagnostics);
          },
        },
      );
    } else {
      if (!binding.sceneDataRoot) throw new Error('Missing scene-data-root');
      const dataRoot = resolve(binding.sceneDataRoot, item.id);
      if (
        binding.deviceExports &&
        (await realpath(resolve(dataRoot, `routing/${item.scene}-traversal-devices.json`))) !==
          (await realpath(resolve(binding.deviceExports, `${item.scene}-traversal-devices.json`)))
      )
        throw new Error('Scene routing devices do not match explicit device rebinding');
      const catalog = JSON.parse(
        await readFile(resolve(dataRoot, `routing/${item.scene}-traversal-devices.json`), 'utf8'),
      ) as FacilityCatalog;
      const scene = await loadScene(
        dataRoot,
        binding.extractor,
        1,
        item.scene,
        binding.prepareConfig
          ? (request) =>
              exportPhysicalRegion(
                {
                  dataRoot,
                  extractor: binding.extractor,
                  config: binding.prepareConfig!,
                  devices: resolve(dataRoot, `routing/${item.scene}-traversal-devices.json`),
                },
                request,
              )
          : undefined,
        {
          kernelRoot: binding.kernel,
          createPreparation: host.createPhysicalPreparation,
          transformInput: (raw) => {
            const audit = facilityAudit(raw, catalog);
            facilityAudits.push(audit);
            if (audit.staticImport !== 'matched')
              throw new Error(
                'Missing or mismatched static facility imports: ' +
                  [...audit.missing, ...audit.mismatched].join(','),
              );
            input = scenarioInput(raw, item);
            return input;
          },
        },
      );
      const resources = scene.input.resources,
        query = resources.query.bind(resources);
      resources.query = async (...args) => {
        const result = await query(...args);
        missingCoverage ||= !result;
        return result;
      };
      solver = await kernel.prepareRouteSolver(setup.config as GangliaV1Config, {
        ...scene.input,
        locomotion: item.setup.locomotion ?? scene.input.locomotion,
      });
      verify = scene.verify;
      inputBindings = {
        dataRoot,
        metadata: scene.metadata,
        expansionEnabled: !!binding.prepareConfig,
        facilityAudits,
      };
    }
  };
  process.on('message', async (m: WorkerRequest) => {
    if (m.type === 'cancel') {
      if (activeId === m.id) controller?.abort();
      return;
    }
    if (m.type === 'close') {
      await solver?.close();
      send({ type: 'closed' });
      process.disconnect();
      return;
    }
    if (m.type === 'catalog-phase' || m.type === 'benchmark-phase') {
      send({
        type: 'error',
        id: m.id,
        error: 'Physical diagnostic does not implement service preparation',
      });
      return;
    }
    if (m.type === 'verify') {
      if (!verify) {
        send({ type: 'error', id: m.id, error: 'Missing physical verifier' });
        return;
      }
      send({ type: 'verified', id: m.id, evaluation: await verify(m.query, m.route) });
      return;
    }
    if (m.type !== 'solve') return;
    controller = new AbortController();
    activeId = m.id;
    activeEvents = m.events;
    lastEventKey = '';
    lastEventAt = 0;
    const started = performance.now();
    let preparationMs = 0;
    let result: RouteResult;
    let evaluation: Evaluation | undefined,
      verificationMs = 0;
    try {
      if (!isDeepStrictEqual(m.query, item.query))
        throw new Error('Diagnostic query differs from its fixed case');
      if (!solver) {
        await initialize();
        preparationMs = performance.now() - started;
      }
      controller.signal.throwIfAborted();
      result = await solver!.solve(m.query, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'progress') {
            lastProgress = event;
            progress(event);
          }
        },
      });
      controller.signal.throwIfAborted();
      const t = performance.now();
      evaluation = await verify!(m.query, result.route);
      verificationMs = performance.now() - t;
      controller.signal.throwIfAborted();
      if (result.route.status !== 'complete' && missingCoverage)
        result = { ...result, reason: 'input-unavailable:requested physical coverage is absent' };
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const reason = text.startsWith('Unsupported ')
        ? 'unsupported-setup:'
        : (error instanceof Error && 'code' in error && error.code === 'ENOENT') ||
            text.startsWith('Missing ')
          ? 'input-unavailable:'
          : !solver
            ? 'input-invalid:'
            : 'execution-error:';
      result = {
        route: { status: 'no-verified-route' },
        connections: [],
        diagnostics: { truncated: controller.signal.aborted },
        reason: controller.signal.aborted ? 'aborted' : reason + text,
      };
    }
    const complete: MechanismResult = {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        mechanism: {
          mode: 'physical-diagnostic',
          evaluation,
          exercise:
            evaluation?.valid && !result.partial
              ? exercised(item, result, input)
              : item.assertions
                  .filter((a) => a.startsWith('exercise:'))
                  .map((assertion) => ({ assertion, status: 'unassessed' })),
          inputBindings: inputBindings ?? { facilityAudits },
          physicalDiagnostics,
          lastProgress,
          missingCoverage,
          preparationMs,
          verificationMs,
          effectiveStart: result.route.status === 'complete' ? result.route.points[0] : undefined,
        },
      },
    };
    send({
      type: 'result',
      id: m.id,
      result: complete,
      timings: createTimings(preparationMs),
      memory: workerMemory(),
    });
    controller = undefined;
    activeId = undefined;
    activeEvents = false;
  });
  // This diagnostic dispatch includes input loading and independent verification.
  // Cancellation waits for the current stage or exporter to finish; the parent
  // keeps the worker occupied and measures that tail rather than killing it.
  send({
    type: 'ready',
    config: setup.config,
    inputLoadMs: 0,
    preparationMs: 0,
    memory: workerMemory(),
    metadata: {
      scene: item.scene,
      source: binding.suite.source,
      hashes: { scenario: JSON.stringify([item.setup, binding.roots, binding.deviceExports]) },
      gameAdapterSha256: 'not-a-service-benchmark',
      kernelSha256: 'not-a-service-benchmark',
      resolvedKernel: binding.kernel,
      rules: { maxVertical: 0.5 },
      inputBytes: 0,
      execution: { mode: 'inline', workers: 0, lanes: 1 },
    },
  });
});
