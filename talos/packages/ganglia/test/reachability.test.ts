import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createBoundsIndex } from '#@/src/model/bounds.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { jumpDuration, jumpTravel } from '#@/src/v1/motion/jumps.ts';
import {
  type EnvelopeOptions,
  createJumpEnvelope,
  createJumpPredecessor,
} from '#@/src/v1/reach/reachability.ts';

const model: JumpModel = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 10,
  apexTime: 0.2,
  maxHorizontalSpeed: 3,
};
const options: Omit<EnvelopeOptions, 'reverse' | 'padding'> & {
  sourcePadding?: readonly number[] | undefined;
  targetPadding?: readonly number[] | undefined;
} = { model, maxDrop: 80, maxHorizontalDistance: 100, endpointTolerance: 0.25 };
const pointBox = (point: number[]) => ({ min: point, max: point });

test('directed envelopes retain terminal falls, launch impulses, boosts and boundary witnesses', () => {
  const forward = createJumpEnvelope([0, 0, 0], options);
  assert.equal(forward(pointBox([20, 0, 0])), false);
  assert.equal(forward(pointBox([20, -69, 0])), true);
  assert.equal(forward(pointBox([0, 3, 0])), false);
  assert.equal(
    createJumpEnvelope([20, -69, 0], { ...options, reverse: true })(pointBox([0, 0, 0])),
    true,
  );
  assert.equal(
    createJumpEnvelope([0, 0, 0], { ...options, reverse: true })(pointBox([0, -69, 0])),
    false,
  );
  assert.equal(
    createJumpEnvelope([0, 0, 0], {
      ...options,
      model: { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 1 },
    })(pointBox([10, 0, 0])),
    true,
  );
  assert.equal(
    createJumpEnvelope([0, 0, 0], { ...options, model: { ...model, maxHorizontalSpeed: 9.9 } })(
      pointBox([10, 0, 0]),
    ),
    true,
  );
  const padded = createJumpEnvelope([0, 0, 0], { ...options, padding: [0.5, 1, 0.5] });
  assert.equal(padded(pointBox([0, 3, 0])), true);
  assert.equal(forward({ min: [-100, -70, -100], max: [100, 10, 100] }), true);
});

test('radial envelope tests preserve rounded tangencies and exceptional magnitudes', () => {
  const envelope = createJumpEnvelope([0, 0, 0], {
    model: { ...model, maxHorizontalSpeed: 100 },
    maxDrop: 80,
    maxHorizontalDistance: 5,
  });
  // Adjacent decisions at the outward-rounded radius need the scaled hypot
  // result: independently rounded squared distances can cross that boundary.
  for (const [point, expected] of [
    [[3, 0, 4], true],
    [[3.00000000000034, 0, 4.000000000000453], true],
    [[3.000000000000342, 0, 4.000000000000456], false],
    [[5.000000000000568, 0, 0], true],
    [[5.000000000000569, 0, 0], false],
    [[1e-160, 0, 1e-160], true],
    [[Infinity, 0, 0], true],
    [[NaN, 0, 0], true],
  ] as const)
    assert.equal(envelope(pointBox([...point])), expected);

  const enormous = createJumpEnvelope([0, 0, 0], {
    model: { ...model, maxHorizontalSpeed: 1e155 },
    maxDrop: 80,
    maxHorizontalDistance: 1e155,
  });
  assert.equal(enormous(pointBox([5e154, 0, 5e154])), true);
  assert.equal(enormous(pointBox([1e155, 0, 1e155])), false);
});

