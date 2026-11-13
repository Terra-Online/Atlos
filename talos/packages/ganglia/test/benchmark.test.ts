import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualityGate } from '#@/bench/quality.ts';
import { runBenchmark } from '#@/bench/run.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/index.ts';

test('every scored batch is timed, keeps input order and closes once', async () => {
  const cases: readonly { id: string; query: RouteQuery }[] = [1, 2, 3].map((id) => ({
    id: String(id),
    query: {
      starts: [{ id: 'player', position: [id, 0, 0], cost: id, state: 'available' }],
      goal: [id, 0, 0],
    },
  }));
  let closes = 0,
    batches = 0;
  const phases: string[] = [];
  const report = await runBenchmark(
    {
      config: gangliaV1Defaults,
      async solve() {
        throw new Error('Benchmark must submit whole batches');
      },
      async solveBatch(queries) {
        batches++;
        const result: RouteResult[] = await Promise.all(
          [...queries].reverse().map(async (query) => {
            await new Promise((resolve) => setImmediate(resolve));
            return {
              route: {
                status: 'complete' as const,
                cost: query.goal[0],
                start: 'player',
                arrivalCost: query.goal[0],
                length: 0,
                points: [query.goal],
                segments: [],
              },
              connections: [],
              diagnostics: { truncated: false },
            };
          }),
        );
        return result.reverse();
      },
      async close() {
        closes++;
      },
    },
    cases,
    { maxVertical: 0.5 },
    (phase) => {
      phases.push(phase);
    },
    3,
  );
  assert.equal(batches, 3);
  assert.equal(closes, 1);
  assert.equal(report.batch.rounds, 3);
  assert.equal(report.batch.wallSamplesMs.length, 3);
  assert.equal(
    report.batch.totalWallMs,
    report.batch.wallSamplesMs.reduce((sum, ms) => sum + ms, 0),
  );
  assert.equal(report.batch.wallMs, report.batch.totalWallMs / 3);
  assert.equal(report.batch.queriesPerSecond, 9 / (report.batch.totalWallMs / 1000));
  assert.deepEqual(phases, ['batch']);
  assert.deepEqual(
    report.batch.results.map((row) => row.id),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    report.batch.results.map((row) => row.cost),
    [1, 2, 3],
  );
  assert.ok(report.batch.results.every((row) => row.sameOutcomeAcrossRounds));
});

test('the benchmark closes the adapter after a failed batch', async () => {
  let closed = false;
  await assert.rejects(
    runBenchmark(
      {
        config: gangliaV1Defaults,
        async solve() {
          throw new Error('worker failed');
        },
        async solveBatch() {
          throw new Error('worker failed');
        },
        async close() {
          closed = true;
        },
      },
      [{ id: 'failure', query: { starts: [], goal: [0, 0, 0] } }],
      { maxVertical: 0.5 },
    ),
    /worker failed/,
  );
  assert.equal(closed, true);
});

test('independent warmup results are reported separately from the measured problem', async () => {
  const result: RouteResult = {
    route: {
      status: 'complete',
      start: 'a',
      cost: 1,
      arrivalCost: 1,
      length: 0,
      points: [[1, 0, 0]],
      segments: [],
    },
    connections: [],
    diagnostics: { truncated: false },
  };
  let batch = 0;
  const report = await runBenchmark(
    {
      config: gangliaV1Defaults,
      solve: async () => {
        throw new Error('Unexpected single solve');
      },
      solveBatch: async () => [{ ...result, partial: ++batch === 1 }],
      close: async () => {},
    },
    [
      {
        id: 'same-geometry',
        query: {
          starts: [{ id: 'a', position: [1, 0, 0], cost: 1, state: 'available' }],
          goal: [1, 0, 0],
        },
      },
    ],
    { maxVertical: 0.5 },
    undefined,
    1,
    undefined,
    [{ id: 'warmup', query: { starts: [], goal: [2, 0, 0] } }],
  );
  assert.equal(report.batch.results[0].partial, false);
  assert.equal(report.warmup.quality.completed, 0);
  assert.equal(report.batch.results[0].sameOutcomeAcrossRounds, true);
});

