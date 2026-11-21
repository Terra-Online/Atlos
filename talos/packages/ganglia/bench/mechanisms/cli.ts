import { execFileSync } from 'node:child_process';
/**
 * Mechanism CLI and report projection. Authored scenarios determine
 * sharing and ordered training; ID selection only filters measurement. Every
 * scenario uses the same run-level solver configuration. The shared runner owns
 * training, frozen queries, verification and cleanup. The CLI resolves input
 * bindings before starting workers and owns the report and run artifacts.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { expectation, matchesExpectation } from '#@/bench/mechanisms/assessment.ts';
import { readDataset, scenarioBindings, scenarioBuilder } from '#@/bench/mechanisms/dataset.ts';
import type { Binding } from '#@/bench/mechanisms/scenario.ts';
import { checkSetup, readSuite } from '#@/bench/mechanisms/suite.ts';
import { classify, type Status } from '#@/bench/outcome.ts';
import { recordRun } from '#@/bench/reporting/recorder.ts';
import { runScenario } from '#@/bench/run.ts';
import { sourceHash } from '#@/bench/source.ts';
import type { WorkerResult } from '#@/bench/workers.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: resolve(root, 'bench/scenes/mechanisms/suite.json') },
    'data-root': {
      type: 'string',
      default: resolve(root, '../../../.local/data/mechanisms-266-generated'),
    },
    extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
    'prepare-config': { type: 'string' },
    adapter: { type: 'string', default: 'ganglia-v1-rust' },
    ids: { type: 'string' },
    output: { type: 'string' },
    'scenario-workers': { type: 'string', default: '1' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Usage: node bench/mechanism-benchmark.ts --output <new-report.json> [--data-root <candidate-input-root>] [--prepare-config <private-game-config>] [--adapter ganglia-v1-rust|ganglia-v1-ts] [--ids id,id]. Input roots register dynamic and fixed window directories in input-index.json. Each scenario trains the suite-declared catalog, freezes it, then measures one round without warmup. Independent physical verification runs after solving. Deadlines use GANGLIA_BENCHMARK_QUERY_CUTOFF_MS and cooperative cancellation; workers are never replaced.',
  );
} else {
  if (!values.output) throw new Error('Provide --output for a new mechanism report');
  if (!['ganglia-v1-rust', 'ganglia-v1-ts'].includes(values.adapter))
    throw new Error('Unknown mechanism adapter');
  const scenarioWorkers = Number(values['scenario-workers']);
  if (!Number.isSafeInteger(scenarioWorkers) || scenarioWorkers < 1)
    throw new Error('Invalid scenario worker count');
  const suite = await readSuite(values.suite);
  const inputRoot = resolve(values['data-root']);

  const filter = values.ids && new Set(values.ids.split(','));
  const selected = suite.cases.filter((c) => !filter || filter.has(c.id));
  if (!selected.length || (filter && selected.length !== filter.size))
    throw new Error('Unknown case ID');
  const selectedIds = new Set(selected.map((item) => item.id));
  const bindings = await scenarioBindings(
    await readDataset(inputRoot),
    suite,
    values.suite,
    selectedIds,
    values['prepare-config'] && resolve(values['prepare-config']),
  );
  const output = resolve(values.output);
  mkdirSync(dirname(output), { recursive: true });
  const artifacts = output + '.artifacts';
  mkdirSync(artifacts, { recursive: true });
  const journal = output + '.events.jsonl';
  writeFileSync(journal, '', { flag: 'wx' });
  const record = (event: unknown) => appendFileSync(journal, JSON.stringify(event) + '\n');
  const config = {
    ...gangliaV1Defaults,
    algorithm: values.adapter as 'ganglia-v1-rust' | 'ganglia-v1-ts',
  };
  const digest = () =>
    sourceHash(
      root,
      ['src', 'bench', 'crates/ganglia-v1/src'],
      ['crates/ganglia-v1/Cargo.toml', 'crates/ganglia-v1/Cargo.lock'],
    );
  const before = await digest();
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const byId = new Map(suite.cases.map((item) => [item.id, item]));
  const recording = recordRun({
    benchmarkId: 'mechanisms',
    suiteId: suite.id,
    gitRevision: revision,
    solverSettings: config,
    measurement: {
      rounds: 1,
      scenarioWorkers,
      solverWorkers: 1,
      queryConcurrency: 1,
      dispatch: 'serial',
    },
    scenarios: suite.scenarios.flatMap((spec) => {
      const cases = spec.cases
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({
          caseId: item.id,
          requirements: item.requirements,
          expectation: {
            kind: expectation(byId.get(item.id)!),
            assertions: item.expect.assertions,
          },
        }));
      return cases.length
        ? [
            {
              scenarioId: spec.id,
              setup: {
                ...spec.setup,
                onDemandInput: spec.setup.input.kind === 'dynamic' && !!values['prepare-config'],
              },
              cases,
            },
          ]
        : [];
    }),
  });
  type Row = {
    id: string;
    group: string;
    status: Status;
    verification: 'valid' | 'invalid' | 'error' | 'not-run';
    matchesExpectation: boolean;
    serviceMs?: number;
    timedOut?: boolean;
    [key: string]: unknown;
  };
  const summary = () => {
    const counts: Record<string, number> = {};
    const groups: Record<
      string,
      { attempted: number; success: number; verificationInvalid: number }
    > = {};
    for (const row of report.results) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      const group = (groups[row.group] ??= { attempted: 0, success: 0, verificationInvalid: 0 });
      group.attempted++;
      group.success += Number(row.status === 'success');
      group.verificationInvalid += Number(row.verification === 'invalid');
    }
    const attempts = report.results.filter((row) => typeof row.serviceMs === 'number');
    return {
      counts,
      groups,
      measuredAttempts: attempts.length,
      verification: Object.fromEntries(
        ['valid', 'invalid', 'error', 'not-run'].map((status) => [
          status,
          report.results.filter((row) => row.verification === status).length,
        ]),
      ),
      expectationsMet: report.results.filter((row) => row.matchesExpectation).length,
      meanSerialAttemptMs: attempts.length
        ? attempts.reduce((sum, row) => sum + row.serviceMs!, 0) / attempts.length
        : null,
      unattemptedIds: selected
        .filter((c) => !report.results.some((r) => r.id === c.id))
        .map((c) => c.id),
    };
  };
  const report = {
    benchmarkRun: recording.report,
    adapter: config.algorithm,
    revision,
    workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceSha256: before,
    suiteSha256: createHash('sha256')
      .update(await readFile(values.suite))
      .digest('hex'),
    dataRoot: inputRoot,
    policy: config,
    scenarioPreparation:
      'Each authored scenario supplies ordered training IDs before measurement filtering; one solver config is shared by the run; no warmup.',
    rounds: 1,
    scenarioWorkers,
    queryCutoffMs: QUERY_CUTOFF_MS,
    verificationPolicy:
      'beta; observations do not affect search status, cost comparisons or acceptance',
    cancellation: 'cooperative-checkpoints; no worker replacement',
    timing:
      'Serial solve attempts include cancellation tails. Preparation and independent verification are separate; no runtime warmup. Scenario groups retain the same trained worker. Training overlaps scored queries and retains physical actions, never query answers.',
    populationTotal: suite.cases.length,
    selectedIds: selected.map((c) => c.id),
    preparations: [] as object[],
    results: [] as Row[],
    interrupted: false,
    executionError: undefined as string | undefined,
    sourceUnchanged: true,
  };
  const save = () => {
    writeFileSync(output + '.tmp', JSON.stringify({ ...report, summary: summary() }, null, 2));
    renameSync(output + '.tmp', output);
  };
  const controller = new AbortController();
  const stop = () => {
    report.interrupted = true;
    recording.interrupt();
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const groups: {
    spec: (typeof suite.scenarios)[number];
    binding: Binding;
    items: typeof selected;
  }[] = [];
  for (const spec of suite.scenarios) {
    const binding = bindings.get(spec.id);
    if (!binding) continue;
    const scenarioIds = new Set(spec.cases.map((item) => item.id));
    const items = selected.filter((item) => scenarioIds.has(item.id));
    try {
      for (const item of items) {
        checkSetup(item);
        if (config.algorithm === 'ganglia-v1-rust' && item.setup.supportModel)
          throw new Error(
            'Unsupported setup: Rust circular waterwheel domains are not implemented',
          );
      }
      groups.push({ spec, binding, items });
    } catch (error) {
      for (const item of items) {
        recording.preparationError(spec.id, item.id, String(error));
        report.results.push({
          id: item.id,
          group: item.group,
          status: 'error',
          verification: 'not-run',
          matchesExpectation: false,
          reason: String(error),
        });
      }
    }
  }
  save();
  let ordinal = 0;
  const runGroup = async ({ spec, binding, items }: (typeof groups)[number]) => {
    if (controller.signal.aborted) return;
    const scenario = ++ordinal;
    let servicePhase = 'preparation';
    const file = join(artifacts, `scenario-${scenario}.json`);
    try {
      record({ phase: 'scenario', ordinal: scenario, id: spec.id, ids: binding.ids });
      const startup = performance.now();
      const builder = scenarioBuilder({
        config,
        extractor: resolve(values.extractor),
        selected: selectedIds,
        writeBinding(_id, binding) {
          writeFileSync(file, JSON.stringify(binding));
          return file;
        },
        onInputError(item, error) {
          const reason = `${error.status}: ${error.reason}`;
          recording.preparationError(spec.id, item.id, reason);
          report.results.push({
            id: item.id,
            group: item.group,
            status: 'error',
            reason,
            verification: 'not-run',
            matchesExpectation: false,
          });
          save();
        },
        onResult(_query, result) {
          record({
            phase: 'request-finished',
            servicePhase,
            scenario,
            reason: result.reason,
            status: result.route.status,
            diagnostics: result.diagnostics,
          });
        },
      });
      for await (const loaded of builder.build(bindings, { ...suite, scenarios: [spec] })) {
        const recorded = recording.startScenario(loaded, binding.dataRoot);
        await runScenario(loaded, {
          signal: controller.signal,
          onPhase(phase) {
            servicePhase = phase === 'batch' ? 'measurement' : phase;
          },
          onReady(kernel) {
            const training = kernel.training;
            const preparation = {
              ordinal: scenario,
              scenarioId: spec.id,
              config,
              ids: binding.ids,
              metadata: loaded.input.metadata,
              training: training.ids,
              trainingMs: training.wallMs,
              trainingOutcomes: training.perWorker.map((worker) =>
                worker.results.map((r) => r.reason ?? r.route.status),
              ),
              catalog: training.perWorker.map((worker) => worker.stats),
              warmupMs: 0,
              warmupOutcomes: [],
              readyMs: performance.now() - startup,
            };
            report.preparations.push(preparation);
            record({ phase: 'ready', ...preparation });
            save();
          },
          onEvent(item, event) {
            if (event.type === 'progress') record({ phase: 'progress', id: item.id, event });
          },
          onResult(item, raw, verification) {
            const original = byId.get(item.id)!;
            const result = raw as WorkerResult;
            const resultFile = join(artifacts, `${item.id}.json`);
            writeFileSync(
              resultFile,
              JSON.stringify({
                originalQuery: original.query,
                query: item.query,
                result,
                ...verification,
              }),
            );
            const row = {
              id: item.id,
              scene: item.scene,
              group: item.group,
              scenario,
              status: classify(result),
              expectation: expectation(original),
              matchesExpectation: matchesExpectation(original, result),
              ...verification,
              reason: result.reason,
              serviceMs: result.diagnostics.solveWallMs,
              timedOut: result.diagnostics.timedOut,
              partial: !!result.partial,
              cost:
                classify(result) === 'success' && result.route.status === 'complete'
                  ? result.route.cost
                  : undefined,
              diagnostics: result.diagnostics,
              resultFile,
            };
            recorded.attempt(item, result, verification, row.matchesExpectation);
            report.results.push(row);
            record({ phase: 'result', ...row });
            save();
            console.error(
              JSON.stringify({
                completed: report.results.length,
                total: selected.length,
                id: item.id,
                status: row.status,
                serviceMs: row.serviceMs,
              }),
            );
          },
        });
        recorded.finish();
      }
    } catch (error) {
      report.executionError = String(error);
      controller.abort();
      for (const item of items)
        if (!report.results.some((row) => row.id === item.id))
          report.results.push({
            id: item.id,
            group: item.group,
            status: 'error',
            verification: 'not-run',
            matchesExpectation: false,
            reason: String(error),
          });
      record({ phase: 'error', ordinal: scenario, error: String(error) });
      save();
    }
  };
  const pending = [...groups];
  await Promise.all(
    Array.from({ length: scenarioWorkers }, async () => {
      while (!controller.signal.aborted) {
        const items = pending.shift();
        if (!items) return;
        await runGroup(items);
      }
    }),
  );
  report.sourceUnchanged = before === (await digest());
  const failure = report.sourceUnchanged
    ? report.executionError
    : 'Benchmark source changed during measurement';
  recording.finish(failure || undefined);
  save();
  console.log(output);
  if (!report.sourceUnchanged) throw new Error('Benchmark source changed during measurement');
  if (
    report.executionError ||
    report.results.length !== selected.length ||
    report.results.some((row) => !row.matchesExpectation)
  )
    process.exitCode = 1;
}
