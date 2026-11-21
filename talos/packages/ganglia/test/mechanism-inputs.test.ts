import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { inputGroups } from '#@/bench/mechanisms/prepare.ts';
import { readSuite } from '#@/bench/mechanisms/suite.ts';

test('preparation registers distinct fixed and dynamic inputs in the Dataset', async () => {
  const suite = await readSuite(
    fileURLToPath(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url)),
  );
  const { groups, index } = inputGroups(suite);
  const scene = index.inputs.map01;
  assert.equal(scene.dynamic?.directory, 'scenarios/map01-dynamic');
  assert.equal(scene.regions.map01_lv001.directory, 'scenarios/map01-map01_lv001');
  const fixed = groups.get(scene.regions.map01_lv001.directory);
  assert.equal(fixed?.kind, 'frozen-window');
  assert.deepEqual(fixed && 'bounds' in fixed && fixed.bounds, [-256, -576, -64, -384]);
  assert.deepEqual(groups.get('scenarios/map01-dynamic'), {
    kind: 'dynamic',
    scene: 'map01',
  });
});
