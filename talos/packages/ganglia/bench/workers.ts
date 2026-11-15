import { fork, type ChildProcess } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

import type {
  PreparedRouteSolver,
  RouteEvent,
  RouteQuery,
  RouteResult,
  SolveOptions,
} from '@opendfieldmap/ganglia';

import { sceneIdentity, type SceneMetadata, type CatalogStats } from '#@/bench/adapter.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { createTimings, mergeTimings, type Timings } from '#@/bench/timings.ts';
import type { Evaluation } from '#@/src/evaluation/route.ts';
import { verifyRoute } from '#@/src/evaluation/route.ts';
import type { SolverSettings } from '#@/src/solver/contract.ts';

type Control =
  | { type: 'catalog-phase'; phase: CatalogStats['phase'] }
  | { type: 'benchmark-phase'; phase: 'prewarm' | 'batch' };

export const workerMemory = () => {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
};
type Memory = ReturnType<typeof workerMemory>;
/** A failed request returned by a live worker; process failures use ordinary Error. */
export class WorkerQueryError extends Error {}
export type WorkerResult = RouteResult & {
  diagnostics: RouteResult['diagnostics'] & {
    solveWallMs: number;
    timedOut: boolean;
    observedWallMs?: number;
    cancellationMs?: number;
    queueMs: number;
    responseMs: number;
  };
};
type RegionFiles = { ground: string; collision: string };
export interface WorkerSetup {
  config: SolverSettings;
  dataRoot: string;
  extractor: string;
  scene?: string;
  index: number;
  preparation?: { config: string; devices?: string };
  catalogPhase?: CatalogStats['phase'];
}
export type WorkerRequest =
  | { type: 'setup'; setup: WorkerSetup }
  | { type: 'solve'; id: number; query: RouteQuery; events: boolean }
  | { type: 'verify'; id: number; query: RouteQuery; route: RouteResult['route'] }
  | (Control & { id: number })
  | { type: 'cancel'; id: number }
  | { type: 'close' };
export type WorkerReply =
  | {
      type: 'ready';
      config: SolverSettings;
      metadata: SceneMetadata;
      inputLoadMs: number;
      preparationMs: number;
      memory: Memory;
      catalog?: CatalogStats;
    }
  | {
      type: 'result';
      id: number;
      result: RouteResult;
      timings: Timings;
      memory: Memory;
      metadata?: SceneMetadata;
      catalog?: CatalogStats;
    }
  | { type: 'verified'; id: number; evaluation: Evaluation }
  | { type: 'event'; id: number; event: RouteEvent; memory?: Memory; detail?: string }
  | { type: 'region'; files: RegionFiles }
  | { type: 'control'; id: number; catalog?: CatalogStats; memory?: Memory }
  | { type: 'error'; id: number; error: string }
  | { type: 'closed' };
type Task = {
  message: Extract<WorkerRequest, { type: 'solve' }>;
  resolve: (result: RouteResult) => void;
  reject: (error: unknown) => void;
  options: SolveOptions;
  cleanup: () => void;
  started?: number;
  enqueued: number;
  workerIndex?: number;
  timer?: ReturnType<typeof setTimeout>;
  interruption?: { reason: string; error?: unknown; startedMs: number };
};
type Slot = {
  index: number;
  worker?: ChildProcess;
  exited?: Promise<void>;
  active?: Task;
  ready: boolean;
  closeRequested?: boolean;
  rssBytes: number;
  rssPeakBytes: number;
  heapPeakBytes: number;
  catalog?: CatalogStats;
  inputLoadMs?: number;
  preparationMs?: number;
  readyMemory?: Memory;
  preparedMemory?: Memory;
};

/** Deadlines request cooperative cancellation. A slot stays occupied until its
 * query exits at a checkpoint; workers and trained state are never replaced.
 * An actual process failure invalidates the run instead of inventing recovery. */
