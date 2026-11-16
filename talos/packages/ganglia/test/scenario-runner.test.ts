import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runScenario } from '#@/bench/run.ts';
import { createScenario } from '#@/bench/scenario.ts';
import type { Case } from '#@/bench/suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { sceneSuite, sceneBuilder } from '#@/bench/workload.ts';

const item = (id: string): Case => ({
  id,
  query: {
    starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
    goal: [1, 0, 0],
  },
});

test('scenario runner reuses trained input across measured rounds without warmup and keeps verifier failures independent', async () => {
  const dispatched: string[] = [];
  const input = await prepareWorkerSolver({
    count: 1,
    config: { algorithm: 'independent', batchConcurrency: 1 },
    dataRoot: 'verifier-error',
    extractor: '',
    entry: new URL('./fixtures/independent-worker.ts', import.meta.url),
    onResult() {
      dispatched.push('query');
    },
  });
  const phases: string[] = [];
  const observed: string[] = [];
  const scenario = createScenario('one-world', input, [item('measured')], [item('training')]);
  const report = await runScenario(scenario, {
    rounds: 3,
    onPhase(phase) {
      phases.push(phase);
    },
    onResult(test, _result, verification) {
      observed.push(`${test.id}:${verification.verification}`);
    },
  });
  assert.deepEqual(phases, ['training', 'batch']);
  assert.equal(dispatched.length, 4);
  assert.deepEqual(report.training.ids, ['training']);
  assert.deepEqual(observed, ['measured:error', 'measured:error', 'measured:error']);
  assert.equal(report.batch.successfulQueries, 3);
  assert.equal(report.batch.results[0].status, 'success');
  assert.equal(report.batch.results[0].sameOutcomeAcrossRounds, true);
  assert.deepEqual(report.warmup.ids, []);
  await assert.rejects(input.solver.solve(item('after-close').query), /closed/);
});

test('scenario runner closes resources when a report callback fails after a query', async () => {
  const input = await prepareWorkerSolver({
    count: 1,
    config: { algorithm: 'independent', batchConcurrency: 1 },
    dataRoot: '',
    extractor: '',
    entry: new URL('./fixtures/independent-worker.ts', import.meta.url),
  });
  const scenario = createScenario('one-world', input, [item('measured')], []);
  await assert.rejects(
    runScenario(scenario, {
      onResult() {
        throw new Error('artifact write failed');
      },
    }),
    /artifact write failed/,
  );
  await assert.rejects(input.solver.solve(item('after-close').query), /closed/);
});

test('scene suites preserve measured order independently from overlapping training order', async () => {
  const cases = [item('a'), item('b')];
  const config = { algorithm: 'independent', batchConcurrency: 1 };
  const builder = sceneBuilder({
    config,
    workers: 1,
    extractor: '',
    measured: new Set(['a', 'b']),
    adapter: {
      defaults: config,
      entry: new URL('./fixtures/independent-worker.ts', import.meta.url),
    },
  });
  for await (const scenario of builder.build({ root: '' }, sceneSuite('test', cases, [cases[1]]))) {
    const report = await runScenario(scenario);
    assert.deepEqual(report.training.ids, ['b']);
    assert.deepEqual(
      report.batch.results.map((row) => row.id),
      ['a', 'b'],
    );
  }
});

test('training timeout policy stops later training requests before measurement', async () => {
  let requests = 0;
  const slow = item('slow-training');
  slow.query.goal = [50, 9, 0];
  const input = await prepareWorkerSolver({
    count: 1,
    config: { algorithm: 'fixture', batchConcurrency: 1 },
    dataRoot: '',
    extractor: '',
    timeoutMs: 5,
    entry: new URL('./fixtures/scene-worker.ts', import.meta.url),
    onResult() {
      requests++;
    },
  });
  const scenario = createScenario(
    'one-world',
    input,
    [item('measured')],
    [slow, item('later-training')],
  );
  await assert.rejects(
    runScenario(scenario, {
      onTrainingResult(_test, _index, results) {
        if (results.some((result) => result.reason === 'timeout'))
          throw new Error('training did not reach readiness');
      },
    }),
    /training did not reach readiness/,
  );
  assert.equal(requests, 1);
  await assert.rejects(input.solver.solve(item('after-close').query), /closed/);
});
