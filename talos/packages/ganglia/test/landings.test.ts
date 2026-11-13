import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { jumpConnection } from '#@/src/v1/motion/jumps.ts';
import { landingCandidates, createLandingGoalCache } from '#@/src/v1/motion/landings.ts';

test('finds feasible landing interiors when nearest, goal and centre witnesses fail', () => {
  const surface: Surface = {
    id: 'landing',
    vertices: [
      [5, 0, 0],
      [12, 0, -4],
      [12, 0, 4],
    ],
  };
  const triangles = [
    [
      [-2, 4, -2],
      [0.5, 4, 2],
      [0.5, 4, -2],
    ],
    [
      [-2, 4, -2],
      [-2, 4, 2],
      [0.5, 4, 2],
    ],
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
  ];
  const world = createCollisionWorld({
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  });
  const model: JumpModel = {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.1,
    maxHorizontalSpeed: 4,
  };
  const profile = { radius: 0.25, height: 1.7 },
    start: Vec3 = [0, 4.005, 0];
  const walls: Wall[] = [{ min: [4.5, -0.1, -0.6], max: [5.5, 2, 0.6], state: 'unknown' }];
  const candidates = [...landingCandidates(surface, start, [12, 0, 0], model, profile.radius)];
  const arcs = candidates.map(({ position }) =>
    jumpConnection(start, [position[0], position[1] + 0.005, position[2]], {
      ...model,
      mode: 'jump',
      profile,
      walls,
      sweep: world.sweepCapsule,
    }),
  );
  for (const point of [
    [5, 0, 0],
    [12, 0, 0],
    [29 / 3, 0, 0],
  ] satisfies Vec3[])
    assert.equal(
      jumpConnection(start, point, {
        ...model,
        mode: 'jump',
        profile,
        walls,
        sweep: world.sweepCapsule,
      }),
      null,
    );
  assert.ok(arcs.some((arc) => arc !== null));
});

test('landing queries isolate returned witnesses and do not retain a changed goal', () => {
  const surface: Surface = {
    id: 'floor',
    vertices: [
      [-2, 0, -2],
      [2, 0, -2],
      [2, 0, 2],
      [-2, 0, 2],
    ],
  };
  const goal: Vec3 = [4, 0, 1],
    cache = createLandingGoalCache(goal);
  const model = {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 3,
  };
  for (const [start, target] of [
    [
      [-4, 0, 0],
      [4, 0, 1],
    ],
    [
      [0, 3, -4],
      [0, 1, 3],
    ],
    [
      [-4, 0, 0],
      [4, 0, 1],
    ],
  ] satisfies [Vec3, Vec3][]) {
    goal.splice(0, 3, ...target);
    const expected = [...landingCandidates(surface, start, goal, model, 0.3)];
    const actual = [...landingCandidates(surface, start, goal, model, 0.3, cache)];
    assert.deepEqual(actual, expected);
    for (const witness of actual) witness.position.fill(100);
    assert.deepEqual([...landingCandidates(surface, start, goal, model, 0.3, cache)], expected);
  }
});
