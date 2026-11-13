import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundArrival } from '#@/src/route.ts';
import { findGoalHit } from '#@/src/v1/motion/goals.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { planAirborneGoal, findGoalFlights } from '#@/src/v1/route/airborne-goal.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';

const floor = (id: string, left: number, right: number): Surface => ({
  id,
  vertices: [
    [left, 0, -2],
    [right, 0, -2],
    [right, 0, 2],
    [left, 0, 2],
  ],
});
const scene: Surface[] = [floor('left', 0, 4), floor('right', 7, 11)];
const positions = scene
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
const options = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 6,
  runAirSpeed: 6,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 600,
  maxLinks: 32,
  interaction: { radius: 0.3, airborne: true },
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 6,
  },
};
const starts: GroundArrival[] = [
  { id: 'player', position: [2, 0, 0], state: 'available', cost: 0 },
];

test('collects a mid-flight target and ends at the first interaction', () => {
  const result = planJumpRoute(scene, world, starts, [5.5, 2, 0], options);
  assert.ok(result.route.status === 'complete');
  assert.ok(result.route.goalHit);
  assert.deepEqual(result.route.points.at(-1), result.route.goalHit.position);
  assert.ok(result.route.goalHit.position[1] > 1.7);
  const segment = result.route.segments[result.route.goalHit.segment];
  assert.ok(Math.abs(result.route.goalHit.time - segment.times.at(-1)!) < 1e-6);
  assert.equal(
    planJumpRoute(scene, world, starts, [5.5, 2, 0], {
      ...options,
      interaction: { radius: 0.3 },
    }).route.status,
    'unmapped',
  );
});

test('an airborne goal needs clearance through collection and can finish without landing support', () => {
  const blocked: JumpRouteOptions = {
    ...options,
    walls: [{ min: [4.5, -1, -3], max: [6.5, 10, 3], state: 'active' }],
  };
  assert.notEqual(
    planJumpRoute(scene, world, starts, [5.5, 2, 0], blocked).route.status,
    'complete',
  );
  const positions = scene[0].vertices;
  const isolated = createCollisionWorld({
    positions: positions.flat(),
    indices: [0, 2, 1, 0, 3, 2],
  });
  const after: JumpRouteOptions = {
    ...options,
    walls: [{ min: [6, -1, -3], max: [8, 10, 3], state: 'active' }],
  };
  const collected = planJumpRoute([scene[0]], isolated, starts, [5.5, 2, 0], after);
  assert.ok(collected.route.status === 'complete');
  assert.ok(collected.route.points.at(-1)![0] < 6 - options.profile.radius);
});

test('trajectory events honor vertical and facing constraints between samples', () => {
  const points: Vec3[] = [
    [-2, 0, 0],
    [2, 0, 0],
  ];
  const entry = findGoalHit(points, [0, 0, 0], { radius: 0.2 });
  assert.ok(entry);
  assert.ok(Math.abs(entry.position[0] + 0.2) < 1e-9);
  assert.ok(
    findGoalHit(
      [
        [-2, 0, 0],
        [2, 0, 0],
      ],
      [1, 0, 0],
      { radius: 0.2, facing: [1, 0, 0], halfAngle: 45 },
    ),
  );
  assert.equal(findGoalHit(points, [0, 1, 0], { radius: 2, maxVertical: 0.5 }), null);
  assert.equal(
    findGoalHit(
      [
        [-2, 0, 0],
        [-1, 0, 0],
      ],
      [0, 0, 0],
      { radius: 3, facing: [1, 0, 0], halfAngle: 45 },
    ),
    null,
  );
});

test('a descending pickup stops in the interaction volume above the floor', () => {
  const raised: Surface = {
    id: 'raised',
    vertices: [
      [0, 10, -2],
      [4, 10, -2],
      [4, 10, 2],
      [0, 10, 2],
    ],
  };
  const lower: Surface = floor('lower', 5, 16);
  const surfaces: Surface[] = [raised, lower];
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
  const result = planJumpRoute(
    surfaces,
    world,
    [{ ...starts[0], position: [2, 10, 0] }],
    [7, 6, 0],
    {
      ...options,
      maxDrop: 20,
      interaction: { radius: 0.25, airborne: true },
    },
  );
  assert.ok(result.route.status === 'complete');
  assert.ok(result.route.goalHit);
  assert.ok(
    Math.hypot(...result.route.points.at(-1)!.map((value, axis) => value - [7, 6, 0][axis])) <=
      0.25 + 1e-7,
  );
});

test('reports sphere entry when a sampled segment ends inside the trigger', () => {
  const hit = findGoalHit(
    [
      [-2, 0.5, 0],
      [-0.5, 0.5, 0],
    ],
    [0, 0, 0],
    { radius: 1 },
  );
  assert.ok(hit);
  assert.ok(Math.abs(Math.hypot(...hit.position) - 1) < 1e-9);
  assert.ok(Math.abs(hit.position[0] + Math.sqrt(0.75)) < 1e-9);
});

test('bounds later airborne approaches by the incumbent less the fixed terminal flight', () => {
  const arrivals: GroundArrival[] = [{ ...starts[0], cost: 7 }],
    goal: Vec3 = [5.5, 2, 0];
  const candidates = findGoalFlights(scene, world, arrivals, goal, options).candidates;
  const distance = (point: Vec3) =>
    Math.hypot(...point.map((value, axis) => value - arrivals[0].position[axis]));
  candidates.sort(
    (a, b) =>
      distance(a.start.position) - distance(b.start.position) ||
      a.arc.times.at(-1)! - b.arc.times.at(-1)!,
  );
  const firstPosition = candidates[0].start.position;
  const secondIndex = candidates.findIndex((candidate) =>
    candidate.start.position.some((value, axis) => value !== firstPosition[axis]),
  );
  assert.ok(secondIndex > 0);
  const calls: { position: Vec3; maxCost: number }[] = [];
  const prefixCost = arrivals[0].cost + 100;
  const result = planAirborneGoal(scene, world, arrivals, goal, options, (position, maxCost) => {
    calls.push({ position, maxCost });
    return {
      connections: [],
      route: {
        status: 'complete',
        start: 'player',
        arrivalCost: arrivals[0].cost,
        cost: prefixCost,
        length: distance(position),
        points: [arrivals[0].position, position],
        segments: [{ mode: 'rope', points: [arrivals[0].position, position], times: [0, 100] }],
      },
    };
  });
  assert.ok(result.route.status === 'complete');
  assert.equal(calls[0].maxCost, Infinity);
  assert.deepEqual(calls[1].position, candidates[secondIndex].start.position);
  const earliestFlight = Math.min(
    ...candidates.slice(0, secondIndex).map((candidate) => candidate.arc.times.at(-1)!)!,
  );
  assert.ok(
    Math.abs(
      calls[1].maxCost - (prefixCost + earliestFlight - candidates[secondIndex].arc.times.at(-1)!),
    ) < 1e-12,
  );
  const retimed = retimeGroundRoute(result.route, {
    speed: 6,
    sprintSpeed: 7,
    sprintAcceleration: 10,
  });
  assert.ok(retimed.status === 'complete');
  assert.deepEqual(
    retimed.segments.filter((segment) => segment.mode !== 'walk').map((segment) => segment.times),
    result.route.segments
      .filter((segment) => segment.mode !== 'walk')
      .map((segment) => segment.times),
  );
  assert.equal(retimed.goalHit!.time, result.route.goalHit!.time);
});
