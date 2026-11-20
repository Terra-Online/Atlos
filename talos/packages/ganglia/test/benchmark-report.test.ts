import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import type { BenchmarkRun } from '#@/bench/benchmark-run.ts';
import { renderBenchmarkReport } from '#@/bench/report-query.ts';

let directory: string;
let baselineFile: string;
let baseline: { benchmarkRun: BenchmarkRun };
const cwd = fileURLToPath(new URL('../', import.meta.url));
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ['bench/benchmark-report.ts', baselineFile, ...args], {
    cwd,
    encoding: 'utf8',
  });

before(() => {
  directory = mkdtempSync(join(tmpdir(), 'ganglia-report-test-'));
  baselineFile = join(directory, 'baseline.json');
  const adapter = join(directory, 'adapter.mjs');
  const workload = join(directory, 'workload.json');
  writeFileSync(
    adapter,
    `export const adapter = {
      defaults: { algorithm: 'independent', batchConcurrency: 1 },
      entry: new URL(${JSON.stringify(new URL('./fixtures/independent-worker.ts', import.meta.url).href)})
    };`,
  );
  writeFileSync(
    workload,
    JSON.stringify([
      {
        id: 'walk',
        query: {
          starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
          goal: [1, 0, 0],
        },
      },
    ]),
  );
  execFileSync(
    process.execPath,
    [
      'bench/cli.ts',
      '--adapter',
      adapter,
      '--workload',
      workload,
      '--rounds',
      '2',
      '--output',
      baselineFile,
    ],
    { cwd, stdio: 'pipe' },
  );
  baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
});

after(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

test('strict reports pair measured rounds and show lost routes across solver revisions', () => {
  const candidate = structuredClone(baseline);
  const run = candidate.benchmarkRun;
  run.gitRevision = 'candidate-revision';
  run.solverId = 'candidate-solver';
  const testCase = run.scenarios[0].cases[0];
  testCase.attempts[1] = { status: 'timeout', solveMs: 20, verification: 'not-run' };
  const file = join(directory, 'candidate.json');
  writeFileSync(file, JSON.stringify(candidate));

  const result = cli(file);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\| walk \| 1 \| success \| success \| valid \| valid \|/);
  assert.match(result.stdout, /\| walk \| 2 \| success \| timeout \| valid \| not-run \|/);
});

test('strict reports reject changed requests and missing rounds, and invalid rows fail in SQL mode too', () => {
  const candidate = structuredClone(baseline);
  const scenario = candidate.benchmarkRun.scenarios[0];
  scenario.cases[0].query!.goal = [2, 0, 0];
  scenario.cases[0].attempts.pop();
  const file = join(directory, 'incompatible.json');
  writeFileSync(file, JSON.stringify(candidate));

  const result = cli(file);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /case map02\/walk differs in definition or order/);
  assert.match(result.stderr, /candidate case map02\/walk has incomplete measurement/);

  scenario.cases.push(scenario.cases[0]);
  assert.throws(
    () => renderBenchmarkReport(baseline, candidate, 'SELECT * FROM attempts'),
    /Invalid candidate report: UNIQUE constraint failed/,
  );
});

test('custom SQL compares different case sets and uses the same Markdown renderer', () => {
  const candidate = structuredClone(baseline);
  candidate.benchmarkRun.scenarios[0].cases[0].caseId = 'walk|detour';
  const file = join(directory, 'different-cases.json');
  const sql = join(directory, 'custom.sql');
  writeFileSync(file, JSON.stringify(candidate));
  writeFileSync(
    sql,
    `
    SELECT run_id, case_id, count(*) AS rounds FROM attempts
    GROUP BY run_id, case_id ORDER BY run_id;
    -- An intentionally different workload.
  `,
  );

  const result = cli(file, '--sql-file', sql);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout.trim(),
    [
      '| run_id | case_id | rounds |',
      '| --- | --- | --- |',
      '| baseline | walk | 2 |',
      '| candidate | walk&#124;detour | 2 |',
    ].join('\n'),
  );
  assert.throws(
    () => renderBenchmarkReport(baseline, candidate, 'SELECT 1; SELECT 2'),
    /exactly one read-only SQL query/,
  );
  assert.throws(
    () => renderBenchmarkReport(baseline, candidate, 'DELETE FROM attempts RETURNING round'),
    /not authorized/,
  );
});