test('forward and inverse node tests enclose all witnesses admitted by the existing optimistic prefilter', () => {
  for (const maxJumpHeight of [0, 2])
    for (const impulse of [false, true]) {
      const movement: JumpModel = {
        ...model,
        maxJumpHeight,
        ...(impulse
          ? {
              startHorizontalSpeed: 9,
              airOverspeedDeceleration: 5,
              expireAfter: 0.3,
              expiredHorizontalSpeed: 1,
            }
          : {}),
      };
      const settings: EnvelopeOptions = { ...options, model: movement };
      for (const base of [
        [0, 0, 0],
        [1e7, 1e7, -1e7],
      ]) {
        const forward = createJumpEnvelope(base, settings);
        for (const height of [-80.5, -69, -3, 0, 1, maxJumpHeight + 0.5]) {
          const duration = jumpDuration(base[1] + 0.25, base[1] + height - 0.25, {
            ...movement,
            mode: maxJumpHeight > 0 ? 'jump' : 'drop',
          });
          if (duration === null) continue;
          const reach = Math.min(
            options.maxHorizontalDistance,
            duration * movement.maxHorizontalSpeed,
          );
          for (const fraction of [0, 0.3, 1]) {
            const landing = [base[0] + reach * fraction, base[1] + height, base[2]];
            assert.equal(forward(pointBox(landing)), true);
            assert.equal(
              createJumpEnvelope(landing, { ...settings, reverse: true })(pointBox(base)),
              true,
            );
            const bounds = {
              min: [landing[0] - 2, landing[1] - 3, landing[2] - 4],
              max: [landing[0] + 2, landing[1] + 3, landing[2] + 4],
            };
            assert.equal(forward(bounds), true);
          }
          if (impulse) {
            const span = Math.min(options.maxHorizontalDistance, jumpTravel(9, duration, movement));
            assert.equal(forward(pointBox([base[0] + span, base[1] + height, base[2]])), true);
          }
        }
      }
    }
});

test('BVH node pruning retains eligible leaves for both range and ordered queries', () => {
  const anchor = [0, 0, 0];
  const entries = Array.from({ length: 257 }, (_, id) => ({
    id,
    min: [id * 0.5, id % 3 ? 0 : -30, 0],
    max: [id * 0.5 + 0.1, id % 3 ? 0.1 : -29.9, 0.1],
  }));
  const index = createBoundsIndex(entries),
    envelope = createJumpEnvelope(anchor, options);
  const bounds = { min: [-200, -100, -200], max: [200, 100, 200] };
  const expected = entries
    .filter(envelope)
    .map((entry) => entry.id)
    .sort((a, b) => a - b);
  assert.deepEqual(
    [...index(bounds, undefined, undefined, envelope)]
      .map((entry) => entry.id)
      .sort((a, b) => a - b),
    expected,
  );
  assert.deepEqual(
    [...index.nearest(bounds, anchor, envelope)].map((entry) => entry.id).sort((a, b) => a - b),
    expected,
  );
  let visited = 0;
  assert.deepEqual(
    [
      ...index.nearest(bounds, anchor, () => {
        visited++;
        return false;
      }),
    ],
    [],
  );
  assert.equal(visited, 1);
});

test('rounded shared flight tables enclose analytic limits and track model changes without changing existing envelopes', () => {
  const movement: JumpModel = { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 5 };
  const settings: EnvelopeOptions = { ...options, model: movement };
  const anchor = [0, 0, 0],
    forward = createJumpEnvelope(anchor, settings);
  for (let index = 0; index < 180; index++) {
    const drop = -model.maxJumpHeight + index * 0.13;
    const duration = jumpDuration(0.25, -drop - 0.25, { ...movement, mode: 'jump' });
    if (duration === null) continue;
    const span = Math.min(options.maxHorizontalDistance, jumpTravel(9, duration, movement));
    const landing = [span, -drop, 0];
    assert.equal(forward(pointBox(landing)), true);
    assert.equal(
      createJumpEnvelope(landing, { ...settings, reverse: true })(pointBox(anchor)),
      true,
    );
  }
  const near = pointBox([5, 0, 0]);
  assert.equal(forward(near), true);
  movement.maxHorizontalSpeed = 0.1;
  movement.startHorizontalSpeed = 0.1;
  assert.equal(createJumpEnvelope(anchor, settings)(near), false);
  assert.equal(forward(near), true);
});

