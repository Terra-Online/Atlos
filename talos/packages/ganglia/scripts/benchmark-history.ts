/** Reproduce the pre-physical-execution TS solver with the 4ec7b65f measurement
 * contract and current worker lifecycle. The physical audit remains explicit
 * and independent of this historical completion/cost gate. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs } from 'node:util';

import { loadScene } from '#@/bench/adapters/ganglia-v1/scene.ts';
import { compareQuality, qualityGate } from '#@/bench/quality.ts';
import { cases, preparation } from '#@/bench/scenes/map02.ts';
import { sourceHash } from '#@/bench/source.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { runBenchmark } from '#@/scripts/history-runner.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

const { values } = parseArgs({
  options: {
    'data-root': { type: 'string' },
    extractor: { type: 'string' },
    output: { type: 'string' },
    reference: { type: 'string' },
    rounds: { type: 'string', default: '1' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Usage: pnpm benchmark:history --output <report.json> [--data-root <path>] [--extractor <path>] [--reference <historical-report.json>]. Pure TS; 10 training requests, two warmups, all 50 map02 requests; --rounds defaults to 1. Physical audit is reported separately.',
  );
} else {
  const rounds = Number(values.rounds);
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
  if (!values.output) throw new Error('--output is required');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const output = resolve(values.output);
  const dataRoot = resolve(values['data-root'] ?? resolve(root, '../../../.local/data'));
  const extractor = resolve(values.extractor ?? resolve(root, '../../.cache/noclip'));
  mkdirSync(dirname(output), { recursive: true });
  const journal = output + '.events.jsonl';
  writeFileSync(journal, '', { flag: 'wx' });
  const save = (value: unknown) => {
    writeFileSync(output + '.tmp', JSON.stringify(value, null, 2) + '\n');
    renameSync(output + '.tmp', output);
  };
  const began = performance.now();
  const sourceSha256 = await sourceHash(root, ['src', 'bench', 'scripts']);
  const config = {
    ...gangliaV1Defaults,
    algorithm: 'ganglia-v1-ts' as const,
    preparation: {
      trainingQueries: 10,
      warmupQueries: 2,
      catalogCandidates: 8000,
      catalogLinks: 64,
    },
  };
  let phase = 'setup',
    completed = 0;
  const prepared = await prepareWorkerSolver({
    count: 1,
    config,
    dataRoot,
    extractor,
    scene: 'map02',
    onResult(query, result) {
      appendFileSync(journal, JSON.stringify({ phase, query, result }) + '\n');
      console.error(
        JSON.stringify({
          phase,
          completed: ++completed,
          status: result.route.status,
          reason: result.reason,
          wallMs: result.diagnostics.solveWallMs,
        }),
      );
    },
  });
  try {
    phase = 'training';
    await prepared.setCatalogPhase('training');
    const trainingStarted = performance.now();
    const trained = await prepared.train(preparation.training.map((item) => item.query));
    if (trained.some((rows) => rows.some((result) => result.reason === 'timeout')))
      throw new Error('Training timed out');
    await prepared.setCatalogPhase('frozen');
    const catalogTraining = {
      algorithm: 'approximate-static-actions',
      ids: preparation.training.map((item) => item.id),
      wallMs: performance.now() - trainingStarted,
      completed: trained[0].filter(
        (result) => result.route.status === 'complete' && !result.partial,
      ).length,
      stats: prepared.catalogStats(),
    };
    let readyMs = 0;
    const report = await runBenchmark(
      prepared.solver,
      cases,
      async (next) => {
        phase = next;
        completed = 0;
        await prepared.setBenchmarkPhase(next);
        if (next === 'batch') readyMs = performance.now() - began;
      },
      rounds,
      () => prepared.recoverySetupMs,
      preparation.warmup,
    );
    const endToEndMs = performance.now() - began;
    const reference = values.reference
      ? JSON.parse(readFileSync(resolve(values.reference), 'utf8'))
      : undefined;
    if (
      reference &&
      !isDeepStrictEqual(
        reference.cases.map((item: { query: RouteQuery }) => item.query),
        cases.map((item) => item.query),
      )
    )
      throw new Error('Historical reference queries differ');
    const comparison = reference
      ? compareQuality(report.batch.results, reference.batch.results)
      : undefined;
    const base = {
      schemaVersion: 8,
      measurement: 'historical-completion-cost-repeatability',
      bindings: {
        restoredSolverFile: { revision: 'd35e4997', path: 'src/v1/solver/physical/prepared.ts' },
        frameworkCore: '4ec7b65f',
        frameworkSha256: createHash('sha256')
          .update(readFileSync(new URL('./history-runner.ts', import.meta.url)))
          .digest('hex'),
      },
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
      sourceSha256,
      workingTreeDirty:
        execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim() !==
        '',
      node: process.version,
      execArgv: process.execArgv,
      adapter: 'historical-ts',
      concurrency: 1,
      ...prepared.metadata,
      cases,
      catalogTraining,
      catalogAfter: prepared.catalogStats(),
      lifecycle: {
        readyMs,
        endToEndMs,
        endToEndSuccessfulQueriesPerSecond: report.batch.successfulQueries / (endToEndMs / 1000),
      },
      ...report,
      qualityGate: qualityGate(report.batch.results, undefined),
      ...(comparison
        ? {
            historicalCostComparison: {
              reference: reference.revision,
              comparison,
              adapterMatches: reference.gameAdapterSha256 === prepared.metadata.gameAdapterSha256,
              inputHashesMatch: isDeepStrictEqual(
                Object.values(reference.hashes).sort(),
                Object.values(prepared.metadata.hashes).sort(),
              ),
              costGate: qualityGate(report.batch.results, comparison, {
                geometricMeanCostRatio: 1.01,
                worstCostRatio: 1.05,
              }),
            },
          }
        : {}),
    };
    save(base);
    // Replay saved submissions after solver shutdown. The audit normalizes source
    // facts and executes the independent evaluator without invoking V1 search.
    phase = 'physical-audit';
    completed = 0;
    const auditStarted = performance.now();
    const rows = readFileSync(journal, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { phase: string; query: RouteQuery; result: RouteResult })
      .filter((row) => row.phase === 'batch')
      .slice(0, cases.length);
    const scene = await loadScene(dataRoot, extractor, 1, 'map02');
    const results = [];
    for (const [index, row] of rows.entries()) {
      const evaluation = await scene.verify(row.query, row.result.route);
      results.push({ id: cases[index].id, evaluation });
      console.error(
        JSON.stringify({
          phase,
          completed: ++completed,
          valid: evaluation.valid,
          issues: evaluation.issues,
        }),
      );
    }
    save({
      ...base,
      physicalAudit: {
        scope: 'physical',
        roundsAudited: 1,
        wallMs: performance.now() - auditStarted,
        results,
      },
      endToEndIncludingAuditMs: performance.now() - began,
    });
    console.log(
      JSON.stringify({
        qualityGate: base.qualityGate,
        meanSerialQueryMs: report.batch.meanSerialQueryMs,
        successfulQueries: report.batch.successfulQueries,
        readyMs,
        endToEndMs,
        physicalAuditValid: results.filter((row) => row.evaluation.valid).length,
      }),
    );
    if (!base.qualityGate.passed || base.historicalCostComparison?.costGate.passed === false)
      process.exitCode = 1;
  } finally {
    await prepared.solver.close();
  }
}
