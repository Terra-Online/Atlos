import assert from 'node:assert/strict';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { gangliaV1Defaults, type RouteQuery } from '@opendfieldmap/ganglia';

import { resetTimings } from '#@/bench/timings.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';

const query = (id: string, delay = 5, mode = 0): RouteQuery => ({
  starts: [{ id, position: [0, 0, 0], state: 'available', cost: 0 }],
  goal: [delay, mode, 0],
});
const prepare = (
  count = 2,
  concurrency = count,
  dataRoot = '',
  timeoutMs?: number,
  extra: Pick<Parameters<typeof prepareWorkerSolver>[0], 'preparation' | 'onRegion'> = {},
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

test('query errors reject while a crashed search is recorded and queued requests continue', async () => {
  const { solver } = await prepare(1);
  try {
    await assert.rejects(solver.solve(query('rejected', 0, 2)), /fixture failure/);
    assert.equal((await solver.solve(query('recovered'))).route.status, 'complete');
    const crashed = solver.solve(query('crashed', 0, 1));
    const queued = solver.solve(query('queued'));
    const [failed, next] = await Promise.all([crashed, queued]);
    assert.equal(failed.route.status, 'no-verified-route');
    assert.equal(failed.reason, 'worker-exited:2');
    assert.equal(next.route.status, 'complete');
    assert.equal((await solver.solve(query('later'))).route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('single-query events and external abort preserve next-query execution after replacement', async () => {
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

test('blocked synchronous queries hit the service deadline and queued queries use a fresh process', async () => {
  const prepared = await prepare(1, 1, 'slow-start', 40);
  const { solver, timings, metadata } = prepared;
  try {
    const first = await solver.solve(query('before', 1));
    const batch = solver.solveBatch([query('blocked', 180, 4), query('queued', 1)]);
    const closing = solver.close();
    const [timeout, next] = await batch;
    assert.equal(timeout.route.status, 'no-verified-route');
    assert.equal(timeout.reason, 'timeout');
    assert.equal(timeout.diagnostics.truncated, true);
    assert.equal('partial' in timeout.route, false);
    const diagnostic = timeout.diagnostics as typeof timeout.diagnostics & {
      timedOut: boolean;
      solveWallMs: number;
    };
    assert.equal(diagnostic.timedOut, true);
    assert.ok(diagnostic.solveWallMs >= 40);
    assert.equal(next.route.status, 'complete');
    assert.notEqual(next.reason, first.reason);
    assert.equal(timings.physical.calls, 2, 'Killed work cannot report a late successful solve');
    assert.equal(metadata.execution.mode, 'child-processes');
    assert.ok(prepared.recoverySetupMs >= 80, 'Replacement loading is separate from service time');
    await closing;
  } finally {
    await solver.close();
  }
});

test('timeout recovery waits for active peers before reloading or dispatching queued work', async () => {
  const prepared = await prepare(2, 2, '', 100);
  const { solver } = prepared;
  let peerFinished = false;
  try {
    const blocked = solver.solve(query('blocked', 250, 4));
    await new Promise((resolve) => setTimeout(resolve, 35));
    const peer = solver.solve(query('peer', 80)).then((result) => {
      peerFinished = true;
      return result;
    });
    const queued = solver.solve(query('queued', 1), { onEvent: () => assert.ok(peerFinished) });
    const results = await Promise.all([blocked, peer, queued]);
    assert.deepEqual(
      results.map((result) => result.route.status),
      ['no-verified-route', 'complete', 'complete'],
    );
    assert.equal(results[0].reason, 'timeout');
    assert.ok(prepared.recoverySetupMs > 0);
    // The killed old process would have replied by now if it could contaminate
    // the slot; the replacement remains usable with its independent task IDs.
    await new Promise((resolve) => setTimeout(resolve, 160));
    assert.equal((await solver.solve(query('later', 1))).route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('the deadline kills exporter descendants in the worker process group', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-worker-'));
  const marker = join(directory, 'orphan');
  const { solver } = await prepare(1, 1, '', 60);
  try {
    assert.equal((await solver.solve(query(marker, 400, 5))).reason, 'timeout');
    assert.equal((await solver.solve(query('next', 1))).route.status, 'complete');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(access(marker), { code: 'ENOENT' });
  } finally {
    await solver.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('worker startup failures reject preparation and close sibling processes', async () => {
  await assert.rejects(prepare(2, 2, 'startup-failure'), /exited unexpectedly/);
});

test('catalog and benchmark phases reach the solving process and survive timeout replacement', async () => {
  const prepared = await prepare(1, 1, '', 60);
  try {
    await prepared.setCatalogPhase('training');
    assert.equal(prepared.catalogStats().phase, 'training');
    await prepared.setCatalogPhase('frozen');
    await prepared.setBenchmarkPhase('prewarm');
    const [timeout] = await prepared.solver.solveBatch([query('blocked', 250, 4)]);
    assert.equal(timeout.reason, 'timeout');
    assert.equal(prepared.catalogStats().phase, 'frozen');
    await prepared.setBenchmarkPhase('batch');
    assert.equal((await prepared.solver.solve(query('next', 1))).route.status, 'complete');
    assert.equal(prepared.recoveryCount, 1);
  } finally {
    await prepared.solver.close();
  }
});

test('an unexpected process failure during close rejects cleanup', async () => {
  const { solver } = await prepare(1, 1, 'close-failure');
  await assert.rejects(solver.close(), /exited unexpectedly/);
});

test('preparation accepts append-only region growth, reports it, and reloads it after timeout', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-preparation-'));
  const regions: string[] = [];
  const prepared = await prepare(1, 1, directory, 50, {
    preparation: { config: 'fixture' },
    onRegion: (files) => regions.push(files.ground),
  });
  try {
    assert.equal((await prepared.solver.solve(query('export', 1, 6))).route.status, 'complete');
    assert.deepEqual(regions, [join(directory, 'fixture-region')]);
    assert.equal(prepared.metadata.hashes.region, 'new-region');
    assert.equal(prepared.metadata.inputBytes, 2);
    const [timeout] = await prepared.solver.solveBatch([query('blocked', 150, 4)]);
    assert.equal(timeout.reason, 'timeout');
    assert.equal(prepared.recoveryCount, 1, 'Batch return waits until replacement is ready');
    assert.ok(prepared.recoverySetupMs > 0);
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
