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
import type { SolverSettings } from '#@/src/solver/contract.ts';

type Control =
  | { type: 'catalog-phase'; phase: CatalogStats['phase'] }
  | { type: 'benchmark-phase'; phase: 'prewarm' | 'batch' };

export const workerMemory = () => {
  const memory = process.memoryUsage();
  return { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed };
};
type Memory = ReturnType<typeof workerMemory>;
export type WorkerResult = RouteResult & {
  diagnostics: RouteResult['diagnostics'] & {
    solveWallMs: number;
    timedOut: boolean;
    observedWallMs?: number;
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
  | (Control & { id: number })
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
  | { type: 'event'; id: number; event: RouteEvent }
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
};
type Slot = {
  index: number;
  worker?: ChildProcess;
  exited?: Promise<void>;
  active?: Task;
  ready: boolean;
  retired: boolean;
  rssBytes: number;
  rssPeakBytes: number;
  heapPeakBytes: number;
  catalog?: CatalogStats;
  inputLoadMs?: number;
  preparationMs?: number;
  readyMemory?: Memory;
  preparedMemory?: Memory;
};

/** The parent owns query deadlines. A separate process can be killed even when
 * synchronous JS or native search cannot yield to an AbortSignal. */
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
    retired: false,
    rssBytes: 0,
    rssPeakBytes: 0,
    heapPeakBytes: 0,
  }));
  let prepared: Extract<WorkerReply, { type: 'ready' }> | undefined;
  let latest: SceneMetadata | undefined;
  let inputLoadMs = 0,
    recoverySetupMs = 0,
    recoveryCount = 0;
  let processRssSampledPeakBytes = process.memoryUsage().rss;
  let serial = 0,
    nextSlot = 0;
  let closed = false,
    paused = false;
  let failure: Error | undefined;
  let recovering: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let notifyDrained: (() => void) | undefined;
  const restored = new Set<() => void>();
  const controls = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
  let catalogPhase: CatalogStats['phase'] = 'disabled';
  const activeCount = () => slots.filter((slot) => slot.active).length;
  const drained = () => {
    if (!paused && !recovering) {
      for (const resolve of restored) resolve();
      restored.clear();
    }
    if (!queued.length && !activeCount() && !paused && !recovering) notifyDrained?.();
  };
  const kill = (slot: Slot) => {
    if (slot.retired) return;
    slot.ready = false;
    slot.retired = true;
    const worker = slot.worker;
    if (!worker?.pid || worker.exitCode !== null || worker.signalCode !== null) return;
    // Exporter subprocesses inherit this detached process group. Killing the
    // group prevents timed-out preparation from continuing filesystem work.
    try {
      if (process.platform === 'win32') worker.kill('SIGKILL');
      else process.kill(-worker.pid, 'SIGKILL');
    } catch (error) {
      // A sibling can exit between its OS process disappearing and Node's exit
      // event. macOS may report EPERM for that vanished process group.
      if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
        worker.kill('SIGKILL');
        return;
      }
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
    }
  };
  const clean = (task: Task) => {
    clearTimeout(task.timer);
    task.cleanup();
  };
  const fail = (error: Error) => {
    failure ??= error;
    paused = false;
    for (const control of controls.values()) control.reject(failure);
    controls.clear();
    for (const task of queued.splice(0)) {
      clean(task);
      task.reject(failure);
    }
    for (const slot of slots) {
      if (slot.active) {
        clean(slot.active);
        slot.active.reject(failure);
        slot.active = undefined;
      }
      kill(slot);
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
    return {
      ...result,
      diagnostics: {
        ...result.diagnostics,
        solveWallMs: timedOut ? timeoutMs : observedWallMs,
        queueMs: task.started! - task.enqueued,
        responseMs: performance.now() - task.enqueued,
        timedOut,
        ...(timedOut ? { observedWallMs } : {}),
      },
    };
  };
  const interrupted = (reason: string): RouteResult => ({
    route: { status: 'no-verified-route' },
    connections: [],
    reason,
    diagnostics: { truncated: true },
  });
  const retire = (slot: Slot, reason: string, error?: unknown) => {
    const task = slot.active;
    if (!task) return;
    slot.active = undefined;
    paused = true;
    clean(task);
    kill(slot);
    if (error !== undefined) task.reject(error);
    else task.resolve(measured(interrupted(reason), task, reason === 'timeout'));
    dispatch();
  };
  const start = (slot: Slot) =>
    new Promise<void>((resolve, reject) => {
      const worker = fork(
        options.entry ?? new URL('./adapters/ganglia-v1/worker.ts', import.meta.url),
        [],
        {
          serialization: 'advanced',
          detached: process.platform !== 'win32',
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        },
      );
      slot.worker = worker;
      slot.retired = false;
      slot.ready = false;
      let ready = false;
      slot.exited = new Promise<void>((exited) =>
        worker.once('exit', () => {
          slot.rssBytes = 0;
          exited();
        }),
      );
      worker.on('message', (message: WorkerReply) => {
        if (slot.worker !== worker || slot.retired) return;
        try {
          if (message.type === 'ready') {
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
          if (message.type === 'region') {
            options.onRegion?.(message.files);
            return;
          }
          const task = slot.active;
          if (!task || task.message.id !== message.id)
            throw new Error('Unexpected scene worker response');
          if (performance.now() - task.started! >= timeoutMs) {
            retire(slot, 'timeout');
            return;
          }
          if (message.type === 'event') {
            try {
              task.options.onEvent?.(message.event);
            } catch (error) {
              retire(slot, 'aborted', error);
            }
            return;
          }
          if (message.type === 'result' && message.metadata) metadata(message.metadata);
          slot.active = undefined;
          clean(task);
          if (message.type === 'error') task.reject(new Error(message.error));
          else {
            slot.catalog = message.catalog;
            sample(slot, message.memory);
            mergeTimings(timings, message.timings);
            task.resolve(measured(message.result, task));
          }
          dispatch();
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          reject(cause);
          fail(cause);
        }
      });
      worker.on('error', (error) => {
        reject(error);
        fail(error);
      });
      worker.on('exit', (code, signal) => {
        if (slot.worker !== worker || slot.retired) {
          if (!ready) reject(new Error('Scene worker stopped before ready'));
          return;
        }
        if (ready && slot.active) {
          // A crashed search is a failed request. Corrupt/mismatched inputs and
          // startup failures still invalidate the run through the error path.
          retire(slot, `worker-exited:${signal ?? code}`);
          return;
        }
        if (!closing || slot.active || queued.length || !ready || code !== 0) {
          const error = new Error(`Scene worker exited unexpectedly (${signal ?? code})`);
          reject(error);
          fail(error);
        }
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
  const recover = () => {
    if (recovering || activeCount() || failure) return;
    const started = performance.now();
    recovering = (async () => {
      const dead = slots.filter((slot) => slot.retired);
      await Promise.all(dead.map((slot) => slot.exited));
      if (failure) return;
      await Promise.all(dead.map(start));
      recoveryCount += dead.length;
    })()
      .catch((error) => fail(error instanceof Error ? error : new Error(String(error))))
      .finally(() => {
        recoverySetupMs += performance.now() - started;
        recovering = undefined;
        paused = false;
        dispatch();
      });
  };
  function dispatch() {
    if (failure) {
      drained();
      return;
    }
    if (paused) {
      recover();
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
      task.timer = setTimeout(() => retire(slot, 'timeout'), timeoutMs);
      active++;
      const worker = slot.worker!;
      worker.send(task.message, (error) => {
        if (error && slot.worker === worker && !slot.retired) fail(error);
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
        message: { type: 'solve', id: ++serial, query, events: Boolean(solveOptions.onEvent) },
        options: solveOptions,
        enqueued: performance.now(),
        workerIndex,
        resolve,
        reject,
        cleanup: () => solveOptions.signal?.removeEventListener('abort', abort),
      };
      const abort = () => {
        const slot = slots.find((slot) => slot.active === task);
        if (slot) retire(slot, 'aborted');
        else {
          const index = queued.indexOf(task);
          if (index !== -1) queued.splice(index, 1);
          clean(task);
          task.started = performance.now();
          resolve(measured(interrupted('aborted'), task));
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
      // A batch boundary also closes its recovery interval, so a caller can
      // subtract setup time without moving it into the next batch's timing.
      while (paused || recovering) await new Promise<void>((resolve) => restored.add(resolve));
      if (failure) throw failure;
      return results;
    },
    close() {
      if (!closing) {
        closed = true;
        const priorFailure = failure;
        closing = (async () => {
          if (queued.length || activeCount() || paused || recovering)
            await new Promise<void>((resolve) => {
              notifyDrained = resolve;
            });
          if (!failure)
            for (const slot of slots)
              slot.worker!.send({ type: 'close' } satisfies WorkerRequest, (error) => {
                if (error) fail(error);
              });
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
    if (activeCount() || queued.length || paused || recovering)
      throw new Error('Set phases between query batches');
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
    // Every prepared process sees the same declared training set in the same
    // order. Splitting training across lanes would benchmark different catalogs.
    async train(queries: readonly RouteQuery[]) {
      const results: RouteResult[][] = slots.map(() => []);
      for (const query of queries) {
        const batch = await Promise.all(slots.map((slot) => submit(query, {}, slot.index)));
        batch.forEach((result, index) => results[index].push(result));
      }
      while (paused || recovering) await new Promise<void>((resolve) => restored.add(resolve));
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
      return recoverySetupMs;
    },
    get recoveryCount() {
      return recoveryCount;
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
        get recoverySetupMs() {
          return recoverySetupMs;
        },
        get recoveryCount() {
          return recoveryCount;
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