test('a middle-round lost or changed route and truncation remain unstable after recovery', async () => {
  const cases: { id: string; query: RouteQuery }[] = [1, 2, 3].map((id) => ({
    id: String(id),
    query: {
      starts: [{ id: 'player', position: [id, 0, 0], cost: 1, state: 'available' }],
      goal: [id, 0, 0],
    },
  }));
  let batches = 0,
    closes = 0;
  const report = await runBenchmark(
    {
      config: gangliaV1Defaults,
      solve: async () => {
        throw new Error('Unexpected single solve');
      },
      solveBatch: async (queries) => {
        const broken = ++batches === 2;
        return queries.map((query, index): RouteResult => ({
          route:
            broken && index === 0
              ? { status: 'no-verified-route' }
              : {
                  status: 'complete',
                  start: 'player',
                  arrivalCost: 1,
                  cost: 1,
                  length: 0,
                  points: [broken && index === 1 ? [99, 0, 0] : query.goal],
                  segments: [],
                },
          connections: [],
          diagnostics: { truncated: broken && index === 2 },
        }));
      },
      close: async () => {
        closes++;
      },
    },
    cases,
    { maxVertical: 0.5 },
    undefined,
    3,
  );
  assert.equal(batches, 3);
  assert.equal(closes, 1);
  assert.ok(report.batch.results.every((row) => row.status === 'complete' && !row.truncated));
  assert.deepEqual(
    report.batch.results.map((row) => row.sameOutcomeAcrossRounds),
    [false, false, true],
  );
  assert.deepEqual(
    report.batch.results.map((row) => row.sameTruncationAcrossRounds),
    [true, true, false],
  );
  assert.equal(qualityGate(report.batch.results, undefined).passed, false);
});

test('a later measured batch failure closes the solver without running more rounds', async () => {
  let batches = 0,
    closes = 0;
  await assert.rejects(
    runBenchmark(
      {
        config: gangliaV1Defaults,
        solve: async () => {
          throw new Error('Unexpected single solve');
        },
        solveBatch: async () => {
          if (++batches === 3) throw new Error('later worker failure');
          return [
            {
              route: { status: 'no-verified-route' },
              connections: [],
              diagnostics: { truncated: false },
            },
          ];
        },
        close: async () => {
          closes++;
        },
      },
      [{ id: 'failure', query: { starts: [], goal: [0, 0, 0] } }],
      { maxVertical: 0.5 },
      undefined,
      4,
    ),
    /later worker failure/,
  );
  assert.equal(batches, 3);
  assert.equal(closes, 1);
});

test('SLO accounting preserves a middle-round timeout and counts actual successful attempts', async () => {
  let batches = 0;
  const complete: RouteResult = {
    route: {
      status: 'complete',
      start: 'player',
      arrivalCost: 1,
      cost: 1,
      length: 0,
      points: [[0, 0, 0]],
      segments: [],
    },
    connections: [],
    diagnostics: { truncated: false },
  };
  const timeout: RouteResult = {
    route: { status: 'no-verified-route' },
    reason: 'timeout',
    connections: [],
    diagnostics: { truncated: true },
  };
  const report = await runBenchmark(
    {
      config: gangliaV1Defaults,
      solve: async () => {
        throw new Error('Unexpected single solve');
      },
      solveBatch: async () => [++batches === 2 ? timeout : complete],
      close: async () => {},
    },
    [
      {
        id: 'intermittent',
        query: {
          starts: [{ id: 'player', position: [0, 0, 0], cost: 1, state: 'available' }],
          goal: [0, 0, 0],
        },
      },
    ],
    { maxVertical: 0.5 },
    undefined,
    3,
  );
  assert.equal(report.batch.successfulQueries, 2);
  assert.equal(report.batch.timedOutAttempts, 1);
  assert.equal(report.batch.successfulQueriesPerSecond, 2 / (report.batch.totalWallMs / 1000));
  assert.equal(report.batch.quality.completed, 0);
  assert.equal(report.batch.results[0].timedOut, true);
  assert.equal(report.batch.samples[1].results[0].reason, 'timeout');
  assert.equal(qualityGate(report.batch.results, undefined).passed, false);
});

