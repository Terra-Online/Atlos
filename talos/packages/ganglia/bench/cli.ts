/**
 * Full-scene CLI and report projection. Scene construction and typed
 * training/query execution are shared with mechanism suites. Warmup fields remain
 * empty for report readers; the first query after training is measured. Worker
 * and concurrency flags retain their existing explicit throughput semantics.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { loadAdapter } from '#@/bench/adapter.ts';
import {
  captureScenario,
  finishScenario,
  measuredAttempt,
  selectedCase,
  type BenchmarkRun,
  type ScenarioResult,
} from '#@/bench/benchmark-run.ts';
import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { benchmarkMarkdown } from '#@/bench/markdown.ts';
import { benchmarkTraining } from '#@/bench/preparation.ts';
import { compareQuality, qualityGate, readReference, summarizeQuality } from '#@/bench/quality.ts';
import { runScenario } from '#@/bench/run.ts';
import { sourceHash } from '#@/bench/source.ts';
import { resetTimings } from '#@/bench/timings.ts';
import { readWorkload, sceneBuilder, sceneSuite } from '#@/bench/workload.ts';
import type { SolverSettings } from '#@/src/solver/contract.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    json: { type: 'boolean' },
    output: { type: 'string' },
    markdown: { type: 'boolean' },
    help: { type: 'boolean' },
    adapter: { type: 'string' },
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
    workload: { type: 'string' },
    'max-mean-cost-ratio': { type: 'string', default: '1.01' },
    'max-worst-cost-ratio': { type: 'string', default: '1.05' },
  },
});
if (values.help) {
  console.log(
    'Usage: pnpm benchmark:full [--adapter ganglia-v1-ts|ganglia-v1-rust|<module-path>] [--json | --markdown] [--data-root <path>] [--scene <name; default map02>] [--extractor <path>] [--workload <json-file | map02-long-range | map02-long-detours | map02-stress>] [--offset <index>] [--limit <count>] [--concurrency <scene-lanes>] [--workers <prepared solver processes; default 1>] [--rounds <measured batches; default 1>] [--config <json-file>] [--reference <benchmark-json>] [--max-mean-cost-ratio <ratio; default 1.01>] [--max-worst-cost-ratio <ratio; default 1.05>]. At the configured benchmark cutoff a query receives a cooperative cancellation request; timeouts count as failures. Reference comparisons reject lost solutions or excess modeled route cost; stability is checked across measured rounds. V1 service preparation is required by its solver config and supplied by the benchmark adapter.',
  );
  console.log('GANGLIA_BENCHMARK_HEAP_MB sets the Node heap cap in MiB (default 6144).');
  console.log(
    'GANGLIA_BENCHMARK_QUERY_CUTOFF_MS sets the cooperative per-query cutoff in milliseconds (default 60000).',
  );
} else {
  const outputPath = values.output
    ? resolve(values.output)
    : join(mkdtempSync(join(tmpdir(), 'ganglia-benchmark-')), 'report.json');
  mkdirSync(dirname(outputPath), { recursive: true });
  const eventsPath = `${outputPath}.events.jsonl`;
  // A new invocation owns a new journal. Never append to evidence from another run.
  writeFileSync(eventsPath, '', { flag: 'wx' });
  const record = (event: unknown) => appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
  const save = (report: unknown) => {
    writeFileSync(`${outputPath}.tmp`, JSON.stringify(report, null, 2));
    renameSync(`${outputPath}.tmp`, outputPath);
  };
  let phase = 'setup';
  let completed = 0;
  let benchmarkRun: BenchmarkRun | undefined;
  console.error(JSON.stringify({ phase: 'artifacts', report: outputPath, events: eventsPath }));
  record({ phase, state: 'started', at: new Date().toISOString(), argv: process.argv.slice(2) });
  try {
    const adapter = await loadAdapter(values.adapter);
    if (values.json && values.markdown) throw new Error('Choose --json or --markdown');
    const rounds = Number(values.rounds);
    if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('Invalid benchmark rounds');
    const limits = {
      geometricMeanCostRatio: Number(values['max-mean-cost-ratio']),
      worstCostRatio: Number(values['max-worst-cost-ratio']),
    };
    qualityGate([], undefined, limits);
    const sourceDirectories = ['src', 'bench', 'crates/ganglia-v1/src'];
    const sourceFiles = ['crates/ganglia-v1/Cargo.toml', 'crates/ganglia-v1/Cargo.lock'];
    const sourceSha256 = await sourceHash(root, sourceDirectories, sourceFiles);
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
    const { cases: workload, directory, suiteId } = await readWorkload(values.workload);
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
    const selected = workload.slice(offset, offset + count);
    if (new Set(selected.map((item) => item.id)).size !== selected.length)
      throw new Error('Duplicate workload query id');
    const policy: SolverSettings = {
      ...adapter.defaults,
      ...(values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {}),
    };
    const config = {
      ...policy,
      ...(values.adapter === 'ganglia-v1-ts' || values.adapter === 'ganglia-v1-rust'
        ? { algorithm: values.adapter }
        : {}),
    };
    const training = benchmarkTraining(config, adapter, values.scene);
    const warmupCases: readonly import('#@/bench/suite.ts').Case[] = [];
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
      queryCutoffMs: QUERY_CUTOFF_MS,
      cancellation: 'cooperative-checkpoints',
      warmupCases,
      rounds,
      workers,
      concurrency,
      trainingCases: training,
      lifecycle: 'suite-training-no-warmup',
    };
    const sceneResult: ScenarioResult = {
      scenarioId: values.scene,
      setup: { scene: values.scene },
      initialInput: null,
      inputChanged: false,
      training: [],
      cases: selected.map(selectedCase),
    };
    benchmarkRun = {
      benchmarkId: 'full',
      suiteId,
      gitRevision: revision,
      solverId: fixed.algorithm,
      solverSettings: z.record(z.string(), z.json()).parse(fixed),
      state: { kind: 'running' },
      measurement: {
        cutoffMs: QUERY_CUTOFF_MS,
        rounds,
        scenarioWorkers: 1,
        solverWorkers: workers,
        queryConcurrency: Math.min(workers, concurrency),
        dispatch: 'batch',
        timing: 'worker-dispatch-to-result',
        warmupQueries: [],
      },
      scenarios: [sceneResult],
    };
    const referenceBytes = values.reference ? await readFile(values.reference) : undefined;
    const referenceReport = referenceBytes
      ? (JSON.parse(referenceBytes.toString()) as {
          measurement?: unknown;
          batch: { wallMs: number };
          lifecycle?: { solverLifecycleMs: number };
        })
      : undefined;
    const started = performance.now();
    const builder = sceneBuilder({
      adapter,
      config: fixed,
      extractor: values.extractor,
      workers,
      measured: new Set(selected.map((item) => item.id)),
      onResult(query, result) {
        record({ phase, query, result });
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
    const scenarios = builder.build(
      { root: dataRoot },
      sceneSuite(values.scene, selected, training),
    );
    for await (const scenario of scenarios) {
      const prepared = scenario.input;
      const { inputLoadMs, timings, metadata } = prepared;
      const workerReadyMs = performance.now();
      try {
        const cases = captureScenario(sceneResult, scenario, dataRoot);
        const reference = referenceBytes
          ? readReference(JSON.parse(referenceBytes.toString()), { ...metadata, cases: selected })
          : undefined;
        // Reject incompatible references before training and search.
        let catalogTraining:
          | {
              algorithm: 'approximate-static-actions';
              ids: string[];
              processed: number;
              wallMs: number;
              completed: number;
              perWorker: { completed: number; stats: import('#@/bench/adapter.ts').CatalogStats }[];
              stats: import('#@/bench/adapter.ts').CatalogStats;
            }
          | undefined;
        let readyMs = 0;
        let setupMs = 0;
        const report = await runScenario(scenario, {
          rounds,
          serial: false,
          onPhase: async (nextPhase) => {
            phase = nextPhase === 'training' ? 'catalog-training' : nextPhase;
            completed = 0;
            if (nextPhase === 'batch') {
              readyMs = performance.now();
              setupMs = readyMs - started;
              resetTimings(timings);
            }
          },
          onTrainingResult(item, index, results) {
            record({
              phase: 'catalog-training-progress',
              id: item.id,
              completed: index + 1,
              total: training.length,
              outcomes: results.map((result) => result.reason ?? result.route.status),
            });
            if (results.some((result) => result.reason === 'timeout'))
              throw new Error('Catalog training timed out; prepared service is not ready');
          },
          onReady(kernel) {
            const trained = kernel.training;
            if (training.length && trained.perWorker.every((worker) => worker.stats)) {
              const perWorker = trained.perWorker.map((worker) => ({
                completed: worker.results.filter((r) => r.route.status === 'complete' && !r.partial)
                  .length,
                stats: worker.stats!,
              }));
              catalogTraining = {
                algorithm: 'approximate-static-actions',
                ids: [...trained.ids],
                processed: trained.ids.length,
                wallMs: trained.wallMs,
                completed: Math.min(...perWorker.map((worker) => worker.completed)),
                perWorker,
                stats: perWorker[0].stats,
              };
            }
          },
          onResult(item, result, verification) {
            cases.get(item.id)!.attempts.push(measuredAttempt(result, verification.verification));
          },
        });
        const endToEndMs = performance.now();
        finishScenario(sceneResult, scenario, dataRoot);
        const solverLifecycleMs = endToEndMs - report.verificationWallMs;
        const holdoutCatalogs = prepared.catalogs();
        if ((await sourceHash(root, sourceDirectories, sourceFiles)) !== sourceSha256)
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
          isDeepStrictEqual(referenceReport?.measurement, measurement);
        const timingUnavailableReason = !gate.passed
          ? 'Quality gate failed'
          : !comparableSpeed
            ? 'The set of complete routes changed'
            : !isDeepStrictEqual(referenceReport?.measurement, measurement)
              ? 'Preparation, warmup or execution settings differ from the reference'
              : undefined;
        const referenceBatchMs = referenceReport?.batch.wallMs;
        const referenceSolverLifecycleMs = referenceReport?.lifecycle?.solverLifecycleMs;
        benchmarkRun.state = { kind: 'finished' };
        const output = {
          benchmarkRun,
          measurement,
          lifecycle: {
            workerReadyMs,
            readyMs,
            workerStartupMs: timings.workerStartupMs,
            workers: metadata.execution.preparation,
            runtimeWarmupMs: report.warmup.wallMs,
            catalogTrainingMs: catalogTraining?.wallMs ?? 0,
            endToEndMs,
            solverLifecycleMs,
            successfulQueries: report.batch.successfulQueries,
            solverLifecycleSuccessfulQueriesPerSecond:
              report.batch.successfulQueries / (solverLifecycleMs / 1000),
            endToEndSuccessfulQueriesPerSecond:
              report.batch.successfulQueries / (endToEndMs / 1000),
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
                catalogAfterHoldout: holdoutCatalogs.every((stats) => stats !== undefined)
                  ? holdoutCatalogs
                  : undefined,
                catalogResetDuringHoldout: prepared.recoverySetupMs > 0,
              }
            : {}),
          policy:
            'One run-level configuration is reused. Suite-declared catalog training runs identically in every worker and freezes before measurement. There is no runtime warmup; the first post-training query and every measured round count. Decoded input loading is separate from adapter/source validation, resource indexing and factory preparation. Repeatability compares measured rounds. Existing immutable preparation, geometry proofs and frozen catalog data are reused by the same solver; lazy work remains inside query time. Every dispatched query, including training, receives a cooperative cancellation request at the configured benchmark cutoff. The worker exits the query at its next checkpoint; no grace-period kill or replacement occurs. Cancellation tail time remains measured. Queueing and initial worker setup are outside that deadline; service, queue and response times are separate. Workers retain their trained state across query cancellation. End-to-end time starts at Node process time origin and ends after solver shutdown, including loading, preparation, training, all measured rounds and cooperative shutdown. Observed end-to-end time includes beta verification; solver lifecycle timing subtracts its non-overlapping wall intervals for comparisons. Final source re-verification and report formatting are excluded. Per-worker phase timers overlap and must not be summed into wall time. Memory peaks are sampled. Browser index transfer, restoration and browser execution are unmeasured. OS scheduling/JIT/GC uncontrolled.',
          ...report,
          ...(comparison && referenceBytes
            ? {
                comparison: {
                  referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
                  referenceBatchWallMs: referenceBatchMs,
                  referenceSolverLifecycleMs,
                  ...(comparablePolicy &&
                  referenceBatchMs !== undefined &&
                  Number.isFinite(referenceBatchMs) &&
                  referenceBatchMs > 0
                    ? { batchSpeedup: referenceBatchMs / report.batch.wallMs }
                    : {
                        batchSpeedupUnavailableReason:
                          timingUnavailableReason ?? 'Reference has no valid batch timing',
                      }),
                  ...(comparablePolicy &&
                  referenceSolverLifecycleMs !== undefined &&
                  Number.isFinite(referenceSolverLifecycleMs) &&
                  referenceSolverLifecycleMs > 0
                    ? { solverLifecycleSpeedup: referenceSolverLifecycleMs / solverLifecycleMs }
                    : {
                        solverLifecycleSpeedupUnavailableReason:
                          timingUnavailableReason ??
                          'Reference has no valid process-start-to-shutdown timing',
                      }),
                  ...comparison,
                },
              }
            : {}),
        };
        const validated = { ...output, qualityGate: gate };
        save(validated);
        record({ phase: 'finished', qualityGate: gate });
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
            `Per-query benchmark cutoff: ${QUERY_CUTOFF_MS / 1000} s; ${report.batch.quality.completed}/${selected.length} complete, ${report.batch.timedOutAttempts} measured timeouts; ${report.batch.successfulQueriesPerSecond.toFixed(3)} complete routes/s`,
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
        await scenario.close();
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (benchmarkRun) benchmarkRun.state = { kind: 'failed', reason: message };
    const failure = {
      benchmarkRun,
      state: 'interrupted',
      phase,
      error: message,
      events: eventsPath,
    };
    record(failure);
    save(failure);
    console.error(error);
    process.exitCode = 1;
  }
}
