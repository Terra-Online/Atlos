import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { SpeedBoost } from '#@/src/movement.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute } from '#@/src/v1/route/jump-planner.ts';
import { expectStatus } from '#@/test/assertions.ts';

const floor = (id: string, left: number, right: number): Surface => ({
  id,
  vertices: [
    [left, 0, -2],
    [right, 0, -2],
    [right, 0, 2],
    [left, 0, 2],
  ],
});
const surfaces: Surface[] = [floor('left', 0, 4), floor('right', 10, 14)];
const positions = surfaces
  .flatMap((s) => [
    s.vertices[0],
    s.vertices[2],
    s.vertices[1],
    s.vertices[0],
    s.vertices[3],
    s.vertices[2],
  ])
  .flat();
const world = createCollisionWorld({
  positions,
  indices: Array.from({ length: positions.length / 3 }, (_, i) => i),
});
const boost: SpeedBoost = {
  id: 'vortex',
  position: [2, 0, 0],
  interaction: { radius: 0.2 },
  duration: 3,
  multiplier: 2.2,
};
const options = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 3,
  runAirSpeed: 3,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 600,
  maxLinks: 32,
  interaction: { radius: 0.5, airborne: true },
  locomotion: { speed: 3, sprintSpeed: 3, sprintAcceleration: 20 },
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 3,
  },
};
const starts: GroundArrival[] = [
  { id: 'player', position: [1, 0, 0], state: 'available', cost: 0 },
];
const goal: Vec3 = [9, 1.8, 0];

test('picks up a speed boost before a previously unreachable airborne target and ends at collection', () => {
  assert.notEqual(planJumpRoute(surfaces, world, starts, goal, options).route.status, 'complete');
  const result = planJumpRoute(surfaces, world, starts, goal, { ...options, boosts: [boost] });
  assert.ok(result.route.status === 'complete');
  assert.ok(result.route.goalHit);
  assert.ok(
    Math.hypot(
      ...result.route.points
        .at(-1)!
        .map(
          (value, axis) => value - expectStatus(result.route, 'complete').goalHit!.position[axis],
        ),
    ) < 1e-8,
  );
  assert.equal(result.route.boosts![0].id, 'vortex');
  assert.ok(Math.abs(result.route.boosts![0].position[0] - 1.8) < 1e-6);
  assert.ok(result.route.boosts![0].elapsed <= boost.duration);
  assert.ok(result.route.segments.some((segment) => !segment.boost));
  const edge = result.connections.find((connection) => connection.requiredBoost);
  assert.ok(edge);
  const planner = createGroundPlanner(surfaces, options);
  assert.notEqual(planner.plan(starts, [12, 0, 0], { connections: [edge] }).status, 'complete');
});

test('expired and inaccessible speed boosts cannot establish reachability', () => {
  assert.notEqual(
    planJumpRoute(surfaces, world, starts, goal, {
      ...options,
      boosts: [{ ...boost, duration: 1 }],
    }).route.status,
    'complete',
  );
  assert.notEqual(
    planJumpRoute(surfaces, world, starts, goal, {
      ...options,
      boosts: [{ ...boost, position: [12, 0, 0] }],
    }).route.status,
    'complete',
  );
});

test('boosted ground retiming carries stamina across the pickup', () => {
  const route: Route = {
    status: 'complete',
    start: 'player',
    arrivalCost: 0,
    cost: 4,
    length: 4,
    points: [
      [0, 0, 0],
      [2, 0, 0],
      [4, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [0, 0, 0],
          [2, 0, 0],
        ],
        times: [0, 2],
      },
      {
        mode: 'walk',
        points: [
          [2, 0, 0],
          [4, 0, 0],
        ],
        times: [0, 2],
        boost,
      },
    ],
  };
  const timed = retimeGroundRoute(route, {
    speed: 1,
    sprintSpeed: 2,
    sprintAcceleration: 20,
    stamina: {
      capacity: 1,
      initial: 1,
      activationCost: 1,
      sprintDrain: 0,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  });
  assert.ok(timed.status === 'complete');
  assert.equal(timed.locomotion!.final, 0);
  assert.ok(timed.cost < 2);
});

test('a final jump can outlast the boost with a revalidated ordinary-speed continuation', () => {
  const model = { ...options.model, startHorizontalSpeed: 4, airOverspeedDeceleration: 2 };
  const result = planJumpRoute(surfaces, world, starts, goal, {
    ...options,
    model,
    boosts: [{ ...boost, duration: 1 }],
  });
  assert.ok(result.route.status === 'complete');
  assert.ok(result.route.goalHit);
  const flight = result.route.segments.at(-1);
  assert.ok(flight!.boostExpiry! > 0 && flight!.boostExpiry! < flight!.times.at(-1)!);
  assert.ok(
    Math.hypot(
      ...result.route.points
        .at(-1)!
        .map(
          (value, axis) => value - expectStatus(result.route, 'complete').goalHit!.position[axis],
        ),
    ) < 1e-8,
  );
  assert.equal(result.route.boosts![0].elapsed, 1);
});
