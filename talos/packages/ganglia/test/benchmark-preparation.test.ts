import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadAdapter } from '#@/bench/adapter.ts';
import { benchmarkPreparation } from '#@/bench/preparation.ts';
import { runBenchmark, type Case } from '#@/bench/run.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

const request = (id: number): Case => ({
  id: String(id),
  query: {
    starts: [{ id: 'player', position: [id, 0, 0], state: 'available', cost: 0 }],
    goal: [id, 0, 0],
  },
});
const result = (query: RouteQuery): RouteResult => ({
  route: {
    status: 'complete',
    start: 'player',
    cost: 0,
    arrivalCost: 0,
    length: 0,
    points: [query.goal],
    segments: [],
  },
  connections: [],
  diagnostics: { truncated: false },
});
const catalog = {
  ids: Array.from({ length: 10 }, (_, i) => `training-${i}`),
  perWorker: [{ stats: { phase: 'frozen' } }],
};

for (const name of ['ganglia-v1', 'ganglia-v1-ts', 'ganglia-v1-rust'])
  test(`${name} defaults bind required preparation and reject unprepared measurement`, async () => {
    const adapter = await loadAdapter(name === 'ganglia-v1' ? undefined : name);
    const preparation = benchmarkPreparation(adapter.defaults, adapter, 'map02');
    assert.equal(preparation.training.length, 10);
    assert.equal(preparation.warmup.length, 2);
    let calls = 0,
      closed = false;
    await assert.rejects(
      runBenchmark(
        {
          config: adapter.defaults,
          async solve(query) {
            calls++;
            return result(query);
          },
          async solveBatch(queries) {
            calls++;
            return queries.map(result);
          },
          async close() {
            closed = true;
          },
        },
        [request(100)],
        { maxVertical: 0.5 },
      ),
      /trained, frozen catalogs/,
    );
    assert.equal(calls, 0);
    assert.equal(closed, true);
  });

test('missing, disabled or unsatisfied V1 preparation cannot silently change the algorithm', async () => {
  const adapter = await loadAdapter('ganglia-v1-rust');
  assert.throws(
    () =>
      benchmarkPreparation({ algorithm: 'ganglia-v1-rust', batchConcurrency: 1 }, adapter, 'map02'),
    /requires positive/,
  );
  for (const preparation of [
    { trainingQueries: 0, warmupQueries: 2 },
    { trainingQueries: 10, warmupQueries: 0 },
    { trainingQueries: 11, warmupQueries: 2 },
  ])
    assert.throws(() =>
      benchmarkPreparation({ ...adapter.defaults, preparation }, adapter, 'map02'),
    );
});

test('V1 scores only after frozen training and successful configured warmup', async () => {
  for (const validWarmup of [false, true]) {
    const batches: number[][] = [];
    let closed = false;
    const run = runBenchmark(
      {
        config: gangliaV1Defaults,
        async solve(query) {
          return result(query);
        },
        async solveBatch(queries) {
          batches.push(queries.map((query) => query.goal[0]));
          return queries.map((query) => result(validWarmup ? query : request(999).query));
        },
        async close() {
          closed = true;
        },
      },
      [request(100)],
      { maxVertical: 0.5 },
      undefined,
      1,
      undefined,
      [request(1), request(2)],
      undefined,
      catalog,
    );
    if (validWarmup) {
      const report = await run;
      assert.equal(report.batch.quality.completed, 1);
      assert.deepEqual(batches, [[1, 2], [100]]);
    } else {
      await assert.rejects(run, /warmup failed/);
      assert.deepEqual(batches, [[1, 2]]);
    }
    assert.equal(closed, true);
  }
});

test('an unfrozen catalog cannot enter V1 warmup or scoring', async () => {
  const adapter = await loadAdapter('ganglia-v1-rust');
  const preparation = benchmarkPreparation(adapter.defaults, adapter, 'map02');
  const { requirePreparedCatalog } = await import('#@/bench/preparation.ts');
  assert.throws(
    () =>
      requirePreparedCatalog(
        adapter.defaults,
        { ...catalog, perWorker: [{ stats: { phase: 'training' } }] },
        preparation.warmup,
      ),
    /trained, frozen catalogs/,
  );
});
