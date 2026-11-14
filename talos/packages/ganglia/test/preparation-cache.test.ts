import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';

test('physical queries reuse both wall views while solving each requested endpoint afresh', async () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [0, 0, 10],
    [10, 0, 10],
    [10, 0, 0],
  ];
  const wall = { min: [4, -1, -1] as Vec3, max: [6, 3, 11] as Vec3, state: 'active' as const };
  const input: PhysicalInput = {
    ground: {
      surfaces: [{ id: 'floor', vertices }],
      options: { walls: [wall], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
    },
    collision: { positions: vertices.flat(), indices: [0, 1, 2, 0, 2, 3] },
    roundedWalls: [{ ...wall, state: 'inactive' }],
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 10,
        maxJumpHeight: 1,
        maxFallingSpeed: 10,
        apexTime: 0,
        maxHorizontalSpeed: 2,
        startHorizontalSpeed: 2,
        airOverspeedDeceleration: 5,
        airAcceleration: 60,
        airDeceleration: 10,
      },
      maxSlope: 45,
      runAirSpeed: 1,
      stepUp: 0.4,
      stepDown: 0.6,
    },
    locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
  };
  const cache = createPhysicalCache();
  let observed: Record<string, boolean> = {};
  const solver = await preparePhysicalSolver(input, gangliaV1Defaults, {
    cache,
    generation: 'fixed-input',
    effort: 'walking',
    observe(_result, _optimizing, diagnostics) {
      observed = (diagnostics as { prepareReuse: Record<string, boolean> }).prepareReuse;
    },
  });
  try {
    for (const [i, x] of [9, 8, 9].entries()) {
      const result = await solver.solve({
        starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0.005, 1] }],
        goal: [x, 0.005, 1],
      });
      assert.equal(result.route.status, 'complete');
      if (result.route.status === 'complete')
        assert.deepEqual(result.route.points.at(-1), [x, 0.005, 1]);
      assert.equal(observed.ground, i > 0);
      assert.equal(observed.roundGround, i > 0);
    }
  } finally {
    await solver.close();
    cache.clear();
  }
});

test('raw and rounded constraints retain independent preparations across repeated queries', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  const builds: Record<string, number> = {};
  const build = (key: string) => {
    builds[key] = (builds[key] ?? 0) + 1;
    return key;
  };
  for (let round = 0; round < 3; round++) {
    for (const view of ['raw', 'rounded']) {
      const scope = { view };
      assert.equal((await cache.memo('ground', view, () => build(view))).reused, round > 0);
      for (const slot of ['devices', 'moving'] as const) {
        const key = `${view}/${slot}`;
        const result = await cache.memo(slot, key, () => build(key), scope);
        assert.equal(result.value, key);
        assert.equal(result.reused, round > 0);
      }
      assert.equal(
        (await cache.memo('execution', 'physical', () => build('execution'))).value,
        'execution',
      );
    }
  }
  assert.deepEqual(builds, {
    raw: 1,
    'raw/devices': 1,
    'raw/moving': 1,
    execution: 1,
    rounded: 1,
    'rounded/devices': 1,
    'rounded/moving': 1,
  });
  assert.equal(cache.stats().misses['ground:wall-view'], 1);
  assert.equal(cache.stats().resident.views, 2);
});

test('view and target capacities evict owned work without changing surviving proofs', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  const parentA = {},
    parentB = {};
  await cache.memo('ground', 'a', () => 'a');
  assert.equal(
    (await cache.memo('refinement', 'goal', () => 'base', { view: 'a', parent: parentA })).value,
    'base',
  );
  assert.equal(
    (await cache.memo('refinement', 'goal', () => 'moving', { view: 'a', parent: parentB })).value,
    'moving',
  );
  await cache.memo('ground', 'b', () => 'b');
  await cache.memo('refinement', 'goal', () => 'other-wall', { view: 'b', parent: parentA });
  assert.equal(
    (await cache.memo('refinement', 'goal', () => 'wrong', { view: 'a', parent: parentB })).value,
    'moving',
  );
  assert.equal(cache.stats().resident.refinement, 2);
  await cache.memo('ground', 'c', () => 'c');
  assert.equal((await cache.memo('ground', 'b', () => 'wrong')).value, 'b');
  assert.equal((await cache.memo('ground', 'a', () => 'rebuilt')).value, 'rebuilt');
  assert.equal(cache.stats().resident.views, 2);
  assert.ok(cache.stats().evictions['ground:capacity'] >= 1);
});

