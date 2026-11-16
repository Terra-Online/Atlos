import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { gangliaV1Defaults, type RouteQuery } from '@opendfieldmap/ganglia';

import { resetTimings } from '#@/bench/timings.ts';
import { prepareWorkerSolver, type WorkerResult } from '#@/bench/workers.ts';

const query = (id: string, delay = 5, mode = 0): RouteQuery => ({
  starts: [{ id, position: [0, 0, 0], state: 'available', cost: 0 }],
  goal: [delay, mode, 0],
});
const prepare = (
  count = 2,
  concurrency = count,
  dataRoot = '',
  timeoutMs?: number,
  extra: Pick<
    Parameters<typeof prepareWorkerSolver>[0],
    'preparation' | 'onRegion' | 'onResult'
  > = {},
) =>
  prepareWorkerSolver({
    count,
    config: { ...gangliaV1Defaults, batchConcurrency: concurrency },
    dataRoot,
    extractor: '',
    entry: new URL('./fixtures/scene-worker.ts', import.meta.url),
    timeoutMs,
    ...extra,
  });

test('whole-query workers return ordered batches, aggregate measured work and drain accepted queries on close', async () => {
  const { solver, timings, metadata } = await prepare();
  const warm = await solver.solveBatch([query('warm'), query('warm-2')]);
  assert.notEqual(warm[0].reason, warm[1].reason);
  resetTimings(timings);
  const batch = solver.solveBatch([query('first', 35), query('second'), query('third')]);
  const closing = solver.close();
  assert.equal(solver.close(), closing);
  await assert.rejects(solver.solve(query('late')), /closed/);
  const reports = await batch;
  assert.deepEqual(
    reports.map((value) => (value.route.status === 'complete' ? value.route.start : null)),
    ['first', 'second', 'third'],
  );
  assert.notEqual(reports[0].reason, reports[1].reason);
  assert.equal(timings.physical.calls, 3);
  assert.equal(timings.normalizationMs, 6);
  assert.equal(timings.physical.stagesMs.ground, 9);
  assert.deepEqual(timings.physical.preparation.ground, { hits: 3, misses: 0 });
  assert.equal(metadata.execution.workers, 2);
  await closing;
});

test('query errors preserve the worker but an actual crash rejects the run without replacement', async () => {
  const { solver } = await prepare(1);
  try {
    const [failed, next] = await solver.solveBatch([query('rejected', 0, 2), query('next')]);
    assert.equal(failed.reason, 'execution-error:fixture failure');
    assert.equal(failed.route.status, 'no-verified-route');
    assert.equal(next.route.status, 'complete');
    assert.equal((await solver.solve(query('next'))).route.status, 'complete');
    await assert.rejects(
      solver.solveBatch([query('crashed', 0, 1), query('queued')]),
      /exited unexpectedly/,
    );
    await assert.rejects(solver.solve(query('later')), /exited unexpectedly/);
  } finally {
    await solver.close();
  }
});

test('each prepared worker receives the entire ordered training set before freezing', async () => {
  const prepared = await prepare(2);
  try {
    await prepared.setCatalogPhase('training');
    const results = await prepared.train([query('train-a'), query('train-b')]);
    await prepared.setCatalogPhase('frozen');
    assert.equal(results.length, 2);
    for (const worker of results) {
      assert.deepEqual(
        worker.map((result) => (result.route.status === 'complete' ? result.route.start : null)),
        ['train-a', 'train-b'],
      );
      assert.equal(worker[0].reason, worker[1].reason);
    }
    assert.notEqual(results[0][0].reason, results[1][0].reason);
    assert.ok(prepared.catalogStatsAll().every((stats) => stats.phase === 'frozen'));
  } finally {
    await prepared.solver.close();
  }
});

