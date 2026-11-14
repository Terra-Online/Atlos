import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { prepareRouteSolver } from '@opendfieldmap/ganglia';

import { loadScene } from '#@/bench/adapters/ganglia-v1/scene.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { workerMemory, type WorkerRequest, type WorkerReply } from '#@/bench/workers.ts';
import type { RustPreparedSolver } from '#@/src/solver/ganglia-v1-rust.ts';
import { rustLibraryPath } from '#@/src/solver/ganglia-v1-rust.ts';
import { actionCatalogStats, setActionCatalogPhase } from '#@/src/v1/route/action-catalog.ts';

if (!process.send) throw new Error('Scene entry requires a child process IPC channel');
const send = (message: WorkerReply) => process.send!(message);
process.once('message', async (message: WorkerRequest) => {
  if (message.type !== 'setup') throw new Error('Scene worker requires setup');
  const setup = message.setup;
  const native = setup.config.algorithm === 'ganglia-v1-rust';
  let catalogPhase = setup.catalogPhase ?? 'disabled';
  if (!native) setActionCatalogPhase(catalogPhase);
  const scene = await loadScene(
    setup.dataRoot,
    setup.extractor,
    1,
    setup.scene,
    setup.preparation
      ? async (request) => {
          const files = await exportPhysicalRegion(
            {
              dataRoot: setup.dataRoot,
              extractor: setup.extractor,
              ...setup.preparation!,
            },
            request,
          );
          send({ type: 'region', files });
          return files;
        }
      : undefined,
  );
  const preparationStarted = performance.now();
  const solver = await prepareRouteSolver(
    setup.config as import('#@/src/solver/ganglia-v1.ts').GangliaV1Config,
    scene.input,
  );
  const rustSolver = native ? (solver as RustPreparedSolver) : undefined;
  const nativeBinary = native
    ? {
        path: rustLibraryPath(),
        sha256: createHash('sha256')
          .update(await readFile(rustLibraryPath()))
          .digest('hex'),
      }
    : undefined;
  const catalogStats = () => {
    const base = actionCatalogStats();
    if (!rustSolver) return base;
    const stats = rustSolver.catalogStats();
    return {
      ...base,
      phase: catalogPhase,
      scopes: Number(stats.banks),
      added: Number(stats.actions),
    };
  };
  // Replacement owns restoration, so callers cannot accidentally dispatch into
  // a frozen empty catalog. The same declared training sequence is replayed.
  if (setup.trainingQueries?.length) {
    if (rustSolver) rustSolver.setCatalogPhase('training');
    else setActionCatalogPhase('training');
    for (const query of setup.trainingQueries)
      await solver.solve(query, { signal: AbortSignal.timeout(setup.timeoutMs ?? 300_000) });
  }
  if (rustSolver) rustSolver.setCatalogPhase(catalogPhase);
  else setActionCatalogPhase(catalogPhase);
  const preparationMs = scene.timings.preparationMs + performance.now() - preparationStarted;
  let active: { id: number; controller: AbortController } | undefined;
  process.on('message', async (message: WorkerRequest) => {
    if (message.type === 'cancel') {
      if (active?.id === message.id) active.controller.abort();
      return;
    }
    if (message.type === 'close') {
      await solver.close();
      send({ type: 'closed' });
      process.disconnect();
      return;
    }
    if (message.type === 'verify') {
      send({
        type: 'verified',
        id: message.id,
        evaluation: await scene.verify(message.query, message.route),
      });
      return;
    }
    if (message.type === 'catalog-phase' || message.type === 'benchmark-phase') {
      if (message.type === 'catalog-phase') {
        catalogPhase = message.phase;
        if (rustSolver) rustSolver.setCatalogPhase(message.phase);
        else setActionCatalogPhase(message.phase);
      } else if (process.env.GANGLIA_PROFILE)
        console.error(JSON.stringify({ phase: message.phase, worker: setup.index }));
      send({
        type: 'control',
        id: message.id,
        catalog: catalogStats(),
        ...(message.type === 'catalog-phase' && message.phase === 'frozen'
          ? { memory: workerMemory() }
          : {}),
      });
      return;
    }
    if (message.type !== 'solve') throw new Error('Unexpected scene worker setup');
    const { id, query, events } = message;
    const controller = new AbortController();
    active = { id, controller };
    resetTimings(scene.timings);
    try {
      const result = await solver.solve(query, {
        signal: controller.signal,
        onEvent: events ? (event) => send({ type: 'event', id, event }) : undefined,
      });
      scene.verifyInputs();
      send({
        type: 'result',
        id,
        result,
        timings: scene.timings,
        memory: workerMemory(),
        catalog: catalogStats(),
        ...(setup.preparation ? { metadata: scene.metadata } : {}),
      });
    } catch (error) {
      send({ type: 'error', id, error: error instanceof Error ? error.message : String(error) });
    } finally {
      active = undefined;
    }
  });
  send({
    type: 'ready',
    config: solver.config,
    metadata: { ...scene.metadata, ...(nativeBinary ? { native: nativeBinary } : {}) },
    inputLoadMs: scene.inputLoadMs,
    preparationMs,
    memory: workerMemory(),
    catalog: catalogStats(),
  });
});