export async function prepareWorkerSolver(options: {
  count: number;
  config: SolverSettings;
  dataRoot: string;
  extractor: string;
  scene?: string;
  entry?: URL;
  timeoutMs?: number;
  preparation?: WorkerSetup['preparation'];
  onRegion?: (files: RegionFiles) => void;
  onResult?: (query: RouteQuery, result: WorkerResult) => void;
  onEvent?: (query: RouteQuery, event: RouteEvent, memory?: Memory, detail?: string) => void;
}) {
  const timeoutMs = options.timeoutMs ?? QUERY_SLO_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > QUERY_SLO_MS)
    throw new Error('Invalid query timeout');
  if (!Number.isSafeInteger(options.count) || options.count < 1)
    throw new Error('Invalid worker count');
  if (options.preparation && options.count !== 1)
    throw new Error('Preparation requires one worker');
  const startup = performance.now();
  const config = { ...options.config };
  if (!Number.isSafeInteger(config.batchConcurrency) || config.batchConcurrency < 1)
    throw new Error('Invalid worker concurrency');
  const timings = createTimings();
  const queued: Task[] = [];
  const slots: Slot[] = Array.from({ length: options.count }, (_, index) => ({
    index,
    ready: false,
    rssBytes: 0,
    rssPeakBytes: 0,
    heapPeakBytes: 0,
  }));
  let prepared: Extract<WorkerReply, { type: 'ready' }> | undefined;
  let latest: SceneMetadata | undefined;
  let inputLoadMs = 0;
  let processRssSampledPeakBytes = process.memoryUsage().rss;
  let serial = 0,
    nextSlot = 0;
  let closed = false;
  let failure: Error | undefined;
  let closing: Promise<void> | undefined;
  let notifyDrained: (() => void) | undefined;
  const owners = new WeakMap<RouteResult, number>();
  const verifications = new Map<
    number,
    {
      resolve: (value: Evaluation) => void;
      reject: (error: Error) => void;
    }
  >();
  const controls = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let catalogPhase: CatalogStats['phase'] = 'disabled';
  const activeCount = () => slots.filter((slot) => slot.active).length;
  const drained = () => {
    if (!queued.length && !activeCount()) notifyDrained?.();
  };
  const requestClose = (slot: Slot) => {
    if (!slot.ready || slot.closeRequested || !slot.worker?.connected || slot.active) return;
    slot.closeRequested = true;
    slot.worker.send({ type: 'close' } satisfies WorkerRequest, (error) => {
      if (error) fail(error);
    });
  };
  const clean = (task: Task) => {
    clearTimeout(task.timer);
    task.cleanup();
  };
  const fail = (error: Error) => {
    failure ??= error;
    for (const control of controls.values()) control.reject(failure);
    controls.clear();
    for (const pending of verifications.values()) {
      pending.reject(failure);
    }
    verifications.clear();
    for (const task of queued.splice(0)) {
      clean(task);
      task.reject(failure);
    }
    for (const slot of slots) {
      if (slot.active) {
        clean(slot.active);
        slot.active.reject(failure);
        interrupt(slot, 'aborted', failure);
      }
      requestClose(slot);
    }
    drained();
  };
  const metadata = (value: SceneMetadata) => {
    if (latest) {
      const matches = options.preparation
        ? latest.scene === value.scene &&
          isDeepStrictEqual(latest.source, value.source) &&
          latest.kernelSha256 === value.kernelSha256 &&
          latest.gameAdapterSha256 === value.gameAdapterSha256 &&
          isDeepStrictEqual(latest.rules, value.rules) &&
          Object.entries(latest.hashes).every(([name, hash]) => value.hashes[name] === hash)
        : sceneIdentity(latest) === sceneIdentity(value);
      if (!matches) throw new Error('Scene worker input/source identity mismatch');
    }
    latest = value;
  };
  const sample = (slot: Slot, memory: Memory) => {
    slot.rssBytes = memory.rssBytes;
    slot.rssPeakBytes = Math.max(slot.rssPeakBytes, memory.rssBytes);
    slot.heapPeakBytes = Math.max(slot.heapPeakBytes, memory.heapUsedBytes);
    processRssSampledPeakBytes = Math.max(
      processRssSampledPeakBytes,
      process.memoryUsage().rss + slots.reduce((sum, item) => sum + item.rssBytes, 0),
    );
  };
  const measured = (result: RouteResult, task: Task, timedOut = false): WorkerResult => {
    const observedWallMs = performance.now() - task.started!;
    const value: WorkerResult = {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        solveWallMs: observedWallMs,
        ...(task.interruption
          ? { cancellationMs: performance.now() - task.interruption.startedMs }
          : {}),
        queueMs: task.started! - task.enqueued,
        responseMs: performance.now() - task.enqueued,
        timedOut,
        ...(timedOut ? { observedWallMs } : {}),
      },
    };
    return value;
  };
  const publish = (task: Task, result: WorkerResult) => {
    try {
      options.onResult?.(task.message.query, result);
      task.resolve(result);
    } catch (error) {
      task.reject(error);
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
  const interrupted = (reason: string, diagnostics?: RouteResult['diagnostics']): RouteResult => ({
    route: { status: 'no-verified-route' },
    connections: [],
    reason,
    diagnostics: { ...diagnostics, truncated: true },
  });
  // Keep the slot occupied until the interrupted computation has actually exited.
  // A late reply cannot become a successful result or overlap the next request.
  const interrupt = (slot: Slot, reason: string, error?: unknown) => {
    const task = slot.active;
    if (!task || task.interruption) return;
    task.interruption = { reason, error, startedMs: performance.now() };
    clearTimeout(task.timer);
    slot.worker!.send({ type: 'cancel', id: task.message.id } satisfies WorkerRequest, (error) => {
      if (error) fail(error);
    });
  };
  const start = (slot: Slot) =>
    new Promise<void>((resolve, reject) => {
      const worker = fork(
        options.entry ?? new URL('./adapters/ganglia-v1/worker.ts', import.meta.url),
        [],
        {
          serialization: 'advanced',
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      );
      slot.worker = worker;
      slot.ready = false;
      let ready = false;
      slot.exited = new Promise<void>((exited) =>
        worker.once('exit', () => {
          slot.rssBytes = 0;
          exited();
        }),
      );
      worker.on('message', (message: WorkerReply) => {
        if (failure && message.type !== 'ready') {
          if (
            (message.type === 'result' || message.type === 'error') &&
            slot.active?.message.id === message.id
          ) {
            clean(slot.active);
            slot.active = undefined;
            requestClose(slot);
            drained();
          }
          return;
        }
        try {
          if (message.type === 'ready') {
            slot.ready = ready = true;
            if (failure) {
              requestClose(slot);
              resolve();
              return;
            }
            if (
              !message.metadata.rules ||
              !Number.isFinite(message.metadata.rules.maxVertical) ||
              message.metadata.rules.maxVertical < 0
            )
              throw new Error('Adapter requires the snapshot projection tolerance');
            metadata(message.metadata);
            prepared ??= message;
            inputLoadMs = Math.max(inputLoadMs, message.inputLoadMs);
            timings.preparationMs += message.preparationMs;
            sample(slot, message.memory);
            slot.catalog = message.catalog;
            slot.inputLoadMs = message.inputLoadMs;
            slot.preparationMs = message.preparationMs;
            slot.readyMemory = message.memory;
            slot.ready = ready = true;
            resolve();
            return;
          }
          if (message.type === 'closed') return;
          if (message.type === 'control') {
            slot.catalog = message.catalog;
            if (message.memory) {
              slot.preparedMemory = message.memory;
              sample(slot, message.memory);
            }
            controls.get(message.id)?.resolve();
            controls.delete(message.id);
            return;
          }
          if (message.type === 'verified') {
            const pending = verifications.get(message.id);
            if (!pending) throw new Error('Unexpected verifier response');
            if (message.evaluation.scope !== 'physical')
              throw new Error('Adapter did not run physical verification');
            verifications.delete(message.id);
            pending.resolve(message.evaluation);
            return;
          }
          if (message.type === 'region') {
            options.onRegion?.(message.files);
            return;
          }
          const task = slot.active;
          if (!task || task.message.id !== message.id)
            throw new Error('Unexpected scene worker response');
          if (!task.interruption && performance.now() - task.started! >= timeoutMs)
            interrupt(slot, 'timeout');
          if (message.type === 'event') {
            if (task.interruption) return;
            try {
              if (message.memory) sample(slot, message.memory);
              options.onEvent?.(task.message.query, message.event, message.memory, message.detail);
              task.options.onEvent?.(message.event);
            } catch (error) {
              interrupt(slot, 'aborted', error);
            }
            return;
          }
          if (message.type === 'result' && message.metadata) metadata(message.metadata);
          slot.active = undefined;
          clean(task);
          if (task.interruption) {
            if (message.type === 'result') {
              slot.catalog = message.catalog;
              sample(slot, message.memory);
            }
            const { reason, error } = task.interruption;
            if (error !== undefined) task.reject(error);
            else
              publish(
                task,
                measured(
                  // Keep the worker's final diagnostic data without accepting
                  // a route returned after cancellation or the deadline.
                  interrupted(
                    reason,
                    message.type === 'result' ? message.result.diagnostics : undefined,
                  ),
                  task,
                  reason === 'timeout',
                ),
              );
          } else if (message.type === 'error') task.reject(new WorkerQueryError(message.error));
          else {
            slot.catalog = message.catalog;
            sample(slot, message.memory);
            mergeTimings(timings, message.timings);
            const result = measured(message.result, task);
            owners.set(result, slot.index);
            publish(task, result);
          }
          dispatch();
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          // A result with invalid metadata has still finished its computation.
          // Retire the request before draining the process cooperatively.
          if (
            (message.type === 'result' || message.type === 'error') &&
            slot.active?.message.id === message.id
          ) {
            clean(slot.active);
            slot.active.reject(cause);
            slot.active = undefined;
          }
          reject(cause);
          fail(cause);
        }
      });
      worker.on('error', (error) => {
        reject(error);
        fail(error);
      });
      worker.on('exit', (code, signal) => {
        slot.ready = false;
        if (slot.active) {
          clean(slot.active);
          slot.active.reject(new Error(`Scene worker exited unexpectedly (${signal ?? code})`));
          slot.active = undefined;
        }
        if (!slot.closeRequested || !ready || code !== 0) {
          const error = new Error(`Scene worker exited unexpectedly (${signal ?? code})`);
          reject(error);
          fail(error);
        }
        drained();
      });
      worker.send(
        {
          type: 'setup',
          setup: {
            config,
            dataRoot: options.dataRoot,
            extractor: options.extractor,
            scene: options.scene,
            index: slot.index,
            preparation: options.preparation,
            catalogPhase,
          },
        } satisfies WorkerRequest,
        (error) => {
          if (error) {
            reject(error);
            fail(error);
          }
        },
      );
    });
  function dispatch() {
    if (failure) {
      drained();
      return;
    }
    let active = activeCount();
    for (
      let checked = 0;
      checked < slots.length && queued.length && active < config.batchConcurrency;
      checked++
    ) {
      const slot = slots[nextSlot];
      nextSlot = (nextSlot + 1) % slots.length;
      if (!slot.ready || slot.active) continue;
      const index = queued.findIndex(
        (task) => task.workerIndex === undefined || task.workerIndex === slot.index,
      );
      if (index === -1) continue;
      const [task] = queued.splice(index, 1);
      slot.active = task;
      task.started = performance.now();
      task.timer = setTimeout(() => interrupt(slot, 'timeout'), timeoutMs);
      active++;
      const worker = slot.worker!;
      worker.send(task.message, (error) => {
        if (error) fail(error);
      });
    }
    drained();
  }
  try {
    await Promise.all(slots.map(start));
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    await Promise.all(slots.map((slot) => slot.exited));
    throw error;
  }
  timings.workerStartupMs = performance.now() - startup;
  if (!prepared || !latest) throw new Error('No scene workers prepared');
  const submit = (query: RouteQuery, solveOptions: SolveOptions = {}, workerIndex?: number) => {
    if (failure) return Promise.reject(failure);
    if (closed) return Promise.reject(new Error('Scene worker solver is closed'));
    return new Promise<RouteResult>((resolve, reject) => {
      const task: Task = {
        message: {
          type: 'solve',
          id: ++serial,
          query,
          events: Boolean(solveOptions.onEvent || options.onEvent),
        },
        options: solveOptions,
        enqueued: performance.now(),
        workerIndex,
        resolve,
        reject,
        cleanup: () => solveOptions.signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        const slot = slots.find((slot) => slot.active === task);
        if (slot) interrupt(slot, 'aborted');
        else {
          const index = queued.indexOf(task);
          if (index !== -1) queued.splice(index, 1);
          clean(task);
          task.started = performance.now();
          publish(task, measured(interrupted('aborted'), task));
          drained();
        }
      };
      if (solveOptions.signal?.aborted) {
        abort();
        return;
      }
      solveOptions.signal?.addEventListener('abort', abort, { once: true });
      queued.push(task);
      dispatch();
    });
  };
  const solver: PreparedRouteSolver = {
    config: Object.freeze(prepared.config),
    solve: submit,
    async solveBatch(queries, batchOptions) {
      const results = await Promise.all(queries.map((query) => submit(query, batchOptions)));
      if (failure) throw failure;
      return results;
    },
    close() {
      if (!closing) {
        closed = true;
        const priorFailure = failure;
        closing = (async () => {
          if (queued.length || activeCount())
            await new Promise<void>((resolve) => {
              notifyDrained = resolve;
            });
          for (const slot of slots) requestClose(slot);
          await Promise.all(slots.map((slot) => slot.exited));
          if (failure && !priorFailure) throw failure;
        })();
      }
      return closing;
    },
  };
  const control = async (message: Control) => {
    if (failure) throw failure;
    if (closed) throw new Error('Scene worker solver is closed');
    if (activeCount() || queued.length) throw new Error('Set phases between query batches');
    await Promise.all(
      slots.map(
        (slot) =>
          new Promise<void>((resolve, reject) => {
            const id = ++serial;
            controls.set(id, { resolve, reject });
            slot.worker!.send({ ...message, id } satisfies WorkerRequest, (error) => {
              if (error) fail(error);
            });
          }),
      ),
    );
  };
  return {
    solver,
    async verify(query: RouteQuery, result: RouteResult): Promise<Evaluation> {
      const contract = verifyRoute(query, result.route, prepared!.metadata.rules);
      if (!contract.valid || result.partial) return contract;
      if (activeCount() || queued.length || closed)
        throw new Error('Verify between batches before closing');
      const index = owners.get(result);
      if (index === undefined || !slots[index].ready)
        throw new Error('Physical verifier worker unavailable');
      return new Promise<Evaluation>((resolve, reject) => {
        const id = ++serial;
        verifications.set(id, { resolve, reject });
        slots[index].worker!.send(
          { type: 'verify', id, query, route: result.route } satisfies WorkerRequest,
          (error) => {
            if (error) fail(error);
          },
        );
      });
    },
    // Every prepared process sees the same declared training set in the same
    // order. Splitting training across lanes would benchmark different catalogs.
    async train(queries: readonly RouteQuery[]) {
      const results: RouteResult[][] = slots.map(() => []);
      for (const query of queries) {
        const batch = await Promise.all(slots.map((slot) => submit(query, {}, slot.index)));
        batch.forEach((result, index) => results[index].push(result));
      }
      if (failure) throw failure;
      return results;
    },
    async setCatalogPhase(phase: CatalogStats['phase']) {
      catalogPhase = phase;
      await control({ type: 'catalog-phase', phase });
    },
    setBenchmarkPhase: (phase: 'prewarm' | 'batch') => control({ type: 'benchmark-phase', phase }),
    catalogStats: () => {
      if (!slots[0].catalog) throw new Error('Adapter does not provide catalog statistics');
      return slots[0].catalog;
    },
    catalogStatsAll: () =>
      slots.map((slot) => {
        if (!slot.catalog) throw new Error('Adapter does not provide catalog statistics');
        return slot.catalog;
      }),
    inputLoadMs,
    timings,
    get recoverySetupMs() {
      return 0;
    },
    get recoveryCount() {
      return 0;
    },
    metadata: {
      ...prepared.metadata,
      get hashes() {
        return latest!.hashes;
      },
      get inputBytes() {
        return latest!.inputBytes;
      },
      execution: {
        mode: 'child-processes',
        workers: slots.length,
        lanes: Math.min(slots.length, config.batchConcurrency),
        timeoutMs,
        cancellation: 'cooperative-checkpoints',
        get recoverySetupMs() {
          return 0;
        },
        get recoveryCount() {
          return 0;
        },
        get memory() {
          return {
            processRssSampledPeakBytes,
            workerProcessRssSampledPeakBytes: slots.map((slot) => slot.rssPeakBytes),
            workerHeapUsedSampledPeakBytes: slots.map((slot) => slot.heapPeakBytes),
            ready: slots.map((slot) => slot.readyMemory),
            prepared: slots.map((slot) => slot.preparedMemory ?? slot.readyMemory),
          };
        },
        get preparation() {
          return slots.map((slot) => ({
            inputLoadMs: slot.inputLoadMs,
            preparationMs: slot.preparationMs,
          }));
        },
      },
    },
  };
}