test('changed device facts invalidate their own dependent proofs but not another wall view', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  const parent = {};
  for (const view of ['a', 'b']) {
    await cache.memo('ground', view, () => view);
    await cache.memo('devices', 'state-0', () => 0, { view });
    await cache.memo('moving', 'state-0', () => 0, { view });
    await cache.memo('refinement', 'goal', () => 0, { view, parent });
  }
  await cache.memo('devices', 'state-1', () => 1, { view: 'a' });
  assert.equal((await cache.memo('moving', 'state-0', () => 1, { view: 'a' })).reused, false);
  assert.equal((await cache.memo('refinement', 'goal', () => 1, { view: 'a', parent })).value, 1);
  assert.equal((await cache.memo('refinement', 'goal', () => 2, { view: 'b', parent })).value, 0);
  assert.ok(cache.stats().evictions['moving:dependency'] >= 1);
});

test('generation changes invalidate model-bound work and discard late preparation stores', async () => {
  const cache = createPhysicalCache();
  cache.begin('old');
  let finish!: (value: string) => void;
  const late = cache.memo(
    'ground',
    'same-key',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  await cache.memo('execution', 'same-key', () => 'old-model');
  cache.begin('new');
  assert.equal((await cache.memo('ground', 'same-key', () => 'new-ground')).value, 'new-ground');
  finish('old-ground');
  assert.equal((await late).value, 'old-ground');
  assert.equal((await cache.memo('ground', 'same-key', () => 'wrong')).value, 'new-ground');
  assert.equal((await cache.memo('execution', 'same-key', () => 'new-model')).value, 'new-model');
  assert.ok(cache.stats().misses['ground:generation'] >= 1);
  cache.clear();
  assert.equal(cache.stats().resident.views, 0);
  assert.equal(cache.stats().resident.execution, 0);
});

test('explicit graph release preserves source authority and its single repair snapshot', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  await cache.memo('ground', 'raw', () => 'raw');
  await cache.memo('collision', 'collision', () => 'collision');
  await cache.memo('execution', 'execution', () => 'execution');
  await cache.memo('repair', 'repair', () => 'repaired-input');
  cache.release('ground');
  assert.equal(cache.stats().resident.views, 0);
  assert.equal((await cache.memo('collision', 'collision', () => 'wrong')).value, 'collision');
  assert.equal((await cache.memo('execution', 'execution', () => 'wrong')).value, 'execution');
  assert.equal((await cache.memo('repair', 'repair', () => 'wrong')).value, 'repaired-input');
  cache.begin('new-source');
  assert.equal((await cache.memo('repair', 'repair', () => 'new-input')).value, 'new-input');
});

test('large coarse, moving and target graphs share a budget before construction', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  const faces = Math.floor(cache.stats().capacity.plannerSurfaces * 0.6);
  await cache.memo('ground', 'raw', (reserve) => {
    reserve!(faces);
    return 'raw';
  });
  await cache.memo('ground', 'rounded', (reserve) => {
    reserve!(faces);
    assert.equal(cache.stats().resident.ground, 0);
    return 'rounded';
  });
  await cache.memo('devices', 'devices', () => 'devices', { view: 'rounded' });
  await cache.memo(
    'moving',
    'moving',
    (reserve) => {
      reserve!(faces);
      assert.equal(cache.stats().resident.ground, 0);
      return 'moving';
    },
    { view: 'rounded' },
  );
  const parent = {};
  await cache.memo(
    'refinement',
    'target',
    (reserve) => {
      reserve!(faces);
      assert.equal(cache.stats().resident.moving, 0);
      return 'target';
    },
    { view: 'rounded', parent },
  );
  assert.equal(cache.stats().resident.plannerSurfaces, faces);
  assert.equal(cache.stats().resident.refinement, 1);
  assert.equal(cache.stats().resident.devices, 1);
  assert.equal(
    (await cache.memo('refinement', 'target', () => 'wrong', { view: 'rounded', parent })).value,
    'target',
  );
  assert.equal(cache.stats().evictions['ground:surface-capacity'], 2);
  assert.equal(cache.stats().evictions['moving:surface-capacity'], 1);
});

test('an oversized graph remains usable without displacing the retained-memory bound', async () => {
  const cache = createPhysicalCache();
  cache.begin('snapshot');
  const faces = cache.stats().capacity.plannerSurfaces + 1;
  for (let round = 0; round < 2; round++) {
    const result = await cache.memo('ground', 'oversized', (reserve) => {
      reserve!(faces);
      return round;
    });
    assert.equal(result.value, round);
    assert.equal(result.reused, false);
    assert.equal(cache.stats().resident.plannerSurfaces, 0);
    assert.equal(cache.stats().resident.ground, 0);
  }
  await assert.rejects(
    cache.memo('moving', 'failed', (reserve) => {
      reserve!(faces);
      throw new Error('build failed');
    }),
    /build failed/,
  );
  await cache.memo('ground', 'small', (reserve) => {
    reserve!(10);
    return 'small';
  });
  assert.equal((await cache.memo('ground', 'small', () => 'wrong')).value, 'small');
  assert.equal(cache.stats().resident.plannerSurfaces, 10);
});
