import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { JumpModel } from '#@/src/movement.ts';
import { createBoundsIndex } from '#@/src/v1/geo/bounds.ts';
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
