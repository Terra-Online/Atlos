import assert from 'node:assert/strict';
import { test } from 'node:test';

import { regions, sample, checkBinding } from '#@/scripts/research/collect.ts';
import {
  random,
  train,
  rank,
  crossEntropy,
  withFallback,
  featureNames,
  checkSplits,
} from '#@/scripts/research/policy.ts';
import type { Surface } from '#@/src/geometry.ts';

test('sampling stays inside supported triangles and follows projected area instead of triangle count', () => {
  const floor = (id: string, x: number, length: number): Surface => ({
    id,
    vertices: [
      [x, 0, 0],
      [x + length, 0, 0],
      [x, 0, 1],
    ],
  });
  const group = [...regions([floor('small', 0, 1), floor('large', 2, 3)], 100).values()][0];
  const rng = random(7),
    counts: Record<string, number> = { small: 0, large: 0 };
  for (let i = 0; i < 4000; i++) {
    const point = sample(group, rng(), rng());
    counts[point.surface]++;
    const x = point.position[0] - (point.surface === 'small' ? 0 : 2);
    const length = point.surface === 'small' ? 1 : 3;
    assert.ok(x >= 0 && point.position[2] >= 0 && x / length + point.position[2] <= 1 + 1e-12);
  }
  assert.ok(counts.large > 2.7 * counts.small && counts.large < 3.3 * counts.small);
});

test('training ignores censored decisions and learns only tested witness labels', () => {
  const features = (value: number) => Array<number>(featureNames.length).fill(value);
  const rows = [
    { features: features(0), valid: false },
    { features: features(1), valid: true },
  ];
  const a = train([{ decisions: rows }]);
  const b = train([
    { unresolved: true, decisions: [...rows, { features: features(100), valid: null }] },
  ]);
  assert.deepEqual(a, b);
  assert.equal(rank(rows, a)[0].valid, true);
  assert.throws(
    () => train([{ decisions: [{ features: features(0), valid: null }] }]),
    /positive and negative/,
  );
});

test('CEM keeps a finite validation budget and fallback retains every original witness after total failure', () => {
  const baseline = Array.from({ length: 20 }, (_, i) => ({ id: `original-${i}` }));
  let calls = 0;
  const primary = crossEntropy({
    rng: random(9),
    budget: 19,
    population: 8,
    propose: (vector, i) => ({
      id: `new-${i}`,
      vector,
      heuristic: vector[0],
      features: Array(featureNames.length).fill(0),
    }),
    evaluate: (row) => {
      calls++;
      return { ...row, valid: false };
    },
  });
  assert.equal(calls, 19);
  assert.equal(primary.length, 19);
  assert.deepEqual(withFallback(primary, baseline).slice(19), baseline);
  assert.deepEqual(withFallback([baseline[0]], baseline), baseline);
});

test('the collector refuses mixed physical snapshots and character profiles', () => {
  const source = { buildGuid: 'build', contentHash: 'source' },
    profile = { radius: 0.3, height: 1.7 };
  const ground = { scene: 'map01', source, selection: { state: 1 }, options: { profile } };
  const collision = structuredClone(ground),
    movement = { source, defaultProfile: profile };
  assert.doesNotThrow(() => checkBinding(ground, collision, movement));
  collision.selection.state = 2;
  assert.throws(() => checkBinding(ground, collision, movement), /mismatch/);
  collision.selection.state = 1;
  collision.options.profile.radius = 0.4;
  assert.throws(() => checkBinding(ground, collision, movement), /mismatch/);
});

test('overlapping windows from the same level cannot cross training and holdout splits', () => {
  const a = { map: 'map01', level: 'level-a', split: 'train' };
  assert.throws(() => checkSplits([a, { ...a, split: 'test' }]), /leaks/);
  assert.equal(
    checkSplits([a, { ...a }, { map: 'map02', level: 'level-b', split: 'test' }]).size,
    2,
  );
});
