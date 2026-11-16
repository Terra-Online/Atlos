/**
 * The runner owns phase order and shutdown. A Scenario contains reusable loaded
 * resources and resolved requests; only a trained kernel can enter measurement.
 * Training requests belong to the suite, while one worker config remains fixed.
 * Search outcomes, beta verification and report callbacks are independent: a
 * verifier failure never rewrites completion or modeled cost. Serial measurement
 * excludes verification intervals; batch measurement retains the existing full
 * benchmark scheduling contract. The positional entry point remains for callers
 * which already own a prepared solver and explicitly request legacy warmup.
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  RouteEvent,
} from '@opendfieldmap/ganglia';

import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { createKernel, type TrainedKernel } from '#@/bench/kernel.ts';
import { classify, verifyResult, type Verification } from '#@/bench/outcome.ts';
import { requirePreparedCatalog, type TrainedCatalog } from '#@/bench/preparation.ts';
import { summarizeQuality } from '#@/bench/quality.ts';
import { workerInput, type Scenario } from '#@/bench/scenario.ts';
import type { Case } from '#@/bench/suite.ts';
import type { Evaluation } from '#@/src/evaluation/route.ts';
import { verifyRoute } from '#@/src/evaluation/route.ts';

const digest = (value: unknown): string =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (key, value) =>
        ['flight', 'schedule', 'placements'].includes(key) ? undefined : value,
      ),
    )
    .digest('hex');
const outcome = (result: RouteResult) => ({
  route: result.route,
  connections: result.connections,
  ...(result.partial ? { partial: true } : {}),
  ...(result.reason === 'timeout' ? { timedOut: true } : {}),
});
const summarize = (result: RouteResult) => {
  const complete = result.route.status === 'complete' ? result.route : null;
  const wallMs =
    'solveWallMs' in result.diagnostics && typeof result.diagnostics.solveWallMs === 'number'
      ? result.diagnostics.solveWallMs
      : undefined;
  const status = classify(result);
  return {
    status,
    partial: result.partial === true,
    reason: result.reason ?? null,
    cost: status === 'success' && complete ? complete.cost : null,
    length: complete?.length ?? null,
    jumps: complete?.segments?.filter((segment) => segment.mode === 'jump').length ?? 0,
    drops: complete?.segments?.filter((segment) => segment.mode === 'drop').length ?? 0,
    truncated: result.diagnostics.truncated,
    timedOut: status === 'timeout',
    ...(wallMs === undefined ? {} : { wallMs }),
    ...('cancellationMs' in result.diagnostics
      ? { cancellationMs: result.diagnostics.cancellationMs }
      : {}),
    queueMs:
      'queueMs' in result.diagnostics && typeof result.diagnostics.queueMs === 'number'
        ? result.diagnostics.queueMs
        : null,
    responseMs:
      'responseMs' in result.diagnostics && typeof result.diagnostics.responseMs === 'number'
        ? result.diagnostics.responseMs
        : null,
    outcomeSha256: digest(outcome(result)),
  };
};

export type { Case } from '#@/bench/suite.ts';

/** Runtime warmup may exercise the implementation, but never a scored query.
 * Query equality, rather than an id, prevents renamed holdouts leaking into warmup. */
export function validateWarmup(cases: readonly Case[], warmup: readonly Case[]) {
  const problem = (query: RouteQuery) => ({
    ...query,
    starts: query.starts.map(({ id: _id, ...start }) => start),
  });
  if (
    warmup.some((item) =>
      cases.some((scored) => isDeepStrictEqual(problem(item.query), problem(scored.query))),
    )
  )
    throw new Error('Warmup and measured queries must be disjoint');
}

