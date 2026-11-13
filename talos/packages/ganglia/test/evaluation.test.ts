import assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRoute, verifyRoute } from '#@/src/evaluation/route.ts';
import { createLocomotionRules } from '#@/src/model/index.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

const route = (): Extract<Route, { status: 'complete' }> => ({
  status: 'complete',
  start: 'start',
  arrivalCost: 2,
  cost: 4,
  length: 10,
  points: [
    [0, 0, 0],
    [10, 0, 0],
  ],
  segments: [
    {
      mode: 'walk',
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      times: [0, 2],
    },
  ],
});
const query: RouteQuery = {
  starts: [{ id: 'start', position: [0, 0, 0], cost: 2, state: 'available' }],
  goal: [10, 0, 0],
};
test('evaluation recomputes time and length and rejects a cheaper declared objective', () => {
  assert.equal(evaluateRoute(route()).costSeconds, 4);
  const dishonest = { ...route(), cost: 0.1 };
  const result = evaluateRoute(dishonest);
  assert.equal(result.valid, false);
  assert.equal(result.costSeconds, null);
  assert.match(result.issues.join(), /Declared cost/);
});
test('query verification rejects disconnected paths, locked arrivals and missed goals', () => {
  assert.equal(verifyRoute(query, route(), { maxVertical: 0.5 }).valid, true);
  const broken = route();
  broken.segments[0].points[0] = [1, 0, 0];
  assert.equal(evaluateRoute(broken).valid, false);
  assert.equal(
    verifyRoute({ ...query, starts: [{ ...query.starts[0], state: 'locked' }] }, route(), {
      maxVertical: 0.5,
    }).valid,
    false,
  );
  assert.equal(
    verifyRoute({ ...query, goal: [20, 0, 0] }, route(), { maxVertical: 0.5 }).valid,
    false,
  );
});
test('waypoints are checked on spans and must occur in query order', () => {
  assert.equal(
    verifyRoute(
      {
        ...query,
        waypoints: [
          [3, 0, 0],
          [8, 0, 0],
        ],
      },
      route(),
      { maxVertical: 0.5 },
    ).valid,
    true,
  );
  assert.equal(
    verifyRoute(
      {
        ...query,
        waypoints: [
          [8, 0, 0],
          [3, 0, 0],
        ],
      },
      route(),
      { maxVertical: 0.5 },
    ).valid,
    false,
  );
});
test('interaction verification applies the shared vertical and facing rules', () => {
  const interaction = {
    radius: 2,
    maxVertical: 0.1,
    facing: [1, 0, 0] as [number, number, number],
    halfAngle: Math.PI / 4,
  };
  assert.equal(
    verifyRoute({ ...query, goal: [11, 0, 0], interaction }, route(), { maxVertical: 0.5 }).valid,
    false,
  );
  assert.equal(
    verifyRoute({ ...query, goal: [9, 0, 0], interaction }, route(), { maxVertical: 0.5 }).valid,
    true,
  );
});
test('shared locomotion executes chosen controls and carries stamina across blocks', () => {
  const rules = createLocomotionRules({
    speed: 5,
    sprintSpeed: 8,
    sprintAcceleration: 10,
    stamina: {
      capacity: 10,
      initial: 10,
      activationCost: 4,
      sprintDrain: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  });
  const block = route().segments;
  const run = rules.advance(block, rules.initial(), { allowSprint: false, allowDash: false })!;
  const sprint = rules.advance(block, rules.initial(), { allowSprint: true, allowDash: false })!;
  assert.equal(run.state.energy, 10);
  assert.ok(sprint.state.energy < 6);
  assert.ok(sprint.duration < run.duration);
  const continuation = rules.advance(block, sprint.state, { allowSprint: true, allowDash: false })!;
  assert.ok(continuation.state.energy < sprint.state.energy);
  assert.ok(continuation.state.energy > sprint.state.energy - 4);
});

test('ordered waypoints on a vertical rope span use its vertical interval', () => {
  const candidate: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'start',
    arrivalCost: 0,
    cost: 1,
    length: 10,
    points: [
      [0, 0, 0],
      [0, 10, 0],
    ],
    segments: [
      {
        mode: 'rope',
        points: [
          [0, 0, 0],
          [0, 10, 0],
        ],
        times: [0, 1],
      },
    ],
  };
  const request: RouteQuery = {
    starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
    goal: [0, 10, 0],
    waypoints: [
      [0, 5, 0],
      [0, 10, 0],
    ],
  };
  assert.equal(verifyRoute(request, candidate, { maxVertical: 0.5 }).valid, true);
  assert.equal(
    verifyRoute(
      {
        ...request,
        waypoints: [
          [0, 10, 0],
          [0, 9.2, 0],
        ],
      },
      candidate,
      { maxVertical: 0.5 },
    ).valid,
    true,
  );
  assert.equal(
    verifyRoute(
      {
        ...request,
        waypoints: [
          [0, 8, 0],
          [0, 2, 0],
        ],
      },
      candidate,
      { maxVertical: 0.5 },
    ).valid,
    false,
  );
});

test('a zero-length route can satisfy a waypoint at its available start', () => {
  const candidate: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'start',
    arrivalCost: 2,
    cost: 2,
    length: 0,
    points: [[0, 0, 0]],
    segments: [],
  };
  assert.equal(
    verifyRoute({ ...query, goal: [0, 0, 0], waypoints: [[0, 0, 0]] }, candidate, {
      maxVertical: 0.5,
    }).valid,
    true,
  );
});
