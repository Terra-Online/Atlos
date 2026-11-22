import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { inputGroups } from '#@/bench/mechanisms/prepare.ts';
import { readSuite } from '#@/bench/mechanisms/suite.ts';

test('preparation registers one pack per scene for both fixed and dynamic scenarios', async () => {
  const suite = await readSuite(
    fileURLToPath(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url)),
  );
  const { inputs } = inputGroups(suite);
  assert.deepEqual(inputs, {
    map01: { directory: 'scenes/map01' },
    map02: { directory: 'scenes/map02' },
  });
});