test('queued requests separate service latency from client response and worker readiness costs', async () => {
  const { solver, metadata } = await prepare(1);
  try {
    const results = await solver.solveBatch([query('blocking', 40), query('queued', 2)]);
    const { diagnostics } = results[1] as WorkerResult;
    assert.ok(diagnostics.queueMs >= 30);
    assert.ok(diagnostics.responseMs >= diagnostics.queueMs + diagnostics.solveWallMs);
    assert.equal(metadata.execution.preparation[0].inputLoadMs, 1);
    assert.equal(metadata.execution.preparation[0].preparationMs, 2);
    assert.ok(metadata.execution.memory.ready[0]!.rssBytes > 0);
  } finally {
    await solver.close();
  }
});

test('single-query events and external abort preserve the same worker for the next query', async () => {
  const { solver } = await prepare(1);
  const controller = new AbortController();
  let events = 0;
  try {
    const aborted = await solver.solve(query('cancel', 25, 3), {
      signal: controller.signal,
      onEvent: () => {
        events++;
        controller.abort();
      },
    });
    assert.equal(events, 1);
    assert.equal(aborted.reason, 'aborted');
    assert.equal((await solver.solve(query('next'))).route.status, 'complete');
    await assert.rejects(
      solver.solve(query('observer'), {
        onEvent: () => {
          throw new Error('observer failed');
        },
      }),
      /observer failed/,
    );
    const alreadyAborted = await solver.solveBatch([query('cancelled-1'), query('cancelled-2')], {
      signal: controller.signal,
    });
    assert.ok(alreadyAborted.every((result) => result.reason === 'aborted'));
  } finally {
    await solver.close();
  }
});

test('a soft deadline waits for the current stage and retains the trained worker', async () => {
  const prepared = await prepare(1, 1, '', 250);
  try {
    await prepared.setCatalogPhase('training');
    const [[trained]] = await prepared.train([query('training', 1)]);
    await prepared.setCatalogPhase('frozen');
    const [expired, next] = await prepared.solver.solveBatch([
      query('long-stage', 500, 4),
      query('next', 1),
    ]);
    assert.equal(expired.reason, 'timeout');
    assert.equal(expired.route.status, 'no-verified-route');
    assert.equal(expired.diagnostics.truncated, true);
    assert.equal((expired as WorkerResult).diagnostics.timedOut, true);
    assert.equal(expired.diagnostics.candidateAttempts, 1);
    assert.ok((expired as WorkerResult).diagnostics.solveWallMs >= 500);
    assert.equal(next.route.status, 'complete');
    assert.equal(next.reason, trained.reason);
    assert.equal(prepared.catalogStats().added, 1);
    assert.equal(prepared.catalogStats().phase, 'frozen');
  } finally {
    await prepared.solver.close();
  }
});

test('phase checkpoints cancel microtask-heavy work without IPC delivery or worker replacement', async () => {
  const prepared = await prepare(1, 1, '', 250);
  try {
    await prepared.setCatalogPhase('training');
    const [[trained]] = await prepared.train([query('training', 1)]);
    await prepared.setCatalogPhase('frozen');
    const [expired, next] = await prepared.solver.solveBatch([
      query('microtask-stages', 2000, 9),
      query('next', 1),
    ]);
    assert.equal(expired.reason, 'timeout');
    assert.ok((expired as WorkerResult).diagnostics.solveWallMs < 1200);
    assert.equal(next.route.status, 'complete');
    assert.equal(next.reason, trained.reason);
    assert.equal(prepared.catalogStats().added, 1);
    assert.equal(prepared.catalogStats().phase, 'frozen');
  } finally {
    await prepared.solver.close();
  }
});

