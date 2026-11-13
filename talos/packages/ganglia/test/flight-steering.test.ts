import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { mayReachGoal } from '#@/src/v1/motion/flight-steering.ts';
import {
  type MotionControl,
  jumpConnection,
  jumpDuration,
  jumpVerticalRange,
} from '#@/src/v1/motion/jumps.ts';

const model: JumpModel = {
  gravity: 10,
  fallingGravity: 12,
  maxJumpHeight: 2,
  maxFallingSpeed: 5,
  apexTime: 0.2,
  maxHorizontalSpeed: 10,
};
const control: MotionControl = { mode: 'jump' };
const arcFor = (start: Vec3, end: Vec3) =>
  jumpConnection(start, end, {
    ...model,
    ...control,
    profile: { radius: 0.3, height: 1.7 },
    walls: [],
    sweep: () => null,
  });

test('inverse goal intervals reject a horizontal or time-dependent height miss', () => {
  const start: Vec3 = [0, 0, 0],
    end: Vec3 = [8, 0, 0];
  assert.equal(mayReachGoal(start, end, [4, 2, 3], 0.2, model, control), false);
  assert.equal(mayReachGoal(start, end, [0.1, 2, 0], 0.01, model, control), false);
  assert.equal(mayReachGoal(start, end, [4, 2, 0], 0.2, model, control), true);
  assert.equal(mayReachGoal(start, end, [0.1, 2, 0], 2, model, control), true);
});

test('shared vertical ranges cover ascent, apex hold and terminal-speed descent', () => {
  const ascent = Math.sqrt((2 * model.maxJumpHeight) / model.gravity);
  const duration = jumpDuration(0, -20, { ...model, ...control })!;
  assert.deepEqual(jumpVerticalRange(0, -20, { ...model, ...control }, ascent, ascent + 0.1), {
    min: 2,
    max: 2,
  });
  const last = jumpVerticalRange(0, -20, { ...model, ...control }, duration - 0.1, duration);
  assert.ok(last);
  assert.ok(Math.abs(last.min + 20) < 1e-12);
  assert.ok(Math.abs(last.max + 19.5) < 1e-12);
});

test('sampled chord hits survive curvature inflation, terminal falls and large coordinates', () => {
  for (const base of [
    [0, 0, 0],
    [1e7, 1e7, -1e7],
  ] satisfies Vec3[])
    for (const height of [0, 1.5, -20]) {
      const end: Vec3 = [base[0] + 6, base[1] + height, base[2]],
        arc = arcFor(base, end);
      assert.ok(arc);
      for (const index of [1, Math.floor(arc.points.length / 2), arc.points.length - 1]) {
        const goal: Vec3 = arc.points[index].map(
          (value, axis) => (value + arc.points[index - 1][axis]) / 2,
        ) as Vec3;
        assert.ok(findGoalHit(arc.points, goal, { radius: 1e-6 }));
        assert.equal(mayReachGoal(base, end, goal, 1e-6, model, control), true);
      }
    }
  const vertical = arcFor([0, 0, 0], [0, 0, 0]);
  assert.ok(vertical);
  assert.equal(mayReachGoal([0, 0, 0], [0, 0, 0], [0, 2, 0], 0, model, control), true);
});

test('supported drops and non-constant horizontal controls retain the full solver', () => {
  const start: Vec3 = [0, 0, 0],
    end: Vec3 = [8, 0, 0],
    goal: Vec3 = [100, 100, 100];
  for (const variant of [
    { mode: 'drop' },
    { ...control, horizontalSplit: 0.5 },
    { ...control, horizontalWaypoint: [2, 1] },
    { ...control, expireAfter: 0.1 },
  ] satisfies MotionControl[]) {
    assert.equal(mayReachGoal(start, end, goal, 0.1, model, variant), true);
  }
  assert.equal(mayReachGoal(start, end, goal, 0.1, { ...model, expireAfter: 0.1 }, control), true);
  assert.equal(
    mayReachGoal(
      start,
      [80, 0, 0],
      goal,
      0.1,
      { ...model, startHorizontalSpeed: 100, airOverspeedDeceleration: 5 },
      control,
    ),
    true,
  );
});
