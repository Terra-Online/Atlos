import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, isDeepStrictEqual } from 'node:util';

import type { SceneBinding } from '#@/bench/mechanism-scene.ts';
import { checkSetup, classify, readMechanismSuite } from '#@/bench/mechanism-suite.ts';
import { requirePreparedCatalog } from '#@/bench/preparation.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { sourceHash } from '#@/bench/source.ts';
import { prepareWorkerSolver, WorkerQueryError, type WorkerResult } from '#@/bench/workers.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
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
    'Usage: node bench/mechanism-run.ts --output <new-report.json> [--data-root <candidate-input-root>] [--prepare-config <private-game-config>] [--adapter ganglia-v1-rust|ganglia-v1-ts] [--ids id,id] [--audit]. Input roots require input-index.json with explicitly rebound per-case directories. Each scenario trains the configured catalog, freezes it, warms the same worker, then measures one round. Independent physical verification runs after solving. Deadlines use GANGLIA_BENCHMARK_QUERY_SLO_MS and cooperative cancellation; workers are never replaced.',
  );
} else {
  if (!values.output) throw new Error('Provide --output for a new mechanism report');
  if (!['ganglia-v1-rust', 'ganglia-v1-ts'].includes(values.adapter))
    throw new Error('Unknown mechanism adapter');
  const scenarioWorkers = Number(values['scenario-workers']);
  if (!Number.isSafeInteger(scenarioWorkers) || scenarioWorkers < 1)
    throw new Error('Invalid scenario worker count');
  const suiteBytes = await readFile(values.suite);
  const suite = await readMechanismSuite(values.suite);
  const inputRoot = resolve(values['data-root']);
  const indexBytes = await readFile(join(inputRoot, 'input-index.json'));
  const index = JSON.parse(indexBytes.toString()) as {
    suiteSha256: string;
    revision: string;
    source: unknown;
    profiles: Record<string, unknown>;
    cases: Record<string, { directory: string }>;
  };
  if (index.suiteSha256 !== createHash('sha256').update(suiteBytes).digest('hex'))
    throw new Error('Candidate input index binds a different mechanism specification');
  if (
    !isDeepStrictEqual(index.source, suite.source) ||
    Object.entries(suite.sources).some(
      ([scene, source]) => !isDeepStrictEqual(index.profiles?.[scene], source.profile),
    )
  )
    throw new Error(
      'Candidate game build and player profiles must match the mechanism specification',
    );
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
    status: string;
    serviceMs?: number;
    timedOut?: boolean;
    [key: string]: unknown;
  };
  const summary = () => {
    const counts: Record<string, number> = {};
    const groups: Record<string, { attempted: number; complete: number; physicalInvalid: number }> =
      {};
    for (const row of report.results) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      const group = (groups[row.group] ??= { attempted: 0, complete: 0, physicalInvalid: 0 });
      group.attempted++;
      group.complete += Number(row.status === 'complete');
      group.physicalInvalid += Number(row.status === 'physical-invalid');
    }
    const attempts = report.results.filter((row) => typeof row.serviceMs === 'number');
    return {
      counts,
      groups,
      measuredAttempts: attempts.length,
      meanSerialAttemptMs: attempts.length
        ? attempts.reduce((sum, row) => sum + row.serviceMs!, 0) / attempts.length
        : null,
      unattemptedIds: selected
        .filter((c) => !report.results.some((r) => r.id === c.id))
        .map((c) => c.id),
    };
  };
  const report = {
    schema: 1,
    adapter: config.algorithm,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    workingTreeDirty: !!execFileSync('git', ['status', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
    sourceSha256: before,
    suiteSha256: index.suiteSha256,
    inputRevision: index.revision,
    inputIndexSha256: createHash('sha256').update(indexBytes).digest('hex'),
    policy: config,
    rounds: 1,
    scenarioWorkers,
    deadlineMs: QUERY_SLO_MS,
    cancellation: 'cooperative-checkpoints; no worker replacement',
    timing:
      'Serial solve attempts include cancellation tails. Preparation, warmup and independent verification are separate. Scenario groups retain the same trained worker. Training overlaps scored queries and retains physical actions, never query answers.',
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
    controller.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const groups = new Map<string, typeof selected>();
  for (const item of selected) {
    try {
      checkSetup(item);
      if (!index.cases[item.id]) throw new Error('Missing candidate input binding');
      const setup = item.setup;
      const key = JSON.stringify([
        index.cases[item.id].directory,
        setup.locomotion,
        setup.followingPlacement,
      ]);
      const group = groups.get(key) ?? [];
      group.push(item);
      groups.set(key, group);
    } catch (error) {
      report.results.push({
        id: item.id,
        group: item.group,
        status: String(error).includes('Unsupported setup')
          ? 'unsupported-setup'
          : 'input-unavailable',
        reason: String(error),
      });
    }
  }
  save();
  let ordinal = 0;
  const runGroup = async (supplied: typeof selected) => {
    if (controller.signal.aborted) return;
    const scenario = ++ordinal;
    let servicePhase = 'preparation';
    let items = supplied;
    const first = items[0];
    const binding: SceneBinding = {
      suite: resolve(values.suite),
      ids: items.map((c) => c.id),
      dataRoot: resolve(inputRoot, index.cases[first.id].directory),
      exports: join(inputRoot, 'routing'),
      prepareConfig: values['prepare-config'] && resolve(values['prepare-config']),
      inputRevision: index.revision,
    };
    const file = join(artifacts, `scenario-${scenario}.json`);
    writeFileSync(file, JSON.stringify(binding));
    if (values.audit) {
      for (const item of items)
        report.results.push({
          id: item.id,
          group: item.group,
          status: 'input-bound-unrun',
          binding: file,
        });
      save();
      return;
    }
    record({ phase: 'scenario', ordinal: scenario, ids: binding.ids });
    let prepared: Awaited<ReturnType<typeof prepareWorkerSolver>> | undefined;
    try {
      const startup = performance.now();
      prepared = await prepareWorkerSolver({
        count: 1,
        config,
        dataRoot: file,
        extractor: resolve(values.extractor),
        scene: first.scene,
        entry: new URL('./mechanism-worker.ts', import.meta.url),
        preparation:
          binding.prepareConfig && !first.setup.physical
            ? {
                config: binding.prepareConfig,
                devices: resolve(binding.exports, `${first.scene}-traversal-devices.json`),
              }
            : undefined,
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
      const metadata = prepared.metadata as typeof prepared.metadata & {
        mechanism: {
          resolved: Record<string, RouteQuery>;
          resolutions: unknown;
          resolutionErrors: Record<string, { status: string; reason: string }>;
        };
      };
      const solve: typeof prepared.solver.solve = async (query, options) => {
        const started = performance.now();
        try {
          return await prepared!.solver.solve(query, options);
        } catch (error) {
          if (!(error instanceof WorkerQueryError)) throw error;
          const serviceMs = performance.now() - started;
          const result: WorkerResult = {
            route: { status: 'no-verified-route' },
            connections: [],
            reason: 'execution-error:' + error.message,
            diagnostics: {
              truncated: false,
              solveWallMs: serviceMs,
              queueMs: 0,
              responseMs: serviceMs,
              timedOut: false,
            },
          };
          record({ phase: 'request-error', servicePhase, scenario, error: error.message });
          return result;
        }
      };
      items = items.filter((item) => {
        const error = metadata.mechanism.resolutionErrors[item.id];
        if (!error) return true;
        report.results.push({ id: item.id, group: item.group, ...error });
        return false;
      });
      if (!items.length) {
        save();
        return;
      }
      const queries = items.map((item) => metadata.mechanism.resolved[item.id]);
      const training = Array.from({ length: config.preparation.trainingQueries }, (_, i) => ({
        id: items[Math.floor((i * items.length) / config.preparation.trainingQueries)].id,
        query: queries[Math.floor((i * items.length) / config.preparation.trainingQueries)],
      }));
      const warmup = Array.from({ length: config.preparation.warmupQueries }, (_, i) => {
        const query = queries[i % queries.length];
        return {
          id: `warmup-${i}`,
          query: {
            starts: query.starts,
            goal: query.starts.find((s) => s.state === 'available')!.position,
          },
        };
      });
      servicePhase = 'training';
      await prepared.setCatalogPhase('training');
      const trainingStarted = performance.now();
      const trained = [[] as import('#@/src/solver/contract.ts').RouteResult[]];
      for (const item of training)
        trained[0].push(await solve(item.query, { signal: controller.signal }));
      const trainingMs = performance.now() - trainingStarted;
      await prepared.setCatalogPhase('frozen');
      const stats = prepared.catalogStatsAll();
      servicePhase = 'warmup';
      const warmStarted = performance.now();
      const warmed = [];
      for (const item of warmup)
        warmed.push(await solve(item.query, { signal: controller.signal }));
      requirePreparedCatalog(
        config,
        { ids: training.map((c) => c.id), perWorker: stats.map((stats) => ({ stats })) },
        warmup,
      );
      const preparation = {
        ordinal: scenario,
        ids: binding.ids,
        metadata,
        training: training.map((c) => c.id),
        trainingMs,
        trainingOutcomes: trained.map((results) => results.map((r) => r.reason ?? r.route.status)),
        catalog: stats,
        warmupMs: performance.now() - warmStarted,
        warmupOutcomes: warmed.map((r) => r.reason ?? r.route.status),
        readyMs: performance.now() - startup,
      };
      report.preparations.push(preparation);
      record({ phase: 'ready', ...preparation });
      save();
      servicePhase = 'measurement';
      for (const [i, item] of items.entries()) {
        if (controller.signal.aborted) break;
        const result = (await solve(queries[i], {
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === 'progress') record({ phase: 'progress', id: item.id, event });
          },
        })) as WorkerResult;
        const verificationStarted = performance.now();
        const evaluation =
          result.route.status === 'complete' && !result.partial
            ? await prepared.verify(queries[i], result)
            : undefined;
        const resultFile = join(artifacts, `${item.id}.json`);
        writeFileSync(
          resultFile,
          JSON.stringify({ originalQuery: item.query, query: queries[i], result, evaluation }),
        );
        const row = {
          id: item.id,
          scene: item.scene,
          group: item.group,
          scenario,
          status: result.diagnostics.timedOut
            ? 'timeout'
            : evaluation && !evaluation.valid
              ? 'physical-invalid'
              : classify(item, result),
          serviceMs: result.diagnostics.solveWallMs,
          verificationMs: performance.now() - verificationStarted,
          timedOut: result.diagnostics.timedOut,
          partial: !!result.partial,
          cost: result.route.status === 'complete' ? result.route.cost : undefined,
          diagnostics: result.diagnostics,
          evaluation,
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
      }
    } catch (error) {
      // An unexpected worker failure invalidates the run. Do not hide it by
      // starting the next scenario with a replacement process.
      report.executionError = String(error);
      controller.abort();
      for (const item of items)
        if (!report.results.some((row) => 'id' in row && row.id === item.id))
          report.results.push({
            id: item.id,
            group: item.group,
            status: 'execution-error',
            reason: String(error),
          });
      record({ phase: 'error', ordinal: scenario, error: String(error) });
      save();
    } finally {
      await prepared?.solver.close();
    }
  };
  const pending = [...groups.values()];
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
    report.results.length !== selected.length ||
    report.results.some((row) => row.status !== 'complete')
  )
    process.exitCode = 1;
}
