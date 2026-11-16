/**
 * Mechanism CLI and schema-2 report projection. Authored scenarios determine
 * sharing and ordered training; ID selection only filters measurement. Every
 * scenario uses the same run-level solver configuration. The shared runner owns
 * training, frozen queries, verification and cleanup; this module retains audit,
 * artifacts, expectation reporting and the existing explicit worker-count flag.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { expectation, matchesExpectation } from '#@/bench/mechanisms/assessment.ts';
import { loadDataset, scenarioBinding, scenarioBuilder } from '#@/bench/mechanisms/dataset.ts';
import { checkSetup, readSuite } from '#@/bench/mechanisms/suite.ts';
import { classify, type Status } from '#@/bench/outcome.ts';
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
      default: resolve(root, '../../../.local/data/mechanisms-266-v119'),
    },
    extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
    'prepare-config': { type: 'string' },
    adapter: { type: 'string', default: 'ganglia-v1-rust' },
    ids: { type: 'string' },
    output: { type: 'string' },
    audit: { type: 'boolean' },
    'scenario-workers': { type: 'string', default: '1' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Usage: node bench/mechanism-benchmark.ts --output <new-report.json> [--data-root <candidate-input-root>] [--prepare-config <private-game-config>] [--adapter ganglia-v1-rust|ganglia-v1-ts] [--ids id,id] [--audit]. Input roots require input-index.json with explicitly rebound per-case directories. Each scenario trains the suite-declared catalog, freezes it, then measures one round without warmup. Independent physical verification runs after solving. Deadlines use GANGLIA_BENCHMARK_QUERY_CUTOFF_MS and cooperative cancellation; workers are never replaced.',
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
  const dataset = await loadDataset(inputRoot, values.suite, suite);
  const filter = values.ids && new Set(values.ids.split(','));
  const selected = suite.cases.filter((c) => !filter || filter.has(c.id));
  if (!selected.length || (filter && selected.length !== filter.size))
    throw new Error('Unknown case ID');
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
    schema: 2,
    adapter: config.algorithm,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceSha256: before,
    suiteSha256: dataset.suiteSha256,
    inputRevision: dataset.revision,
    inputIndexSha256: dataset.indexSha256,
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
    inputAudit: [] as object[],
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
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const groups: (typeof suite.scenarios)[number][] = [];
  for (const spec of suite.scenarios) {
    const measured = spec.cases.filter((item) => selected.some((test) => test.id === item.id));
    if (!measured.length) continue;
    try {
      const items = measured.map((item) => suite.cases.find((test) => test.id === item.id)!);
      for (const item of items) {
        checkSetup(item);
        if (config.algorithm === 'ganglia-v1-rust' && item.setup.supportModel)
          throw new Error(
            'Unsupported setup: Rust circular waterwheel domains are not implemented',
          );
      }
      groups.push(spec);
    } catch (error) {
      for (const test of measured) {
        const item = suite.cases.find((item) => item.id === test.id)!;
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
  const runGroup = async (spec: (typeof suite.scenarios)[number]) => {
    if (controller.signal.aborted) return;
    const scenario = ++ordinal;
    let servicePhase = 'preparation';
    const items = selected.filter((item) => spec.cases.some((test) => test.id === item.id));
    const byId = new Map(suite.cases.map((item) => [item.id, item]));
    const needed = new Set([...items.map((item) => item.id), ...spec.training]);
    const bound = spec.cases
      .filter((item) => needed.has(item.id))
      .map((item) => byId.get(item.id)!);
    const file = join(artifacts, `scenario-${scenario}.json`);
    try {
      const binding = scenarioBinding(
        dataset,
        values.suite,
        bound,
        values['prepare-config'] && resolve(values['prepare-config']),
      );
      if (values.audit) {
        writeFileSync(file, JSON.stringify(binding));
        for (const item of items)
          report.inputAudit.push({ id: item.id, group: item.group, binding: file, config });
        save();
        return;
      }
      record({ phase: 'scenario', ordinal: scenario, id: spec.id, ids: binding.ids });
      const startup = performance.now();
      const builder = scenarioBuilder({
        config,
        suiteFile: values.suite,
        extractor: resolve(values.extractor),
        prepareConfig: binding.prepareConfig,
        selected: new Set(items.map((item) => item.id)),
        writeBinding(_id, binding) {
          writeFileSync(file, JSON.stringify(binding));
          return file;
        },
        onInputError(item, error) {
          report.results.push({
            id: item.id,
            group: item.group,
            status: 'error',
            reason: `${error.status}: ${error.reason}`,
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
      for await (const loaded of builder.build(dataset, { ...suite, scenarios: [spec] })) {
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
  save();
  console.log(output);
  if (!report.sourceUnchanged) throw new Error('Benchmark source changed during measurement');
  if (
    report.executionError ||
    (values.audit
      ? report.inputAudit.length + report.results.length !== selected.length ||
        report.results.length > 0
      : report.results.length !== selected.length ||
        report.results.some((row) => !row.matchesExpectation))
  )
    process.exitCode = 1;
}