test('region predecessors enclose padded boundary witnesses and reject remote or upward-impossible clusters', () => {
  const target = pointBox([10, 0, 0]);
  const predecessor = createJumpPredecessor(target, {
    ...options,
    sourcePadding: [3.15, 0.5, 3.15],
    targetPadding: [0.15, 0.5, 0.15],
  });
  const edge = pointBox([2, 0, 0]);
  assert.equal(createJumpPredecessor(target, options)(edge), false);
  assert.equal(predecessor(edge), true);
  assert.ok(predecessor.domain(edge));
  assert.equal(predecessor(pointBox([-100, 0, 0])), false);
  assert.equal(predecessor.domain(pointBox([-100, 0, 0])), null);
  assert.equal(createJumpPredecessor(pointBox([0, 10, 0]), options)(pointBox([0, 0, 0])), false);
  assert.equal(createJumpPredecessor(pointBox([20, -69, 0]), options)(pointBox([0, 0, 0])), true);
  // A region box may contain unrelated corners. It must retain any actual
  // feasible source/target pair instead of testing just its centre or corners.
  assert.equal(
    createJumpPredecessor({ min: [3, -70, -100], max: [100, 10, 100] }, options)(edge),
    true,
  );
});

test('predecessor height, time and launch-speed intervals contain analytically feasible control witnesses', () => {
  for (const height of [0, 2])
    for (const impulse of [false, true]) {
      const movement: JumpModel = {
        ...model,
        maxJumpHeight: height,
        ...(impulse ? { startHorizontalSpeed: 9, airOverspeedDeceleration: 5 } : {}),
      };
      const settings: Omit<EnvelopeOptions, 'reverse' | 'padding'> & {
        sourcePadding?: readonly number[] | undefined;
        targetPadding?: readonly number[] | undefined;
      } = { ...options, model: movement };
      for (const drop of [-height, 0, 1, 10, 69]) {
        const mode = height > 0 ? 'jump' : 'drop';
        const duration = jumpDuration(0.25, -drop - 0.25, { ...movement, mode });
        if (duration === null) continue;
        const initial = impulse ? 9 : model.maxHorizontalSpeed;
        const reach = impulse ? jumpTravel(initial, duration, movement) : initial * duration;
        for (const fraction of [0.25, 0.75, 1]) {
          const source = [0, 0, 0],
            target = [Math.min(options.maxHorizontalDistance, reach) * fraction, -drop, 0];
          const region = {
            min: target.map((value) => value - 0.1),
            max: target.map((value) => value + 0.1),
          };
          const predecessor = createJumpPredecessor(region, settings);
          const sourceRegion = { min: [-0.2, -0.2, -0.2], max: [0.2, 0.2, 0.2] };
          assert.equal(predecessor(sourceRegion), true);
          const domain = predecessor.domain(sourceRegion);
          assert.ok(domain);
          assert.ok(domain.sourceHeight[0] <= source[1] && domain.sourceHeight[1] >= source[1]);
          assert.ok(domain.targetHeight[0] <= target[1] && domain.targetHeight[1] >= target[1]);
          assert.ok(domain.flightTime[0] <= duration && domain.flightTime[1] >= duration);
          assert.ok(domain.initialSpeed[0] <= initial && domain.initialSpeed[1] >= initial);
          assert.ok(
            domain.horizontal.distance[0] <= target[0] &&
              domain.horizontal.distance[1] >= target[0],
          );
        }
      }
    }
  const domain = createJumpPredecessor(pointBox([10, 0, 0]), {
    ...options,
    endpointTolerance: 0,
    model: { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 1 },
  }).domain(pointBox([0, 0, 0]));
  assert.ok(domain);
  assert.ok(domain.initialSpeed[0] > model.maxHorizontalSpeed);
  assert.ok(domain.initialSpeed[1] <= 9);
});

