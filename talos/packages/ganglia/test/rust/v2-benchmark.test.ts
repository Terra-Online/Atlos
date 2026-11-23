import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createKernel } from '#@/bench/kernel.ts';
import { createScenario } from '#@/bench/scenario.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import type { V2Result } from '#@/src/solver/ganglia-v2-rust.ts';
import { gangliaV2Defaults } from '#@/src/solver/ganglia-v2.ts';

test('v2 benchmark preserves build and per-round measurements across deferred worker preparation', async () => {
  const input = await prepareWorkerSolver({
    count: 1,
    config: gangliaV2Defaults,
    dataRoot: '',
    extractor: '',
    entry: new URL('../fixtures/v2-worker.ts', import.meta.url),
    deferKernel: true,
  });
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-2, 0, 0], cost: 0, state: 'available' }],
    goal: [2, 0, 0],
  };
  const kernel = createKernel(createScenario('flat', input, [{ id: 'walk', query }], []));
  try {
    await assert.rejects(input.solver.solve(query), /not initialized/);
    const trained = await kernel.train();
    const preparation = input.metadata.execution.preparation[0].diagnostics!;
    assert.ok(Number(preparation.backboneBuildMs) >= 0);
    assert.ok(Number(preparation.nodeCount) > 0);
    assert.equal(input.catalogs()[0], undefined);
    const result = (await trained.query(query)) as V2Result;
    assert.equal(result.route.status, 'complete');
    assert.equal(result.diagnostics.v2.backboneBuildMs, preparation.backboneBuildMs);
    assert.ok(result.diagnostics.v2.rounds.length >= 3);
    assert.ok(result.diagnostics.v2.rounds.every((round) => round.elapsedMs >= 0));
    const verified = await trained.verify(query, result);
    assert.equal(verified.valid, true, verified.issues.join('; '));
    assert.deepEqual(input.metadata.execution.preparation[0].diagnostics, preparation);
  } finally {
    await kernel.close();
  }
});