// Owns the solver through shutdown. Every measured round is scored, including
// its first query; no scored pass is silently reclassified as preparation.
async function measureBenchmark(
  solver: PreparedRouteSolver,
  cases: readonly Case[],
  rules: { maxVertical: number },
  onPhase?: (phase: 'prewarm' | 'batch') => void | Promise<void>,
  rounds = 1,
  recoverySetup = () => 0,
  warmupCases: readonly Case[] = [],
  verifyPhysical?: (query: RouteQuery, result: RouteResult) => Promise<Evaluation>,
  catalog?: TrainedCatalog,
  options?: {
    trained?: boolean;
    serial?: boolean;
    signal?: AbortSignal;
    onEvent?: (test: Case, event: RouteEvent) => void;
    onResult?: (
      test: Case,
      result: RouteResult,
      verification: Verification,
    ) => void | Promise<void>;
  },
) {
  const evaluate = (query: RouteQuery, result: RouteResult) =>
    verifyResult(
      query,
      result,
      verifyPhysical ?? (async (query, result) => verifyRoute(query, result.route, rules)),
    );
  let verificationWallMs = 0;
  const summarizeBatch = async (batch: readonly RouteResult[], cases: readonly Case[]) => {
    // Verifiers may overlap across workers. Measure the enclosing interval once.
    const started = performance.now();
    try {
      return await Promise.all(
        batch.map(async (result, i) => {
          const verification = await evaluate(cases[i].query, result);
          await options?.onResult?.(cases[i], result, verification);
          return { id: cases[i].id, ...summarize(result), ...verification };
        }),
      );
    } finally {
      verificationWallMs += performance.now() - started;
    }
  };
  const intervals = {
    warmup: { startedMs: 0, endedMs: 0 },
    queries: { startedMs: 0, endedMs: 0 },
    shutdown: { startedMs: 0, endedMs: 0 },
  };
  try {
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    if (!cases.length) throw new Error('Benchmark requires measured queries');
    if (!options?.trained) requirePreparedCatalog(solver.config, catalog, warmupCases);
    validateWarmup(cases, warmupCases);
    const warmupStarted = performance.now();
    intervals.warmup.startedMs = warmupStarted;
    const recoveryBefore = recoverySetup();
    let warm: readonly RouteResult[] = [];
    if (warmupCases.length) {
      await onPhase?.('prewarm');
      warm = await solver.solveBatch(warmupCases.map((item) => item.query));
      if (warm.length !== warmupCases.length)
        throw new Error('Warmup returned a different number of results');
    }
    const warmupResults = await summarizeBatch(warm, warmupCases);
    const warmup = {
      ids: warmupCases.map((item) => item.id),
      wallMs: performance.now() - warmupStarted - verificationWallMs,
      recoverySetupMs: recoverySetup() - recoveryBefore,
      quality: summarizeQuality(warmupResults),
      results: warmupResults,
    };
    intervals.warmup.endedMs = performance.now();
    // Warmup exercises the prepared solver. Failed queries remain outcomes,
    // while the worker module guarantees request cleanup before this returns.
    await onPhase?.('batch');
    intervals.queries.startedMs = performance.now();
    const samples: {
      wallMs: number;
      recoverySetupMs: number;
      results: ({ id: string } & ReturnType<typeof summarize> &
        Awaited<ReturnType<typeof evaluate>>)[];
    }[] = [];
    for (let round = 0; round < rounds; round++) {
      const started = performance.now();
      const setupBefore = recoverySetup();
      let results: (typeof samples)[number]['results'];
      let wallMs: number;
      if (options?.serial) {
        results = [];
        wallMs = 0;
        for (const item of cases) {
          options.signal?.throwIfAborted();
          const solving = performance.now();
          const result = await solver.solve(item.query, {
            signal: options.signal,
            onEvent: options.onEvent && ((event) => options.onEvent!(item, event)),
          });
          wallMs += performance.now() - solving;
          const verificationStarted = performance.now();
          const verification = await evaluate(item.query, result);
          verificationWallMs += performance.now() - verificationStarted;
          results.push({ id: item.id, ...summarize(result), ...verification });
          await options.onResult?.(item, result, verification);
        }
      } else {
        const batch = await solver.solveBatch(
          cases.map((item) => item.query),
          {
            signal: options?.signal,
          },
        );
        wallMs = performance.now() - started;
        if (batch.length !== cases.length)
          throw new Error('Batch returned a different number of results');
        results = await summarizeBatch(batch, cases);
      }
      samples.push({
        wallMs,
        recoverySetupMs: recoverySetup() - setupBefore,
        results,
      });
    }
    intervals.queries.endedMs = performance.now();
    const first = samples[0].results;
    const results = samples.at(-1)!.results.map((row, i) => {
      // Preserve an actual timed-out attempt rather than mixing its status with
      // a later successful attempt's cost, timing and verification evidence.
      const representative =
        samples.find((sample) => sample.results[i].status === 'timeout')?.results[i] ?? row;
      return {
        ...representative,
        wallSamplesMs: samples.map((sample) => sample.results[i].wallMs ?? null),
        sameOutcomeAcrossRounds: samples.every(
          (sample) => sample.results[i].outcomeSha256 === first[i].outcomeSha256,
        ),
        sameTruncationAcrossRounds: samples.every(
          (sample) => sample.results[i].truncated === first[i].truncated,
        ),
      };
    });
    const wallSamplesMs = samples.map((sample) => sample.wallMs);
    const totalWallMs = wallSamplesMs.reduce((sum, sample) => sum + sample, 0);
    const successfulQueries = samples.reduce(
      (sum, sample) => sum + summarizeQuality(sample.results).completed,
      0,
    );
    const attempts = samples.flatMap((sample) => sample.results);
    const serviceMs = attempts.flatMap((row) => (row.wallMs === undefined ? [] : [row.wallMs]));
    return {
      config: solver.config,
      queryCutoffMs: QUERY_CUTOFF_MS,
      verificationWallMs,
      warmup,
      intervals,
      batch: {
        rounds,
        repeatability: rounds > 1 ? ('measured' as const) : ('unmeasured' as const),
        wallSamplesMs,
        totalWallMs,
        wallMs: totalWallMs / rounds,
        recoverySetupMs: samples.reduce((sum, sample) => sum + sample.recoverySetupMs, 0),
        samples,
        successfulQueries,
        timedOutAttempts: attempts.filter((row) => row.timedOut).length,
        successfulQueriesPerSecond: successfulQueries / (totalWallMs / 1000),
        queriesPerSecond: attempts.length / (totalWallMs / 1000),
        ...(solver.config.batchConcurrency === 1 && serviceMs.length === attempts.length
          ? { meanSerialQueryMs: serviceMs.reduce((sum, ms) => sum + ms, 0) / serviceMs.length }
          : {}),
        quality: summarizeQuality(results),
        results,
      },
    };
  } finally {
    intervals.shutdown.startedMs = performance.now();
    try {
      await solver.close();
    } finally {
      intervals.shutdown.endedMs = performance.now();
    }
  }
}

