import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { type JumpOptions, jumpConnection, runOffConnection } from '#@/src/v1/motion/jumps.ts';
import { createMotionBounds } from '#@/src/v1/reach/motion-bounds.ts';

const point = (position: Vec3) => ({ min: position, max: position });
const model: JumpModel = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 20,
  apexTime: 0.2,
  maxHorizontalSpeed: 6.5,
};
const profile = { radius: 0.3, height: 1.7 };

test('full-jump bounds include ascent and apex and stay below accepted transfer times', () => {
  const bounds = createMotionBounds(model);
  assert.ok(bounds.jump(point([0, 0, 0]), point([1, 0, 0])) > 1.4);
  for (const overspeed of [false, true]) {
    const selected: JumpModel = overspeed
      ? { ...model, startHorizontalSpeed: 10, airOverspeedDeceleration: 5 }
      : model;
    const bound = createMotionBounds(selected);
    for (const height of [-10, -2, 0, 1, 2])
      for (const span of [0.5, 3, 7, 12]) {
        const from: Vec3 = [0, 4, 0],
          to: Vec3 = [span, 4 + height, 0];
        const controls: Partial<JumpOptions>[] = [
          {},
          { horizontalSplit: 0.5, airAcceleration: 40, airDeceleration: 20 },
          { horizontalWaypoint: [span / 2, 1], airAcceleration: 40, airDeceleration: 20 },
        ];
        for (const control of controls) {
          const arc = jumpConnection(from, to, {
            ...selected,
            ...control,
            profile,
            mode: 'jump',
            walls: [],
            sweep: () => null,
          });
          if (arc) assert.ok(bound.jump(point(from), point(to)) <= arc.times.at(-1)!);
        }
      }
  }
  assert.equal(bounds.jump(point([0, 0, 0]), point([1, 3, 0])), Infinity);
});

test('foot boxes and endpoint tolerance retain ascending and terminal-speed fall transfers', () => {
  const bounds = createMotionBounds(model, { endpointTolerance: 0.3 });
  for (const drop of [-2, 0, 50, 100]) {
    const from: Vec3 = [1000, 10.2, -2000],
      to: Vec3 = [1002, 10.2 - drop, -2000];
    const arc = jumpConnection(from, to, {
      ...model,
      profile,
      mode: 'jump',
      walls: [],
      sweep: () => null,
    });
    assert.ok(arc);
    const source = { min: [999, 9.9, -2001], max: [1001, 10, -1999] };
    const landing = { min: [1001, 10 - drop, -2001], max: [1003, 10.1 - drop, -1999] };
    assert.ok(bounds.jump(source, landing) <= arc.times.at(-1)!);
  }
});

test('unknown run-off launch height retains an uphill supported approach', () => {
  const ramp = [
    [0, 0, -3],
    [4, 2, -3],
    [4, 2, 3],
    [0, 0, 3],
  ];
  const floor = [
    [5, 1, -3],
    [10, 1, -3],
    [10, 1, 3],
    [5, 1, 3],
  ];
  const positions = [
    ramp[0],
    ramp[2],
    ramp[1],
    ramp[0],
    ramp[3],
    ramp[2],
    floor[0],
    floor[2],
    floor[1],
    floor[0],
    floor[3],
    floor[2],
  ].flat();
  const world = createCollisionWorld({
    positions,
    indices: Array.from({ length: positions.length / 3 }, (_, i) => i),
  });
  const support = world.groundAt([1, 0.5, 0], {
    maxUp: 1,
    maxDown: 1,
    maxSlope: 46,
    radius: profile.radius,
  });
  assert.ok(support);
  const from: Vec3 = [...support.position],
    to: Vec3 = [6, 1.005, 0];
  from[1] += 0.005;
  const arc = runOffConnection(from, to, {
    ...model,
    profile,
    world,
    maxSlope: 46,
    walls: [],
    sweep: world.sweepCapsule,
  });
  assert.ok(arc);
  assert.ok(to[1] > from[1]);
  assert.ok(Math.max(...arc.points.map((p) => p[1])) > to[1]);
  assert.ok(createMotionBounds(model).runOff(point(from), point(to)) <= arc.times.at(-1)!);
});

test('known run-off bounds use the verified launch and supported distance', () => {
  const bounds = createMotionBounds(model);
  const from = point([0, 0, 0]),
    to = point([6, 1, 0]);
  const prefix: { launch: Vec3; distance: number } | undefined = { launch: [4, 2, 0], distance: 5 };
  const result = bounds.runOff(from, to, prefix);
  assert.ok(result > 5 / model.maxHorizontalSpeed);
  assert.ok(result <= 5 / model.maxHorizontalSpeed + Math.sqrt(2 / model.fallingGravity));
  assert.equal(bounds.runOff(from, point([6, 3, 0]), prefix), Infinity);
});
