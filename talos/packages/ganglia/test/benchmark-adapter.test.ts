import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualityGate } from '#@/bench/quality.ts';
import { runBenchmark } from '#@/bench/run.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
for (const goal of [1, 2, 3])
  test(`independent solver uses the common verifier for goal ${goal}`, async () => {
    const prepared = await prepareWorkerSolver({
      count: 1,
      config: { algorithm: 'independent', batchConcurrency: 1 },
      dataRoot: goal === 3 ? 'verifier-error' : '',
      extractor: '',
      entry: new URL('./fixtures/independent-worker.ts', import.meta.url),
    });
    const report = await runBenchmark(
      prepared.solver,
      [
        {
          id: 'one',
          query: {
            starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
            goal: [goal === 3 ? 1 : goal, 0, 0],
          },
        },
      ],
      { maxVertical: 0.5 },
      prepared.setBenchmarkPhase,
      1,
      undefined,
      [],
      prepared.verify,
    );
    assert.equal(qualityGate(report.batch.results, undefined).passed, true);
    assert.equal(report.batch.results[0].status, 'success');
    assert.equal(report.batch.results[0].cost, 1);
    assert.equal(
      report.batch.results[0].verification,
      goal === 1 ? 'valid' : goal === 2 ? 'invalid' : 'error',
    );
  });