test('optimized createJumpEnvelope matches original reference formula across random boxes, tangencies, huge coords, and non-finite bounds', () => {
  const referenceEnvelope = (anchor: readonly number[], envOpts: EnvelopeOptions) => {
    const {
      model: m,
      maxDrop,
      maxHorizontalDistance,
      endpointTolerance = 0,
      reverse = false,
      padding = [0, 0, 0],
    } = envOpts;
    const vertical = {
      ...m,
      mode: m.maxJumpHeight > 0 ? ('jump' as const) : ('drop' as const),
    };
    const initial = Math.max(m.maxHorizontalSpeed, m.startHorizontalSpeed ?? 0);
    const analyticReach = (drop: number) => {
      const duration = jumpDuration(0, -drop, vertical);
      if (duration === null) return 0;
      return Number.isFinite(m.airOverspeedDeceleration) && m.airOverspeedDeceleration! > 0
        ? jumpTravel(initial, duration, m)
        : initial * duration;
    };
    const heightResolution = 0.25;
    const minimumBin = Math.floor(-m.maxJumpHeight / heightResolution);
    const maximumBin = Math.ceil(
      (maxDrop + 4 * endpointTolerance + heightResolution) / heightResolution,
    );
    const count = maximumBin - minimumBin + 1;
    const table =
      Number.isSafeInteger(count) && count > 0 && count <= 4096
        ? Float64Array.from({ length: count }, (_, index) =>
            analyticReach((minimumBin + index) * heightResolution),
          )
        : null;
    const reachAt = (drop: number) => {
      const index = Math.ceil(drop / heightResolution) - minimumBin;
      return table && index >= 0 && index < table.length ? table[index] : analyticReach(drop);
    };
    const [x, y, z] = anchor;
    const [paddingX, paddingY, paddingZ] = padding;
    const rise = m.maxJumpHeight + 2 * endpointTolerance;
    const fall = maxDrop + 2 * endpointTolerance;
    const scale = Math.max(
      1,
      Math.abs(x),
      Math.abs(y),
      Math.abs(z),
      maxHorizontalDistance,
      rise,
      fall,
    );
    return (box: { min: readonly number[]; max: readonly number[] }) => {
      const minX = box.min[0] - paddingX,
        maxX = box.max[0] + paddingX;
      const minY = box.min[1] - paddingY,
        maxY = box.max[1] + paddingY;
      const minZ = box.min[2] - paddingZ,
        maxZ = box.max[2] + paddingZ;
      const epsilon =
        32 *
        Number.EPSILON *
        Math.max(
          scale,
          Math.abs(minX),
          Math.abs(maxX),
          Math.abs(minY),
          Math.abs(maxY),
          Math.abs(minZ),
          Math.abs(maxZ),
        );
      if (!Number.isFinite(epsilon)) return true;
      if (
        reverse
          ? maxY < y - rise - epsilon || minY > y + fall + epsilon
          : maxY < y - fall - epsilon || minY > y + rise + epsilon
      )
        return false;
      const dx = Math.max(minX - x, 0, x - maxX),
        dz = Math.max(minZ - z, 0, z - maxZ);
      const horizontal = maxHorizontalDistance + epsilon;
      if (dx > horizontal || dz > horizontal) return false;
      const source = reverse ? Math.min(maxY, y + fall) : y;
      const landing = reverse ? y : Math.max(minY, y - fall);
      const drop = source - landing + 2 * endpointTolerance + epsilon;
      const reach = Number.isFinite(drop) ? reachAt(drop) : Infinity;
      const radius = Number.isFinite(reach) ? Math.min(horizontal, reach + epsilon) : horizontal;
      if (dx > radius || dz > radius) return false;
      const squared = dx * dx + dz * dz;
      const radiusSquared = radius * radius;
      if (
        squared >= 2 ** -1022 &&
        radiusSquared >= 2 ** -1022 &&
        Number.isFinite(squared) &&
        Number.isFinite(radiusSquared) &&
        Math.abs(squared - radiusSquared) > 32 * Number.EPSILON * Math.max(squared, radiusSquared)
      )
        return squared < radiusSquared;
      return Math.hypot(dx, dz) <= radius;
    };
  };

  let seed = 0x517cc1b7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const configs: { anchor: number[]; env: EnvelopeOptions }[] = [
    { anchor: [0, 0, 0], env: { ...options, reverse: false } },
    { anchor: [0, 0, 0], env: { ...options, reverse: true, padding: [0.3, 0.5, 0.3] } },
    {
      anchor: [500, 12, -400],
      env: {
        model: { ...model, startHorizontalSpeed: 9, airOverspeedDeceleration: 2 },
        maxDrop: 25,
        maxHorizontalDistance: 100,
        endpointTolerance: 0.25,
        reverse: false,
      },
    },
    {
      anchor: [1e9, -1e9, 1e9],
      env: {
        model: { ...model, maxJumpHeight: 0 },
        maxDrop: 5000, // forces table === null analytic fallback
        maxHorizontalDistance: 150,
        endpointTolerance: 0.1,
        reverse: false,
      },
    },
    {
      anchor: [1e15, 1e15, -1e15],
      env: {
        model: {
          ...model,
          maxHorizontalSpeed: 0,
          startHorizontalSpeed: 5,
          airOverspeedDeceleration: 2,
        },
        maxDrop: 40,
        maxHorizontalDistance: 60,
        endpointTolerance: 0.2,
        reverse: true,
        padding: [0.4, 0.8, 0.4],
      },
    },
  ];

  for (const { anchor, env } of configs) {
    const actual = createJumpEnvelope(anchor, env);
    const expected = referenceEnvelope(anchor, env);
    const [ax, ay, az] = anchor;
    const boxes: { min: number[]; max: number[] }[] = [
      // Tangencies, boundary points, huge/subnormal/non-finite/inverted boxes
      pointBox([ax, ay, az]),
      pointBox([ax + env.maxHorizontalDistance, ay, az]),
      pointBox([ax, ay - env.maxDrop - 2 * (env.endpointTolerance ?? 0), az]),
      pointBox([ax, ay + env.model.maxJumpHeight + 2 * (env.endpointTolerance ?? 0), az]),
      pointBox([ax + 1e-160, ay, az + 1e-160]),
      { min: [ax + 20, ay - 5, az], max: [1e15, ay, az + 1] },
      { min: [-1e15, ay - 1, -1e15], max: [1e15, ay + 1, 1e15] },
      { min: [ax + 10, ay, az], max: [ax + 5, ay + 1, az + 1] }, // inverted X
      { min: [Infinity, ay, az], max: [Infinity, ay, az] },
      { min: [-Infinity, ay, az], max: [ax, ay, az] },
      { min: [NaN, ay, az], max: [ax + 1, ay + 1, az + 1] },
      { min: [ax, NaN, az], max: [ax + 1, ay + 1, az + 1] },
      { min: [ax, ay, az], max: [ax + 1, ay + 1, NaN] },
    ];
    // 800 random boxes per config (4,000 total) spanning inside, near boundary, and distant regions
    for (let i = 0; i < 800; i++) {
      const spanScale = i % 4 === 0 ? 150 : i % 4 === 1 ? 35 : i % 4 === 2 ? 12 : 1200;
      const cx = ax + (rand() * 2 - 1) * spanScale;
      const cy = ay + (rand() * 2 - 1) * 100;
      const cz = az + (rand() * 2 - 1) * spanScale;
      const hx = rand() * 8;
      const hy = rand() * 8;
      const hz = rand() * 8;
      boxes.push({
        min: [cx - hx, cy - hy, cz - hz],
        max: [cx + hx, cy + hy, cz + hz],
      });
    }
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      assert.equal(
        actual(box),
        expected(box),
        `mismatch at anchor=${JSON.stringify(anchor)} reverse=${Boolean(env.reverse)} box=${JSON.stringify(box)}`,
      );
    }
  }

  // Exact radial tangency parity around 5m and 1e155
  const radialEnv: EnvelopeOptions = {
    model: { ...model, maxHorizontalSpeed: 100 },
    maxDrop: 80,
    maxHorizontalDistance: 5,
  };
  const actualRadial = createJumpEnvelope([0, 0, 0], radialEnv);
  const expectedRadial = referenceEnvelope([0, 0, 0], radialEnv);
  for (const pt of [
    [3, 0, 4],
    [3.00000000000034, 0, 4.000000000000453],
    [3.000000000000342, 0, 4.000000000000456],
    [5.000000000000568, 0, 0],
    [5.000000000000569, 0, 0],
    [1e-160, 0, 1e-160],
  ]) {
    const b = pointBox(pt);
    assert.equal(actualRadial(b), expectedRadial(b));
  }
});
