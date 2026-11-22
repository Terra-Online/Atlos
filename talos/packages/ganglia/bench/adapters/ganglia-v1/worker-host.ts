import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { prepareRouteSolver, type PreparedRouteSolver } from '@opendfieldmap/ganglia';

import type { SceneMetadata } from '#@/bench/adapter.ts';
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

type WorkerScene = Pick<
  Awaited<ReturnType<typeof loadScene>>,
  'inputLoadMs' | 'timings' | 'verifyInputs' | 'verify'
> & {
  input: Parameters<typeof prepareRouteSolver>[1];
  metadata: SceneMetadata;
  /** A second adapter can share IPC and verification without entering v1 search. */
  prepareSolver?(): Promise<PreparedRouteSolver>;
  nativeLibrary?: string;
  preparationStats?(): Record<string, unknown>;
  beginRequest?(signal: AbortSignal): void;
  endRequest?(): void;
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
    let active: ({ id: number } & ReturnType<typeof requestControl>) | undefined;
    const checkpoint = () => active?.checkpoint();
    const scene = await load(setup, (files) => send({ type: 'region', files }), checkpoint);
    const custom = !!scene.prepareSolver;
    if (!native && !custom) setActionCatalogPhase(catalogPhase);
    let solver: PreparedRouteSolver | undefined;
    let rustSolver: RustPreparedSolver | undefined;
    let initialization: Promise<void> | undefined;
    let preparationMs = scene.timings.preparationMs;
    const initialize = () => {
      if (!initialization)
        initialization = (async () => {
          const started = performance.now();
          solver = scene.prepareSolver
            ? await scene.prepareSolver()
            : await prepareRouteSolver(
                setup.config as import('#@/src/solver/ganglia-v1.ts').GangliaV1Config,
                scene.input,
              );
          rustSolver = native ? (solver as RustPreparedSolver) : undefined;
          if (rustSolver) rustSolver.setCatalogPhase(catalogPhase);
          else if (!custom) setActionCatalogPhase(catalogPhase);
          preparationMs += performance.now() - started;
        })();
      return initialization;
    };
    if (!setup.deferKernel) await initialize();
    const nativePath = scene.nativeLibrary ?? (native ? rustLibraryPath() : undefined);
    const nativeBinary = nativePath
      ? {
          path: nativePath,
          sha256: createHash('sha256')
            .update(await readFile(nativePath))
            .digest('hex'),
        }
      : undefined;
    const catalogStats = () => {
      if (custom) return undefined;
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
    process.on('message', async (message: WorkerRequest) => {
      if (message.type === 'cancel') {
        if (active?.id === message.id) active.controller.abort();
        return;
      }
      if (message.type === 'close') {
        await initialization?.catch(() => {});
        await solver?.close();
        send({ type: 'closed' });
        process.disconnect();
        return;
      }
      if (message.type === 'initialize') {
        try {
          const before = preparationMs;
          await initialize();
          send({
            type: 'control',
            id: message.id,
            catalog: catalogStats(),
            memory: workerMemory(),
            preparationMs: preparationMs - before,
            preparation: scene.preparationStats?.(),
          });
        } catch (error) {
          send({ type: 'error', id: message.id, error: String(error) });
        }
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
          else if (!custom) setActionCatalogPhase(message.phase);
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
        scene.beginRequest?.(controller.signal);
        if (!solver) throw new Error('Scene worker kernel is not initialized');
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
        scene.endRequest?.();
        active = undefined;
      }
    });
    send({
      type: 'ready',
      config: solver?.config ?? setup.config,
      metadata: { ...scene.metadata, ...(nativeBinary ? { native: nativeBinary } : {}) },
      inputLoadMs: scene.inputLoadMs,
      preparationMs,
      memory: workerMemory(),
      catalog: catalogStats(),
    });
  });
}
