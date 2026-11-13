import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';

import type { PreparedRouteSolver, RouteQuery, RouteResult } from '@opendfieldmap/ganglia';

import { summarizeQuality } from '#@/bench/quality.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  return {
    status: result.route.status,
    partial: result.partial === true,
    reason: result.reason ?? null,
    cost: complete?.cost ?? null,
    length: complete?.length ?? null,
    jumps: complete?.segments?.filter((segment) => segment.mode === 'jump').length ?? 0,
    drops: complete?.segments?.filter((segment) => segment.mode === 'drop').length ?? 0,
    truncated: result.diagnostics.truncated,
    timedOut: result.reason === 'timeout' || (wallMs !== undefined && wallMs > QUERY_SLO_MS),
    ...(wallMs === undefined ? {} : { wallMs }),
    outcomeSha256: digest(outcome(result)),
  };
};

// Takes ownership of the prepared solver and closes it even if a batch fails.
// Warm and measured passes submit the whole workload; neither pass drives solve().
export async function runBenchmark(
  solver: PreparedRouteSolver,
  cases: readonly { id: string; query: RouteQuery }[],
  onPhase?: (phase: 'prewarm' | 'batch') => void | Promise<void>,
  rounds = 1,
  excludedSetupMs = () => 0,
) {
  const queries = cases.map((item) => item.query);
  try {
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    await onPhase?.('prewarm');
    let started = performance.now();
    let setupBefore = excludedSetupMs();
    const warm = await solver.solveBatch(queries);
    const prewarmRecoverySetupMs = excludedSetupMs() - setupBefore;
    const prewarmMs = performance.now() - started - prewarmRecoverySetupMs;
    if (warm.length !== cases.length)
      throw new Error('Prewarm returned a different number of results');
    await onPhase?.('batch');
    const wallSamplesMs: number[] = [];
    const samples: {
      wallMs: number;
      recoverySetupMs: number;
      results: ({ id: string } & ReturnType<typeof summarize>)[];
    }[] = [];
    const stable = cases.map(() => ({ outcome: true, truncation: true }));
    let batch: readonly RouteResult[] = [];
    for (let round = 0; round < rounds; round++) {
      started = performance.now();
      setupBefore = excludedSetupMs();
      batch = await solver.solveBatch(queries);
      const recoverySetupMs = excludedSetupMs() - setupBefore;
      const wallMs = performance.now() - started - recoverySetupMs;
      wallSamplesMs.push(wallMs);
      if (batch.length !== cases.length)
        throw new Error('Batch returned a different number of results');
      samples.push({
        wallMs,
        recoverySetupMs,
        results: batch.map((result, i) => ({ id: cases[i].id, ...summarize(result) })),
      });
      batch.forEach((result, i) => {
        stable[i].outcome =
          isDeepStrictEqual(outcome(result), outcome(warm[i])) && stable[i].outcome;
        stable[i].truncation =
          result.diagnostics.truncated === warm[i].diagnostics.truncated && stable[i].truncation;
      });
    }
    const results = batch.map((result, i) => ({
      id: cases[i].id,
      ...summarize(result),
      // A later successful round cannot erase an earlier SLO failure.
      timedOut: samples.some((sample) => sample.results[i].timedOut),
      wallSamplesMs: samples.map((sample) => sample.results[i].wallMs ?? null),
      sameOutcomeAsPrewarm: stable[i].outcome,
      sameTruncationAsPrewarm: stable[i].truncation,
    }));
    const totalWallMs = wallSamplesMs.reduce((sum, sample) => sum + sample, 0);
    // Keep the reference metric comparable to a single complete workload batch.
    const wallMs = totalWallMs / rounds;
    const successfulQueries = samples.reduce(
      (sum, sample) => sum + summarizeQuality(sample.results).completed,
      0,
    );
    return {
      config: solver.config,
      querySloMs: QUERY_SLO_MS,
      prewarmMs,
      prewarmRecoverySetupMs,
      prewarmQuality: summarizeQuality(
        warm.map((result, i) => ({ id: cases[i].id, ...summarize(result) })),
      ),
      batch: {
        rounds,
        wallSamplesMs,
        totalWallMs,
        wallMs,
        recoverySetupMs: samples.reduce((sum, sample) => sum + sample.recoverySetupMs, 0),
        samples,
        successfulQueries,
        timedOutAttempts: samples.reduce(
          (sum, sample) => sum + sample.results.filter((row) => row.timedOut).length,
          0,
        ),
        successfulQueriesPerSecond: successfulQueries / (totalWallMs / 1000),
        queriesPerSecond: (rounds * cases.length) / (totalWallMs / 1000),
        ...(solver.config.batchConcurrency === 1
          ? { meanSerialQueryMs: wallMs / cases.length }
          : {}),
        quality: summarizeQuality(results),
        results,
      },
    };
  } finally {
    await solver.close();
  }
}
