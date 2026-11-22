import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { executionSuite } from '#@/bench/adapters/ganglia-v2/scopes.ts';
import { readDataset, scenarioBindings } from '#@/bench/mechanisms/dataset.ts';
import { readSuite } from '#@/bench/mechanisms/suite.ts';
import { collisionName, groundName, manifestName } from '#@/src/scene-pack.ts';

test('v2 mechanism bindings preserve fixed districts when measurement selection changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-v2-districts-'));
  try {
    await mkdir(join(root, 'routing'));
    const inputs = { map01: { directory: 'map01' }, map02: { directory: 'map02' } };
    await writeFile(join(root, 'input-index.json'), JSON.stringify({ inputs }));
    await writeFile(join(root, 'routing/movement-settings-current.json'), '{}');
    for (const scene of Object.keys(inputs)) {
      await mkdir(join(root, scene));
      for (const name of [manifestName, groundName, collisionName])
        await writeFile(join(root, scene, name), '');
      for (const name of ['ground-all', 'traversal-devices', 'interaction-points'])
        await writeFile(join(root, 'routing', `${scene}-${name}.json`), '{}');
    }
    const suiteFile = fileURLToPath(
      new URL('../bench/scenes/mechanisms/suite.json', import.meta.url),
    );
    const authored = await readSuite(suiteFile);
    const suite = executionSuite(authored);
    const dataset = await readDataset(root);
    const selected = await scenarioBindings(dataset, suite, suiteFile, new Set(['136-09yIS3X']));
    const all = await scenarioBindings(
      dataset,
      suite,
      suiteFile,
      new Set(suite.cases.map((c) => c.id)),
    );
    const [id, binding] = [...selected][0];
    assert.equal(binding.sourceScenarioId, 'map01-019');
    assert.deepEqual(binding.preparationBounds, all.get(id)!.preparationBounds);
    assert.deepEqual(binding.preparationBounds, { min: [96, -832], max: [192, -736] });
    assert.deepEqual(binding.ids, ['136-09yIS3X']);
    const bridge = [...all.values()].find((b) => b.ids.includes('249-0ADyrpf'))!;
    assert.deepEqual(bridge.preparationBounds, { min: [-704, -224], max: [-512, 64] });
    const long = [...all.values()].find((b) => b.ids.includes('225-07VoQbO'))!;
    assert.match(long.preparationError!, /512.*tiles|tiles.*512/);
    assert.equal(new Set([...all.values()].flatMap((b) => b.ids)).size, 266);
    const sparse = {
      min: [-1152, -1728] as [number, number],
      max: [1184, 1472] as [number, number],
      tiles: [{ x: 0, z: 0 }],
    };
    const overridden = await scenarioBindings(
      dataset,
      executionSuite(authored, new Map([['225-07VoQbO', sparse]])),
      suiteFile,
      new Set(['225-07VoQbO']),
    );
    const corridor = [...overridden.values()][0];
    assert.deepEqual(corridor.preparationBounds, sparse);
    assert.equal(corridor.preparationError, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
