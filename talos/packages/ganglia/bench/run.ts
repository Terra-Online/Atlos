import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedRouteSolver, RouteQuery, RouteResult } from '@opendfieldmap/ganglia';

import { requirePreparedCatalog, type TrainedCatalog } from '#@/bench/preparation.ts';
import { summarizeQuality } from '#@/bench/quality.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { evaluateRoute, verifyRoute } from '#@/src/evaluation/route.ts';

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
const summarize = (result: RouteResult, evaluation = evaluateRoute(result.route)) => {
  const complete = result.route.status === 'complete' ? result.route : null;
  const invalid = complete !== null && !evaluation.valid;
  const wallMs =
    'solveWallMs' in result.diagnostics && typeof result.diagnostics.solveWallMs === 'number'
      ? result.diagnostics.solveWallMs
      : undefined;
  return {
    status: invalid ? 'invalid-route' : result.route.status,
    evaluation,
    partial: result.partial === true,
    reason: invalid ? evaluation.issues.join('; ') : (result.reason ?? null),
    cost: evaluation.costSeconds,
    length: evaluation.length,
    jumps: complete?.segments?.filter((segment) => segment.mode === 'jump').length ?? 0,
    drops: complete?.segments?.filter((segment) => segment.mode === 'drop').length ?? 0,
    truncated: result.diagnostics.truncated,
    timedOut: result.reason === 'timeout' || (wallMs !== undefined && wallMs > QUERY_SLO_MS),
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

export type Case = { id: string; query: RouteQuery };

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
export async function runBenchmark(
  solver: PreparedRouteSolver,
  cases: readonly Case[],
  rules: { maxVertical: number },
  onPhase?: (phase: 'prewarm' | 'batch') => void | Promise<void>,
  rounds = 1,
  recoverySetup = () => 0,
  warmupCases: readonly Case[] = [],
  verifyPhysical?: (
    query: RouteQuery,
    result: RouteResult,
  ) => Promise<ReturnType<typeof evaluateRoute>>,
  catalog?: TrainedCatalog,
) {
  const evaluate = async (query: RouteQuery, result: RouteResult) =>
    result.partial
      ? evaluateRoute(result.route)
      : verifyPhysical
        ? verifyPhysical(query, result)
        : verifyRoute(query, result.route, rules);
  const intervals = {
    warmup: { startedMs: 0, endedMs: 0 },
    queries: { startedMs: 0, endedMs: 0 },
    shutdown: { startedMs: 0, endedMs: 0 },
  };
  try {
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    if (!cases.length) throw new Error('Benchmark requires measured queries');
    requirePreparedCatalog(solver.config, catalog, warmupCases);
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
    const warmupResults = await Promise.all(
      warm.map(async (result, i) => ({
        id: warmupCases[i].id,
        ...summarize(result, await evaluate(warmupCases[i].query, result)),
      })),
    );
    const warmup = {
      ids: warmupCases.map((item) => item.id),
      wallMs: performance.now() - warmupStarted,
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
      results: ({ id: string } & ReturnType<typeof summarize>)[];
    }[] = [];
    for (let round = 0; round < rounds; round++) {
      const started = performance.now();
      const setupBefore = recoverySetup();
      const batch = await solver.solveBatch(cases.map((item) => item.query));
      // Recovery is separately explained, and remains in actual batch wall time.
      const wallMs = performance.now() - started;
      const recoverySetupMs = recoverySetup() - setupBefore;
      if (batch.length !== cases.length)
        throw new Error('Batch returned a different number of results');
      samples.push({
        wallMs,
        recoverySetupMs,
        results: await Promise.all(
          batch.map(async (result, i) => ({
            id: cases[i].id,
            ...summarize(result, await evaluate(cases[i].query, result)),
          })),
        ),
      });
    }
    intervals.queries.endedMs = performance.now();
    const first = samples[0].results;
    const results = samples.at(-1)!.results.map((row, i) => ({
      ...row,
      timedOut: samples.some((sample) => sample.results[i].timedOut),
      wallSamplesMs: samples.map((sample) => sample.results[i].wallMs ?? null),
      sameOutcomeAcrossRounds: samples.every(
        (sample) => sample.results[i].outcomeSha256 === first[i].outcomeSha256,
      ),
      sameTruncationAcrossRounds: samples.every(
        (sample) => sample.results[i].truncated === first[i].truncated,
      ),
    }));
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
      querySloMs: QUERY_SLO_MS,
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