// Keep the legacy interface explicit: callers cannot bypass readiness with the
// private measurement option used by the typed Scenario/Kernel lifecycle.
export function runBenchmark(
  solver: PreparedRouteSolver,
  cases: readonly Case[],
  rules: { maxVertical: number },
  onPhase?: (phase: 'prewarm' | 'batch') => void | Promise<void>,
  rounds = 1,
  recoverySetup = () => 0,
  warmupCases: readonly Case[] = [],
  verifyPhysical?: (query: RouteQuery, result: RouteResult) => Promise<Evaluation>,
  catalog?: TrainedCatalog,
) {
  return measureBenchmark(
    solver,
    cases,
    rules,
    onPhase,
    rounds,
    recoverySetup,
    warmupCases,
    verifyPhysical,
    catalog,
  );
}

export async function runScenario<Test extends Case>(
  scenario: Scenario<Test>,
  options: {
    rounds?: number;
    serial?: boolean;
    signal?: AbortSignal;
    onPhase?: (phase: 'training' | 'batch') => void | Promise<void>;
    onReady?: (kernel: TrainedKernel) => void | Promise<void>;
    onTrainingResult?: (test: Case, index: number, results: readonly RouteResult[]) => void;
    onEvent?: (test: Test, event: RouteEvent) => void;
    onResult?: (
      test: Test,
      result: RouteResult,
      verification: Verification,
    ) => void | Promise<void>;
  } = {},
) {
  const kernel = createKernel(scenario);
  try {
    await options.onPhase?.('training');
    const trained = await kernel.train({
      signal: options.signal,
      onResult: options.onTrainingResult,
    });
    await options.onReady?.(trained);
    const byId = new Map(scenario.cases.map((item) => [item.id, item]));
    let verificationTail: Promise<unknown> = Promise.resolve();
    const report = await measureBenchmark(
      {
        config: trained.config,
        solve: (query, options) => trained.query(query, options),
        solveBatch: (queries, options) => trained.queryBatch(queries, options),
        close: () => trained.close(),
      },
      scenario.cases,
      scenario.input.metadata.rules,
      async () => {
        await workerInput(scenario).setBenchmarkPhase('batch');
        await options.onPhase?.('batch');
      },
      options.rounds ?? 1,
      () => scenario.input.recoverySetupMs,
      [],
      (query, result) => {
        const verification = verificationTail.then(() => trained.verify(query, result));
        verificationTail = verification.catch(() => {});
        return verification;
      },
      undefined,
      {
        trained: true,
        serial: options.serial ?? true,
        signal: options.signal,
        onEvent: options.onEvent && ((item, event) => options.onEvent!(byId.get(item.id)!, event)),
        onResult:
          options.onResult &&
          ((item, result, verification) =>
            options.onResult!(byId.get(item.id)!, result, verification)),
      },
    );
    return { ...report, training: trained.training };
  } finally {
    await kernel.close();
  }
}
