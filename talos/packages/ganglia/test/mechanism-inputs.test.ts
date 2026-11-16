import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readMechanismSuite } from '#@/bench/mechanism-suite.ts';
import { inputGroups } from '#@/bench/prepare-mechanisms.ts';

test('service input groups preserve all cases and isolate frozen windows from expandable scenes', async () => {
  const suite = await readMechanismSuite(
    fileURLToPath(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url)),
  );
  const { cases, groups } = inputGroups(suite);
  assert.equal(Object.keys(cases).length, 266);
  for (const item of suite.cases) {
    const group = groups.get(cases[item.id].directory)!;
    assert.equal(group.scene, item.scene);
    assert.deepEqual(
      group.bounds,
      item.setup.physical
        ? suite.physicalRegions.find((r) => r.id === item.setup.physical!.region)!.bounds
        : undefined,
    );
  }
  const frozen = suite.cases.find((c) => c.setup.physical)!;
  const dynamic = suite.cases.find((c) => !c.setup.physical && c.scene === frozen.scene)!;
  assert.notEqual(cases[frozen.id].directory, cases[dynamic.id].directory);
  assert.throws(() => inputGroups({ ...suite, physicalRegions: [] }), /frozen region/);
});
