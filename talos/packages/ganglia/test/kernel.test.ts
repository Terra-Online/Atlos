import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { createKernel } from '#@/bench/kernel.ts';
import { createScenario } from '#@/bench/scenario.ts';
import type { Case } from '#@/bench/suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';

const item = (id: string, goal = 1): Case => ({
  id,
  query: {
    starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
    goal: [goal, 0, 0],
  },
});

test('kernel trains every custom worker in declared order and retains verifier ownership', async () => {
  const seen: number[] = [];
  const input = await prepareWorkerSolver({
    count: 2,
    config: { algorithm: 'independent', batchConcurrency: 2 },
    dataRoot: '',
    extractor: '',
    entry: new URL('./fixtures/independent-worker.ts', import.meta.url),
    onResult: (query) => seen.push(query.goal[0]),
  });
  const scenario = createScenario('custom', input, [item('measured')], [item('b', 2), item('a')]);
  const kernel = createKernel(scenario);
  try {
    assert.throws(() => createKernel(scenario), /already belongs/);
    const trained = await kernel.train();
    assert.deepEqual(seen, [2, 2, 1, 1]);
    assert.deepEqual(trained.training.ids, ['b', 'a']);
    assert.deepEqual(
      trained.training.perWorker.map((worker) => worker.results.length),
      [2, 2],
    );
    await assert.rejects(kernel.train(), /only be trained once/);
    const pending = trained.query(item('measured').query);
    await assert.rejects(trained.query(item('overlap').query), /must not overlap/);
    const result = await pending;
    assert.equal((await trained.verify(item('measured').query, result)).valid, true);
    const batch = await trained.queryBatch([item('one').query, item('two').query]);
    for (const result of batch)
      assert.equal((await trained.verify(item('measured').query, result)).valid, true);
    await trained.close();
    await assert.rejects(trained.query(item('closed').query), /not available/);
  } finally {
    await kernel.close();
  }
});

test('worker-host loads a deferred scene before initializing its solver and reports initialization errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-deferred-kernel-'));
  try {
    const file = join(directory, 'worker.mjs');
    const host = new URL('../bench/adapters/ganglia-v1/worker-host.ts', import.meta.url).href;
    await writeFile(
      file,
      `import { serveWorker } from ${JSON.stringify(host)};
      serveWorker(async () => ({
        input: {}, inputLoadMs: 1, timings: { preparationMs: 0 },
        metadata: { scene: 'deferred', source: {}, hashes: {}, gameAdapterSha256: 'test',
          kernelSha256: 'test', resolvedKernel: 'test', inputBytes: 0,
          rules: { maxVertical: 0.5 }, execution: { mode: 'test', workers: 1, lanes: 1 } }
      }));`,
    );
    const input = await prepareWorkerSolver({
      count: 1,
      config: {
        algorithm: 'unsupported',
        batchConcurrency: 1,
        preparation: { trainingQueries: 1, warmupQueries: 1 },
      },
      dataRoot: '',
      extractor: '',
      entry: pathToFileURL(file),
      deferKernel: true,
    });
    try {
      assert.equal(input.metadata.scene, 'deferred');
      await assert.rejects(input.solver.solve(item('early').query), /not initialized/);
      await assert.rejects(input.initialize(), /Unsupported solver algorithm/);
    } finally {
      await input.solver.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
