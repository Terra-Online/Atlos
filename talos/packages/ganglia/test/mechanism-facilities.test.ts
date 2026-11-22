import assert from 'node:assert/strict';
import { test } from 'node:test';

import { facilityAudit } from '#@/bench/mechanisms/assessment.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('facility audit requires source receipts only inside the loaded tile coverage', () => {
  const source = { buildGuid: 'build', contentHash: 'content' };
  const facility = (id: string, x: number) => ({
    id,
    model: 'bridge',
    pose: 'authored',
    positions: [x, 0, 1, x + 1, 0, 1, x, 0, 2],
  });
  const catalog = {
    scene: 'example',
    source,
    staticSupports: [
      facility('left', 2),
      facility('hole', 12),
      facility('right', 22),
      facility('outside', 26),
    ],
  };
  const input = {
    ...physical,
    ground: {
      ...physical.ground,
      build: {
        bounds: { min: [0, 0] as [number, number], max: [25, 10] as [number, number] },
        cellSize: 1,
        tileCells: 10,
      },
      tiles: [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
    },
    collision: {
      ...physical.collision,
      source,
      coverage: { staticSupports: [facility('left', 2), facility('right', 22)] },
    },
  };
  const sparse = facilityAudit(input, catalog);
  assert.equal(sparse.staticImport, 'matched');
  assert.equal(sparse.expected, 2);
  assert.deepEqual(sparse.missing, []);

  const rectangle = facilityAudit(
    { ...input, ground: { ...input.ground, tiles: undefined } },
    catalog,
  );
  assert.equal(rectangle.staticImport, 'incomplete');
  assert.deepEqual(rectangle.missing, ['hole']);
  const missingInput = {
    ...input,
    collision: { ...input.collision, coverage: { staticSupports: [] } },
  };
  const missing = facilityAudit(missingInput, catalog);
  assert.deepEqual(missing.missing, ['left', 'right']);
  const mismatchedInput = {
    ...input,
    collision: {
      ...input.collision,
      coverage: {
        staticSupports: [
          { ...facility('left', 2), model: 'other-model' },
          { ...facility('right', 22), pose: 'other-pose' },
        ],
      },
    },
  };
  const mismatched = facilityAudit(mismatchedInput, catalog);
  assert.equal(mismatched.staticImport, 'incomplete');
  assert.deepEqual(mismatched.mismatched, ['left', 'right']);
  const wrongSource = {
    ...input,
    collision: { ...input.collision, source: { ...source, contentHash: 'other' } },
  };
  assert.throws(() => facilityAudit(wrongSource, catalog), /source differ/);
});
