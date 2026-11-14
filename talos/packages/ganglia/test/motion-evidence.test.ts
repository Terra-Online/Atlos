import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { motionEvidence } from '#@/src/v1/motion/evidence.ts';

test('trace evidence owns its arrays and follows immutable world, surfaces and constraint scopes', () => {
  const world = createCollisionWorld({ positions: [], indices: [] });
  const surfaces: Surface[] = [];
  const evidence = motionEvidence(world, surfaces, 'constraints');
  let computed = 0;
  const source: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
  ];
  const compute = () => {
    computed++;
    return source;
  };
  const first = evidence.trace('walk', compute)!;
  source[0][0] = 10;
  first[1][0] = 20;
  assert.deepEqual(evidence.trace('walk', compute), [
    [0, 0, 0],
    [1, 0, 0],
  ]);
  assert.equal(computed, 1);
  assert.equal(motionEvidence(world, surfaces, 'constraints'), evidence);
  assert.notEqual(motionEvidence(world, [], 'constraints'), evidence);
  assert.notEqual(
    motionEvidence(createCollisionWorld({ positions: [], indices: [] }), surfaces, 'constraints'),
    evidence,
  );
  const changed = motionEvidence(world, surfaces, 'changed walls');
  assert.notEqual(changed, evidence);
  assert.notEqual(motionEvidence(world, surfaces, 'constraints'), evidence);
  const owner = {};
  const prepared = motionEvidence(world, surfaces, 'constraints', owner);
  assert.equal(motionEvidence(world, surfaces, 'constraints', owner), prepared);
  assert.notEqual(motionEvidence(world, surfaces, 'constraints', {}), prepared);
  assert.notEqual(motionEvidence(world, surfaces, 'constraints', '[]'), prepared);

  // Null proofs also consume capacity. FIFO eviction permits later computation
  // without retaining an unbounded history of traversed coordinates.
  for (let index = 0; index < 4096; index++) evidence.trace(String(index), () => null);
  evidence.trace('walk', compute);
  assert.equal(computed, 2);
});

test('standing evidence owns corrected support coordinates and keeps rejection reasons', () => {
  const world = createCollisionWorld({ positions: [], indices: [] });
  const surfaces: Surface[] = [];
  const evidence = motionEvidence(world, surfaces, 'body and walls');
  const foot = { position: [1, 0.005, 2] as Vec3, surface: 'floor' };
  const first = evidence.standing('seed', () => foot);
  assert.ok(!first.reason);
  first.position[0] = 999;
  foot.position[1] = 999;
  assert.deepEqual(
    evidence.standing('seed', () => ({ reason: 'support' })),
    {
      position: [1, 0.005, 2],
      surface: 'floor',
    },
  );
  const blocked = motionEvidence(world, surfaces, 'changed body and walls');
  assert.deepEqual(
    blocked.standing('seed', () => ({ reason: 'clearance' })),
    {
      reason: 'clearance',
    },
  );
});