test('replacement setup is explained separately while remaining in measured wall time', async () => {
  let recoverySetupMs = 0;
  const report = await runBenchmark(
    {
      config: gangliaV1Defaults,
      solve: async () => {
        throw new Error('Unexpected single solve');
      },
      solveBatch: async () => {
        const start = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 5));
        recoverySetupMs += performance.now() - start;
        return [
          {
            route: { status: 'no-verified-route' },
            reason: 'timeout',
            connections: [],
            diagnostics: { truncated: true },
          },
        ];
      },
      close: async () => {},
    },
    [{ id: 'restart', query: { starts: [], goal: [0, 0, 0] } }],
    { maxVertical: 0.5 },
    undefined,
    2,
    () => recoverySetupMs,
    [{ id: 'warmup', query: { starts: [], goal: [1, 0, 0] } }],
  );
  assert.ok(report.warmup.recoverySetupMs >= 4);
  assert.ok(report.batch.recoverySetupMs >= 8);
  assert.equal(report.batch.samples.length, 2);
  assert.ok(report.batch.totalWallMs >= report.batch.recoverySetupMs);
  assert.ok(report.intervals.shutdown.endedMs >= report.intervals.queries.endedMs);
  assert.equal(
    report.batch.recoverySetupMs,
    report.batch.samples.reduce((sum, sample) => sum + sample.recoverySetupMs, 0),
  );
  assert.equal(report.warmup.quality.timedOut, 1);
  assert.equal(report.batch.successfulQueriesPerSecond, 0);
});

test('renaming a measured query cannot leak it into warmup, and invalid runs close', async () => {
  let calls = 0,
    closes = 0;
  const query: RouteQuery = {
    starts: [{ id: 'measured-start', position: [0, 0, 0], state: 'available', cost: 0 }],
    goal: [1, 2, 3],
  };
  await assert.rejects(
    runBenchmark(
      {
        config: gangliaV1Defaults,
        solve: async () => {
          throw new Error('unused');
        },
        solveBatch: async () => {
          calls++;
          return [];
        },
        close: async () => {
          closes++;
        },
      },
      [{ id: 'holdout', query }],
      { maxVertical: 0.5 },
      undefined,
      1,
      undefined,
      [
        {
          id: 'renamed',
          query: {
            ...structuredClone(query),
            starts: query.starts.map((start) => ({ ...start, id: 'renamed-start' })),
          },
        },
      ],
    ),
    /must be disjoint/,
  );
  assert.equal(calls, 0);
  assert.equal(closes, 1);
});

test('a solver cannot improve benchmark quality by understating the trace cost', async () => {
  const result: RouteResult = {
    route: {
      status: 'complete',
      start: 'start',
      arrivalCost: 0,
      cost: 0.01,
      length: 1,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      segments: [
        {
          mode: 'walk',
          points: [
            [0, 0, 0],
            [1, 0, 0],
          ],
          times: [0, 1],
        },
      ],
    },
    connections: [],
    diagnostics: { truncated: false },
  };
  const report = await runBenchmark(
    {
      config: { algorithm: 'test', batchConcurrency: 1 },
      solve: async () => result,
      solveBatch: async () => [result],
      close: async () => {},
    },
    [{ id: 'one', query: { starts: [], goal: [1, 0, 0] } }],
    { maxVertical: 0.5 },
  );
  assert.equal(report.batch.results[0].status, 'invalid-route');
  assert.equal(report.batch.results[0].cost, null);
  assert.equal(qualityGate(report.batch.results, undefined).passed, false);
});