test('a cancelling query leaves a healthy peer available', async () => {
  const { solver } = await prepare(2);
  const controller = new AbortController();
  let peer: Promise<import('@opendfieldmap/ganglia').RouteResult> | undefined;
  try {
    const active = solver.solve(query('long-stage', 200, 4), {
      signal: controller.signal,
      onEvent() {
        controller.abort();
        peer = solver.solve(query('peer', 1));
      },
    });
    const stopped = await active;
    assert.equal(stopped.reason, 'aborted');
    assert.equal((await peer!).route.status, 'complete');
    assert.equal((await solver.solve(query('later'))).route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('worker startup failures reject preparation and close sibling processes', async () => {
  await assert.rejects(prepare(2, 2, 'startup-failure'), /exited unexpectedly/);
});

test('an unexpected process failure during close rejects cleanup', async () => {
  const { solver } = await prepare(1, 1, 'close-failure');
  await assert.rejects(solver.close(), /exited unexpectedly/);
});

test('preparation retains append-only region growth after cooperative cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-preparation-'));
  const regions: string[] = [];
  const prepared = await prepare(1, 1, directory, 250, {
    preparation: { config: 'fixture' },
    onRegion: (files) => regions.push(files.ground),
  });
  try {
    assert.equal((await prepared.solver.solve(query('export', 1, 6))).route.status, 'complete');
    assert.deepEqual(regions, [join(directory, 'fixture-region')]);
    assert.equal(prepared.metadata.hashes.region, 'new-region');
    assert.equal(prepared.metadata.inputBytes, 2);
    const [timeout] = await prepared.solver.solveBatch([query('blocked', 500, 4)]);
    assert.equal(timeout.reason, 'timeout');
    assert.equal(prepared.recoveryCount, 0);
    await prepared.solver.solveBatch([]);
    assert.equal(prepared.recoverySetupMs, 0);
    assert.equal(prepared.metadata.hashes.region, 'new-region');
    assert.equal((await prepared.solver.solve(query('next', 1))).route.status, 'complete');
    await assert.rejects(prepared.solver.solve(query('changed-input', 1, 7)), /identity mismatch/);
  } finally {
    await prepared.solver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('benchmark mode rejects input growth instead of treating it as preparation', async () => {
  const { solver } = await prepare(1);
  try {
    await assert.rejects(solver.solve(query('unexpected-input', 1, 6)), /identity mismatch/);
  } finally {
    await solver.close();
  }
});

test('worker snapshots must match, and an explicit lower concurrency limits active query execution', async () => {
  await assert.rejects(prepare(2, 2, 'mismatch'), /identity mismatch/);
  const { solver, metadata } = await prepare(2, 1);
  try {
    assert.equal(metadata.execution.lanes, 1);
    const order: string[] = [];
    const first = solver
      .solve(query('one', 20), { onEvent: () => order.push('start-one') })
      .then((result) => {
        order.push('end-one');
        return result;
      });
    const second = solver
      .solve(query('two'), { onEvent: () => order.push('start-two') })
      .then((result) => {
        order.push('end-two');
        return result;
      });
    await Promise.all([first, second]);
    assert.deepEqual(order, ['start-one', 'end-one', 'start-two', 'end-two']);
  } finally {
    await solver.close();
  }
});

test('cooperative timeout preserves the trained worker for subsequent queries', async () => {
  const prepared = await prepare(1, 1, '', 250);
  try {
    await prepared.setCatalogPhase('training');
    const [[trained]] = await prepared.train([query('training', 1)]);
    await prepared.setCatalogPhase('frozen');
    const [expired, next] = await prepared.solver.solveBatch([
      query('slow', 1000),
      query('next', 1),
    ]);
    assert.equal(expired.reason, 'timeout');
    assert.equal(next.route.status, 'complete');
    assert.equal(next.reason, trained.reason);
    assert.equal(prepared.recoveryCount, 0);
    assert.equal(prepared.catalogStats().phase, 'frozen');
    assert.equal(prepared.catalogStats().added, 1);
  } finally {
    await prepared.solver.close();
  }
});

test('a failed result journal rejects the request and closes the worker pool', async () => {
  const error = new Error('journal unavailable');
  const prepared = await prepare(1, 1, '', undefined, {
    onResult() {
      throw error;
    },
  });
  await assert.rejects(prepared.solver.solveBatch([query('first'), query('queued')]), error);
  await prepared.solver.close();
});
