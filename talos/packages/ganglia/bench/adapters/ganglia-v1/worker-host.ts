import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { prepareRouteSolver } from '@opendfieldmap/ganglia';

import type { loadScene } from '#@/bench/adapters/ganglia-v1/scene.ts';
import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { resetTimings } from '#@/bench/timings.ts';
import {
  workerMemory,
  type WorkerRequest,
  type WorkerReply,
  type WorkerSetup,
} from '#@/bench/workers.ts';
import type { RustPreparedSolver } from '#@/src/solver/ganglia-v1-rust.ts';
import { rustLibraryPath } from '#@/src/solver/ganglia-v1-rust.ts';
import { actionCatalogStats, setActionCatalogPhase } from '#@/src/v1/route/action-catalog.ts';

type WorkerScene = Awaited<ReturnType<typeof loadScene>> & {
  inspectResult?: (
    query: import('#@/src/solver/contract.ts').RouteQuery,
    result: import('#@/src/solver/contract.ts').RouteResult,
  ) => import('#@/src/solver/contract.ts').RouteResult;
};

/** A microtask-heavy solver can delay IPC cancellation. Check the same request
 * budget locally at phase boundaries, then use its ordinary AbortSignal path. */
export function requestControl(timeoutMs: number) {
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  return {
    controller,
    checkpoint() {
      if (performance.now() >= deadline) controller.abort();
      controller.signal.throwIfAborted();
    },
  };
}

export function serveWorker(
  load: (
    setup: WorkerSetup,
    onRegion: (files: { ground: string; collision: string }) => void,
    checkpoint: () => void,
  ) => Promise<WorkerScene>,
) {
  if (!process.send) throw new Error('Scene entry requires a child process IPC channel');
  const send = (message: WorkerReply) => process.send!(message);
  process.once('message', async (message: WorkerRequest) => {
    if (message.type !== 'setup') throw new Error('Scene worker requires setup');
    const setup = message.setup;
    const native = setup.config.algorithm === 'ganglia-v1-rust';
    let catalogPhase = setup.catalogPhase ?? 'disabled';
    if (!native) setActionCatalogPhase(catalogPhase);
    let active: ({ id: number } & ReturnType<typeof requestControl>) | undefined;
    const checkpoint = () => active?.checkpoint();
    const scene = await load(setup, (files) => send({ type: 'region', files }), checkpoint);
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
    if (rustSolver) rustSolver.setCatalogPhase(catalogPhase);
    else setActionCatalogPhase(catalogPhase);
    const preparationMs = scene.timings.preparationMs + performance.now() - preparationStarted;
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
        try {
          send({
            type: 'verified',
            id: message.id,
            evaluation: await scene.verify(message.query, message.route),
          });
        } catch (error) {
          send({ type: 'error', id: message.id, error: String(error) });
        }
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
      const control = requestControl(message.timeoutMs ?? QUERY_CUTOFF_MS);
      const { controller } = control;
      active = { id, ...control };
      resetTimings(scene.timings);
      try {
        let result = await solver.solve(query, {
          signal: controller.signal,
          onEvent(event) {
            checkpoint();
            if (events) send({ type: 'event', id, event });
          },
        });
        result = scene.inspectResult?.(query, result) ?? result;
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
}
