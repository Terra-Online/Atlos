import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  checkSetup,
  classify,
  expectation,
  readMechanismSuite,
  resourcePath,
  type MechanismBinding,
  type MechanismResult,
} from '#@/bench/mechanism-suite.ts';
import { QUERY_SLO_MS } from '#@/bench/slo.ts';
import { sourceHash } from '#@/bench/source.ts';
import { prepareWorkerSolver, type WorkerResult } from '#@/bench/workers.ts';
import { verificationDefaults } from '#@/src/evaluation/policy.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: resolve(root, 'bench/scenes/mechanisms/suite.json') },
    mode: { type: 'string' },
    exports: { type: 'string' },
    retained: { type: 'string' },
    'scene-data-root': { type: 'string' },
    'prepare-config': { type: 'string' },
    'device-exports': { type: 'string' },
    extractor: { type: 'string', default: resolve(root, '../../.cache/noclip') },
    kernel: { type: 'string', default: root },
    'kernel-revision': { type: 'string' },
    config: { type: 'string' },
    ids: { type: 'string' },
    rounds: { type: 'string', default: '1' },
    output: { type: 'string' },
    audit: { type: 'boolean' },
    help: { type: 'boolean' },
  },
});
if (values.help) {
  console.log(
    'Usage: node bench/mechanism-run.ts --mode physical-diagnostic --exports <source-root> --retained <retained-profile-root> --output <new-report.json> [--suite <manifest>] [--ids id,id] [--rounds 2] [--kernel <frozen-package-root> --kernel-revision <revision>] [--extractor <matching-extractor-root>] [--device-exports <explicitly-rebound-root>] [--scene-data-root <root-with-per-case-directories>] [--prepare-config <private-export-config>] [--config <solver-policy.json>] [--audit]. Each scene case uses <scene-data-root>/<caseId>; load/export/solve/verification follows the cooperative query deadline; a running stage completes before cancellation is observed. Worker bootstrap and queueing are outside the deadline, and no worker is killed or replaced. This diagnostic does not fulfill service training/warmup or publish service speedups.',
  );
  console.log(
    'GANGLIA_BENCHMARK_QUERY_SLO_MS sets the cooperative deadline in milliseconds (default 300000).',
  );
} else {
  if (values.mode !== 'physical-diagnostic')
    throw new Error(
      'Choose explicit --mode physical-diagnostic; service scoring requires its configured preparation',
    );
  if (!values.exports || !values.retained || !values.output)
    throw new Error('Explicit --exports, --retained and --output are required');
  const suite = await readMechanismSuite(values.suite),
    filter = values.ids ? new Set(values.ids.split(',')) : undefined;
  if (filter && [...filter].some((id) => !suite.cases.some((c) => c.id === id)))
    throw new Error('Unknown selected case ID');
  const selected = suite.cases.filter((c) => !filter || filter.has(c.id)),
    rounds = Number(values.rounds);
  if (!selected.length || !Number.isSafeInteger(rounds) || rounds < 1)
    throw new Error('Invalid selected population or rounds');
  const roots = { exports: resolve(values.exports), retained: resolve(values.retained) };
  const output = resolve(values.output),
    events = output + '.events.jsonl',
    inputs = output + '.inputs';
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(inputs, { recursive: true });
  writeFileSync(events, '', { flag: 'wx' });
  const record = (value: unknown) => appendFileSync(events, JSON.stringify(value) + '\n');
  const results: unknown[] = [];
  const attempted = new Set<string>();
  const resultsDirectory = output + '.results';
  mkdirSync(resultsDirectory, { recursive: true });
  let aborted = false;
  const controller = new AbortController();
  process.once('SIGINT', () => {
    aborted = true;
    controller.abort();
  });
  process.once('SIGTERM', () => {
    aborted = true;
    controller.abort();
  });
  if (resolve(values.kernel) !== resolve(root) && !values['kernel-revision'])
    throw new Error('An external frozen kernel requires --kernel-revision');
  const workspaceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: values.kernel,
    encoding: 'utf8',
  }).trim();
  const report = {
    schema: 1,
    mode: 'physical-diagnostic',
    servicePreparation: 'not performed; not a service-performance report',
    sourceRevision: values['kernel-revision'] ?? workspaceRevision,
    kernelSourceSha256: await sourceHash(resolve(values.kernel), ['src'], ['package.json']),
    verification: { version: 3, policy: verificationDefaults },
    kernel: resolve(values.kernel),
    extractor: resolve(values.extractor),
    source: suite.source,
    populationTotal: suite.cases.length,
    selectedIds: selected.map((c) => c.id),
    unselectedIds: suite.cases.filter((c) => !selected.includes(c)).map((c) => c.id),
    rounds,
    deadlineMs: QUERY_SLO_MS,
    cancellation: 'cooperative-checkpoints',
    deadlineScope: 'dispatch-through-independent-verification',
    invalid: false,
    failure: undefined as string | undefined,
    results,
    interrupted: false,
    unattemptedIds: selected.map((c) => c.id),
  };
  const save = () => {
    report.interrupted = aborted;
    report.unattemptedIds = selected.filter((c) => !attempted.has(c.id)).map((c) => c.id);
    writeFileSync(output + '.tmp', JSON.stringify(report, null, 2));
    renameSync(output + '.tmp', output);
  };
  const config = {
    ...gangliaV1Defaults,
    ...(values.config ? JSON.parse(await readFile(values.config, 'utf8')) : {}),
    algorithm: 'ganglia-v1-ts' as const,
    batchConcurrency: 1,
  };
  record({ phase: 'start', at: new Date().toISOString(), ...report, roots });
  save();
  try {
    for (const item of selected) {
      if (aborted) break;
      attempted.add(item.id);
      const binding: MechanismBinding = {
        suite: { ...suite, cases: [item] },
        item,
        roots,
        extractor: resolve(values.extractor),
        kernel: resolve(values.kernel),
        sceneDataRoot: values['scene-data-root'] && resolve(values['scene-data-root']),
        prepareConfig: values['prepare-config'] && resolve(values['prepare-config']),
        deviceExports: values['device-exports'] && resolve(values['device-exports']),
      };
      const file = join(inputs, item.id + '.json');
      writeFileSync(file, JSON.stringify(binding));
      if (values.audit) {
        const errors: string[] = [];
        try {
          checkSetup(item);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
        const paths = item.setup.physical
          ? [
              resourcePath(item.setup.physical.ground, roots),
              resourcePath(item.setup.physical.collision, roots),
              resolve(roots.exports, 'movement-settings-current.json'),
              resolve(
                binding.deviceExports ?? roots.exports,
                `${item.scene}-traversal-devices.json`,
              ),
            ]
          : binding.sceneDataRoot
            ? [
                resolve(binding.sceneDataRoot, item.id, `routing/${item.scene}-ground-all.json`),
                resolve(binding.sceneDataRoot, item.id, 'routing/movement-settings-current.json'),
              ]
            : [];
        if (!item.setup.physical && !binding.sceneDataRoot) errors.push('Missing scene-data-root');
        for (const path of paths)
          try {
            await stat(path);
          } catch {
            errors.push('Missing asset: ' + path);
          }
        const row = {
          id: item.id,
          scene: item.scene,
          expectation: expectation(item),
          status: errors.length ? 'input-unavailable' : 'input-audited-unrun',
          errors,
        };
        results.push(row);
        record(row);
        save();
        continue;
      }
      const started = performance.now();
      let prepared: Awaited<ReturnType<typeof prepareWorkerSolver>> | undefined;
      try {
        prepared = await prepareWorkerSolver({
          count: 1,
          config,
          dataRoot: file,
          extractor: binding.extractor,
          scene: item.scene,
          entry: new URL('./mechanism-worker.ts', import.meta.url),
          timeoutMs: QUERY_SLO_MS,
          onEvent(_query, event, memory, detail) {
            record({
              phase: 'progress',
              id: item.id,
              event,
              memory,
              detail,
              elapsedMs: performance.now() - started,
            });
          },
          onResult(query, result) {
            record({ phase: 'result', id: item.id, query, result });
          },
        });
        for (let round = 0; round < rounds && !aborted; round++) {
          const result = (await prepared.solver.solve(item.query, {
            signal: controller.signal,
          })) as MechanismResult & WorkerResult;
          const detail = result.diagnostics.mechanism;
          const resultFile = join(resultsDirectory, `${item.id}-${round}.json`);
          writeFileSync(
            resultFile,
            JSON.stringify({ id: item.id, query: item.query, round, result }),
          );
          const row = {
            id: item.id,
            scene: item.scene,
            group: item.group,
            round,
            cache: round ? 'same-preparation' : 'application-cold',
            expectation: expectation(item),
            status: classify(item, result, detail?.evaluation),
            elapsedSinceCaseStartMs: performance.now() - started,
            workerStartupMs: prepared.timings.workerStartupMs,
            resultFile,
            solveWallMs: result.diagnostics.solveWallMs,
            timedOut: result.diagnostics.timedOut,
            cancellationMs: result.diagnostics.cancellationMs,
            responseMs: result.diagnostics.responseMs,
            cost: detail?.evaluation?.costSeconds,
            evaluation: detail?.evaluation,
            exercise: detail?.exercise,
            truncated: result.diagnostics.truncated,
          };
          results.push(row);
          record({ phase: 'classified', ...row });
          save();
          console.error(
            JSON.stringify({
              id: item.id,
              round,
              status: row.status,
              elapsedMs: row.elapsedSinceCaseStartMs,
            }),
          );
        }
      } catch (error) {
        const row = {
          id: item.id,
          scene: item.scene,
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
          elapsedMs: performance.now() - started,
        };
        report.invalid = true;
        report.failure = row.reason;
        results.push(row);
        record(row);
        save();
        break;
      } finally {
        await prepared?.solver.close();
      }
    }
  } finally {
    save();
  }
  console.log(output);
  if (report.invalid) process.exitCode = 1;
}
