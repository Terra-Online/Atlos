import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';

import { gangliaV1Defaults, type SolverConfig } from '@opendfieldmap/ganglia';

import { benchmarkMarkdown } from '#@/bench/markdown.ts';
import { compareQuality, qualityGate, readReference, summarizeQuality } from '#@/bench/quality.ts';
import { runBenchmark, validateWarmup } from '#@/bench/run.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { sourceHash } from '#@/bench/source.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { readWorkload } from '#@/bench/workload.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    markdown: { type: 'boolean' },
    help: { type: 'boolean' },
    'data-root': { type: 'string' },
    scene: { type: 'string', default: 'map02' },
    extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
    concurrency: { type: 'string' },
    workers: { type: 'string', default: '1' },
    rounds: { type: 'string', default: '1' },
    config: { type: 'string' },
    reference: { type: 'string' },
    limit: { type: 'string' },
    offset: { type: 'string' },
    'catalog-train': { type: 'string' },
    workload: { type: 'string' },
    'warmup-workload': { type: 'string' },
    'max-mean-cost-ratio': { type: 'string', default: '1.01' },
    'max-worst-cost-ratio': { type: 'string', default: '1.05' },
  },
});
if (values.help) {
  console.log(
    'Usage: pnpm benchmark:full [--json | --markdown] [--data-root <path>] [--scene <name; default map02>] [--extractor <path>] [--workload <json-file | map02-long-range | map02-long-detours | map02-stress>] [--offset <index>] [--catalog-train <count; opt-in approximate static-action algorithm>] [--limit <count>] [--concurrency <scene-lanes>] [--workers <prepared solver processes; default 1>] [--rounds <measured batches; default 1>] [--config <json-file>] [--reference <benchmark-json>] [--max-mean-cost-ratio <ratio; default 1.01>] [--max-worst-cost-ratio <ratio; default 1.05>]. Every query has a hard 300-second SLO; timeouts count as failures. Reference comparisons reject lost solutions or excess modeled route cost; stability is checked across measured rounds. --warmup-workload <json-file> supplies disjoint runtime warmup queries; omitted means no runtime warmup.',
  );
  console.log('GANGLIA_BENCHMARK_HEAP_MB sets the Node heap cap in MiB (default 6144).');
} else {
  try {
    if (values.json && values.markdown) throw new Error('Choose --json or --markdown');
    const rounds = Number(values.rounds);
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    const limits = {
      geometricMeanCostRatio: Number(values['max-mean-cost-ratio']),
      worstCostRatio: Number(values['max-worst-cost-ratio']),
    };
    qualityGate([], undefined, limits);
    const sourceSha256 = await sourceHash(root, ['src', 'bench']);
    const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      cwd: root,
    }).trim();
    const workingTreeDirty = Boolean(
      execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {
        encoding: 'utf8',
        cwd: root,
      }).trim(),
    );
    const { cases: workload, directory } = await readWorkload(values.workload);
    const dataRoot = values['data-root'] ?? resolve(root, '../../../.local/data', directory);
    const offset = Number(values.offset ?? 0),
      count = Number(values.limit ?? workload.length);
    if (
      !Array.isArray(workload) ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      offset + count > workload.length
    )
      throw new Error('Invalid workload, offset or query limit');
    const trainingCount =
      values['catalog-train'] === undefined ? 0 : Number(values['catalog-train']);
    if (
      !Number.isSafeInteger(trainingCount) ||
      trainingCount < 0 ||
      (values['catalog-train'] !== undefined &&
        (trainingCount === 0 || values.offset === undefined || offset < trainingCount))
    )
      throw new Error(
        'Catalog training requires a positive count and explicit holdout offset at least that count',
      );
    const training = workload.slice(0, trainingCount);
    const selected = workload.slice(offset, offset + count);
    const warmupCases = values['warmup-workload']
      ? (await readWorkload(values['warmup-workload'])).cases
      : [];
    validateWarmup(selected, warmupCases);
    if (trainingCount) {
      const trainingStarts = new Set(
        training.flatMap((item) =>
          item.query.starts.map((start) => JSON.stringify(start.position)),
        ),
      );
      if (
        selected.some((item) =>
          item.query.starts.some((start) => trainingStarts.has(JSON.stringify(start.position))),
        )
      )
        throw new Error('Catalog holdout starts must be absent from training');
    }
    if (new Set(selected.map((item) => item.id)).size !== selected.length)
      throw new Error('Duplicate workload query id');
    const config: SolverConfig = values.config
      ? JSON.parse(await readFile(values.config, 'utf8'))
      : { ...gangliaV1Defaults };
    const workers = Number(values.workers);
    if (!Number.isSafeInteger(workers) || workers < 1) throw new Error('Invalid worker count');
    const concurrency =
      values.concurrency === undefined
        ? values.config
          ? config.batchConcurrency
          : Math.max(config.batchConcurrency, workers)
        : Number(values.concurrency);
    if (!Number.isSafeInteger(concurrency) || concurrency < 1)
      throw new Error('Invalid concurrency');
    const fixed = { ...config, batchConcurrency: concurrency };
    const measurement = {
      warmupCases,
      rounds,
      workers,
      concurrency,
      trainingCases: training,
    };
    const referenceBytes = values.reference ? await readFile(values.reference) : undefined;
    const referenceReport = referenceBytes
      ? (JSON.parse(referenceBytes.toString()) as {
          schemaVersion?: number;
          measurement?: unknown;
          batch: { wallMs: number };
          lifecycle?: { endToEndMs: number };
        })
      : undefined;
    const started = performance.now();
    const prepared = await prepareWorkerSolver({
      count: workers,
      config: fixed,
      dataRoot,
      extractor: values.extractor,
      scene: values.scene,
    });
    const { solver, inputLoadMs, timings, metadata } = prepared;
    const workerReadyMs = performance.now();
    try {
      const reference = referenceBytes
        ? readReference(JSON.parse(referenceBytes.toString()), { ...metadata, cases: selected })
        : undefined;
      // Reject incompatible references before spending time on prewarm and search.
      let catalogTraining;
      if (trainingCount) {
        console.error(JSON.stringify({ phase: 'catalog-training', queries: training.length }));
        await prepared.setCatalogPhase('training');
        const trainingStarted = performance.now();
        const results = await prepared.train(training.map((item) => item.query));
        await prepared.setCatalogPhase('frozen');
        catalogTraining = {
          algorithm: 'approximate-static-actions' as const,
          ids: training.map((item) => item.id),
          wallMs: performance.now() - trainingStarted,
          completed: Math.min(
            ...results.map(
              (rows) =>
                rows.filter((result) => result.route.status === 'complete' && !result.partial)
                  .length,
            ),
          ),
          perWorker: results.map((rows, index) => ({
            completed: rows.filter(
              (result) => result.route.status === 'complete' && !result.partial,
            ).length,
            stats: prepared.catalogStatsAll()[index],
          })),
          stats: prepared.catalogStats(),
        };
      }
      const readyMs = performance.now();
      const setupMs = readyMs - started;
      const report = await runBenchmark(
        solver,
        selected,
        async (phase) => {
          console.error(
            JSON.stringify({
              phase,
              queries: phase === 'prewarm' ? warmupCases.length : selected.length,
              rounds,
            }),
          );
          await prepared.setBenchmarkPhase(phase);
          if (phase === 'batch') {
            resetTimings(timings);
          }
        },
        rounds,
        () => prepared.recoverySetupMs,
        warmupCases,
      );
      const endToEndMs = performance.now();
      if (
        catalogTraining &&
        !prepared.recoverySetupMs &&
        prepared
          .catalogStatsAll()
          .some((stats, index) => stats.added !== catalogTraining.perWorker[index].stats.added)
      )
        throw new Error('Frozen catalog changed during holdout');
      if ((await sourceHash(root, ['src', 'bench'])) !== sourceSha256)
        throw new Error('Benchmark source changed during measurement; discard this run');
      const comparison = reference ? compareQuality(report.batch.results, reference) : undefined;
      const gate = qualityGate(report.batch.results, comparison, limits);
      const comparableSpeed =
        comparison &&
        !comparison.lostSolutions.length &&
        !comparison.gainedSolutions.length &&
        summarizeQuality(reference ?? []).completed === selected.length &&
        report.batch.quality.completed === selected.length;
      const comparablePolicy =
        gate.passed &&
        comparableSpeed &&
        referenceReport?.schemaVersion === 8 &&
        isDeepStrictEqual(referenceReport.measurement, measurement);
      const referenceBatchMs = referenceReport?.batch.wallMs;
      const referenceEndToEndMs = referenceReport?.lifecycle?.endToEndMs;
      const output = {
        schemaVersion: 8,
        measurement,
        lifecycle: {
          workerReadyMs,
          readyMs,
          workerStartupMs: timings.workerStartupMs,
          workers: metadata.execution.preparation,
          runtimeWarmupMs: report.warmup.wallMs,
          catalogTrainingMs: catalogTraining?.wallMs ?? 0,
          endToEndMs,
          successfulQueries: report.batch.successfulQueries,
          endToEndSuccessfulQueriesPerSecond: report.batch.successfulQueries / (endToEndMs / 1000),
          browserArtifacts: null,
        },
        adapter: 'scene-files',
        node: process.version,
        execArgv: process.execArgv,
        revision,
        sourceSha256,
        workingTreeDirty,
        ...metadata,
        concurrency,
        cases: selected,
        inputLoadMs,
        setupMs,
        timings,
        ...(catalogTraining
          ? {
              catalogTraining,
              catalogAfterHoldout: prepared.catalogStatsAll(),
              catalogResetDuringHoldout: prepared.recoverySetupMs > 0,
            }
          : {}),
        policy:
          'One algorithm and preparation lifecycle serve every interpretation of this report. Decoded input loading is separate from adapter/source validation, resource indexing and factory preparation. Declared catalog training runs identically in every worker, freezes before service readiness, and belongs to service preparation. Runtime warmup is optional and uses a separate disjoint workload. No scored query is prewarmed; every measured round counts and repeatability compares measured rounds. Existing immutable preparation, geometry proofs and frozen catalog data are reused by the same solver; lazy work remains inside query time. Every dispatched query, including training and warmup, has a 300,000 ms parent watchdog. Queueing and initial worker setup are outside that deadline; service, queue and response times are separate. Recovery remains in actual batch wall time. End-to-end time starts at Node process time origin and ends after solver shutdown, including loading, preparation, training, runtime warmup, all measured rounds and recovery. Final source re-verification and report formatting are excluded. Per-worker phase timers overlap and must not be summed into wall time. Memory peaks are sampled. Browser index transfer, restoration and browser execution are unmeasured. OS scheduling/JIT/GC uncontrolled.',
        ...report,
        ...(comparison && referenceBytes
          ? {
              comparison: {
                referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
                ...(comparablePolicy &&
                referenceBatchMs !== undefined &&
                Number.isFinite(referenceBatchMs) &&
                referenceBatchMs > 0
                  ? { batchSpeedup: referenceBatchMs / report.batch.wallMs }
                  : {}),
                ...(comparablePolicy &&
                referenceEndToEndMs !== undefined &&
                Number.isFinite(referenceEndToEndMs) &&
                referenceEndToEndMs > 0
                  ? { endToEndSpeedup: referenceEndToEndMs / endToEndMs }
                  : {}),
                ...comparison,
              },
            }
          : {}),
      };
      const validated = { ...output, qualityGate: gate };
      if (values.json) console.log(JSON.stringify(validated, null, 2));
      else if (values.markdown) console.log(benchmarkMarkdown(validated));
      else {
        console.log(
          `${metadata.scene}: ${selected.length} full-scene queries; local files, no Atlos server`,
        );
        console.table(report.batch.results);
        if (catalogTraining)
          console.log(
            `Approximate static-action training: ${catalogTraining.ids.length} queries, ${(catalogTraining.wallMs / 1000).toFixed(2)} s included in end-to-end time, ${catalogTraining.stats.added} actions`,
          );
        console.log(
          `Independent runtime warmup: ${report.warmup.ids.length} queries, ${(report.warmup.wallMs / 1000).toFixed(2)} s`,
        );
        console.log(
          `Ready at ${(readyMs / 1000).toFixed(2)} s; end-to-end ${(endToEndMs / 1000).toFixed(2)} s; ${output.lifecycle.endToEndSuccessfulQueriesPerSecond.toFixed(3)} end-to-end complete routes/s`,
        );
        console.log(
          `Per-query SLO: ${QUERY_SLO_MS / 1000} s; ${report.batch.quality.completed}/${selected.length} complete, ${report.batch.timedOutAttempts} measured timeouts; ${report.batch.successfulQueriesPerSecond.toFixed(3)} complete routes/s`,
        );
        console.log(
          `Recovery input loading: ${(report.batch.recoverySetupMs / 1000).toFixed(2)} s; included in batch wall time`,
        );
        console.log(
          `Batch (${rounds} rounds, average ${report.batch.wallMs.toFixed(3)} ms, total ${report.batch.totalWallMs.toFixed(3)} ms): ${report.batch.queriesPerSecond.toFixed(3)} queries/s; ${report.batch.results.filter((r) => r.sameOutcomeAcrossRounds && r.sameTruncationAcrossRounds).length}/${selected.length} matching outcomes; repeatability ${report.batch.repeatability}`,
        );
        console.log(`Complete batch samples (ms): ${report.batch.wallSamplesMs.join(', ')}`);
        if (report.batch.meanSerialQueryMs !== undefined)
          console.log(
            `Mean serial attempt wall time: ${report.batch.meanSerialQueryMs.toFixed(3)} ms (mean dispatch-to-result)`,
          );
        console.log(
          `Quality: ${report.batch.quality.completed}/${selected.length} complete; total modeled travel time: ${report.batch.quality.totalCostSeconds ?? 'incomplete'} s`,
        );
        if (output.comparison) {
          console.log(
            `Reference: ${output.comparison.pairedCompleted} paired completions; lost ${output.comparison.lostSolutions.length}; gained ${output.comparison.gainedSolutions.length}; geometric mean cost ratio ${output.comparison.geometricMeanCostRatio ?? 'unavailable'}; worst ${output.comparison.worstCostRatio ?? 'unavailable'} (lower is better)`,
          );
          console.table(output.comparison.pairs);
        }
        console.log(output.policy);
      }
      if (!gate.passed) {
        console.error(`Benchmark quality gate failed: ${gate.failures.join('; ')}`);
        process.exitCode = 1;
      }
    } finally {
      await solver.close();
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
