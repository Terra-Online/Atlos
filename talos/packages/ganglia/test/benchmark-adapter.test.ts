import assert from 'node:assert/strict';
import { test } from 'node:test';

import { qualityGate } from '#@/bench/quality.ts';
import { runBenchmark } from '#@/bench/run.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
for (const goal of [1, 2])
  test(`independent solver uses the common verifier for goal ${goal}`, async () => {
    const prepared = await prepareWorkerSolver({
      count: 1,
      config: { algorithm: 'independent', batchConcurrency: 1 },
      dataRoot: '',
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
            goal: [goal, 0, 0],
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
    assert.equal(qualityGate(report.batch.results, undefined).passed, goal === 1);
    assert.equal(report.batch.results[0].cost, goal === 1 ? 1 : null);
  });
