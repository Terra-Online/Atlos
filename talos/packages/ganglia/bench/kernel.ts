/**
 * A Kernel owns one loaded scenario's solver state. train() is the only transition
 * to TrainedKernel and freezes learned catalogs before exposing query(). Queries
 * may fill derived runtime caches but cannot alter frozen training evidence.
 * Typestate prevents early queries; runtime checks also cover retained aliases,
 * overlapping requests and use after close, which TypeScript cannot consume.
 * queryBatch exists only for the full CLI's explicit throughput compatibility.
 */
import type { CatalogStats } from '#@/bench/adapter.ts';
import { workerInput, type Scenario } from '#@/bench/scenario.ts';
import type { Case } from '#@/bench/suite.ts';
import type { WorkerInput } from '#@/bench/workers.ts';
import type { Evaluation } from '#@/src/evaluation/route.ts';
import type {
  RouteQuery,
  RouteResult,
  SolveOptions,
  SolverSettings,
} from '#@/src/solver/contract.ts';

export interface Training {
  readonly ids: readonly string[];
  readonly wallMs: number;
  readonly perWorker: readonly { results: readonly RouteResult[]; stats?: CatalogStats }[];
}

export interface Kernel {
  train(
    options?: SolveOptions & {
      onResult?: (test: Case, index: number, results: readonly RouteResult[]) => void;
    },
  ): Promise<TrainedKernel>;
  close(): Promise<void>;
}

export interface TrainedKernel {
  readonly config: SolverSettings;
  readonly training: Training;
  query(query: RouteQuery, options?: SolveOptions): Promise<RouteResult>;
  /** Compatibility path for the existing full benchmark throughput measurement. */
  queryBatch(
    queries: readonly RouteQuery[],
    options?: SolveOptions,
  ): Promise<readonly RouteResult[]>;
  verify(query: RouteQuery, result: RouteResult): Promise<Evaluation>;
  close(): Promise<void>;
}

const claimed = new WeakSet<WorkerInput>();
const evidence = (stats: CatalogStats) =>
  JSON.stringify([stats.phase, stats.scopes, stats.scopeResets, stats.added, stats.evicted]);

/** One kernel owns a loaded worker handle. The TS action catalog is scoped to
 * retained scene objects and has no reset operation, so retraining that same
 * handle would reuse learned actions. Load another scenario for a fresh kernel. */
export function createKernel(scenario: Scenario): Kernel {
  const input = workerInput(scenario);
  if (claimed.has(input)) throw new Error('Scenario input already belongs to a kernel');
  claimed.add(input);
  let state: 'untrained' | 'training' | 'trained' | 'closed' = 'untrained';
  let pending: Promise<unknown> | undefined;
  let closing: Promise<void> | undefined;
  let frozen: readonly (string | undefined)[] = [];
  const checkFrozen = () => {
    if (input.catalogs().some((stats, index) => (stats && evidence(stats)) !== frozen[index])) {
      state = 'closed';
      throw new Error('Query changed the frozen training catalog');
    }
  };
  const close = () => {
    if (!closing) {
      state = 'closed';
      closing = (async () => {
        await pending?.catch(() => {});
        await scenario.close();
      })();
    }
    return closing;
  };
  const execute = async <T>(action: () => Promise<T>): Promise<T> => {
    if (state !== 'trained') throw new Error('Kernel is not available for queries');
    if (pending) throw new Error('Kernel requests must not overlap');
    checkFrozen();
    const operation = (async () => {
      try {
        return await action();
      } finally {
        checkFrozen();
      }
    })();
    pending = operation;
    try {
      return await operation;
    } finally {
      pending = undefined;
    }
  };
  return {
    close,
    async train(options = {}) {
      if (state !== 'untrained') throw new Error('Kernel can only be trained once');
      state = 'training';
      const operation = (async (): Promise<TrainedKernel> => {
        options.signal?.throwIfAborted();
        await input.initialize();
        const catalogs = input.catalogs();
        const hasCatalog = catalogs.some((stats) => stats !== undefined);
        if (hasCatalog && catalogs.some((stats) => stats === undefined))
          throw new Error('Workers disagree on catalog support');
        if (hasCatalog) await input.setCatalogPhase('training');
        const started = performance.now();
        const results: RouteResult[][] = catalogs.map(() => []);
        for (const [index, item] of scenario.training.entries()) {
          const batch = await input.train([item.query], options);
          batch.forEach((rows, worker) => results[worker].push(...rows));
          options.onResult?.(
            item,
            index,
            batch.map((rows) => rows[0]),
          );
        }
        options.signal?.throwIfAborted();
        if (hasCatalog) await input.setCatalogPhase('frozen');
        const stats = input.catalogs();
        if (stats.some((item) => item && item.phase !== 'frozen'))
          throw new Error('Training did not freeze every worker catalog');
        frozen = stats.map((item) => item && evidence(item));
        const training: Training = {
          ids: scenario.training.map((item) => item.id),
          wallMs: performance.now() - started,
          perWorker: results.map((results, index) => ({ results, stats: stats[index] })),
        };
        if (closing) throw new Error('Kernel closed during training');
        state = 'trained';
        return {
          config: input.solver.config,
          training,
          query: (query, options) => execute(() => input.solver.solve(query, options)),
          queryBatch: (queries, options) =>
            execute(() => input.solver.solveBatch(queries, options)),
          verify: (query, result) => execute(() => input.verify(query, result)),
          close,
        };
      })();
      pending = operation;
      try {
        return await operation;
      } catch (error) {
        await close();
        throw error;
      } finally {
        pending = undefined;
      }
    },
  };
}
