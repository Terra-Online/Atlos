import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { GroundArrival } from '#@/src/route.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { EvaluateCandidate } from '#@/src/v1/route/candidate.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { executeRoute, type ExecutionFailure } from '#@/src/v1/solver/physical/execution.ts';

const floor = (id: string, left: number, right: number): Surface => ({
  id,
  vertices: [
    [left, 0, -2],
    [right, 0, -2],
    [right, 0, 2],
    [left, 0, 2],
  ],
});
const geometry = (surfaces: Surface[]) => ({
  positions: surfaces
    .flatMap(({ vertices }) => [
      vertices[0],
      vertices[2],
      vertices[1],
      vertices[0],
      vertices[3],
      vertices[2],
    ])
    .flat(),
  indices: Array.from({ length: surfaces.length * 6 }, (_, i) => i),
});
const model = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 20,
  apexTime: 0.2,
  maxHorizontalSpeed: 6,
  startHorizontalSpeed: 6,
  airOverspeedDeceleration: 5,
  airAcceleration: 60,
  airDeceleration: 10,
};
const options: JumpRouteOptions = {
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
  maxShortcutCandidates: 0,
  maxLinks: 32,
  model,
  locomotion: { speed: 6, sprintSpeed: 6, sprintAcceleration: 20 },
};
const arrival = (id: string, position: Vec3, cost = 0): GroundArrival => ({
  id,
  position,
  cost,
  state: 'available',
});
function execution(surfaces: Surface[], physical: Surface[]) {
  const input: PhysicalInput = {
    ground: { surfaces, options },
    collision: geometry(physical),
    movement: { model, maxSlope: 46, runAirSpeed: 6, stepUp: 0.4, stepDown: 0.6 },
    locomotion: options.locomotion!,
  };
  const snapshot = createPhysicalWorld(input, 'complete');
  const rejections: ExecutionFailure[] = [];
  const evaluateCandidate: EvaluateCandidate = (route, query) => {
    let rejection: ExecutionFailure | undefined;
    const executed = executeRoute(route, query, snapshot, (failure) => {
      rejection = failure;
      rejections.push(failure);
    });
    return { route: executed, rejection };
  };
  return { evaluateCandidate, rejections, snapshot };
}

test('a physically rejected cheap initial route cannot suppress a valid later arrival', () => {
  const surfaces = [floor('nav', 0, 12)],
    physical = [floor('real', 6, 12)];
  const starts = [arrival('unsupported', [2, 0, 0]), arrival('supported', [8, 0, 0], 5)];
  const goal: Vec3 = [10, 0, 0];
  const planner = createGroundPlanner(surfaces, options);
  const raw = planner.plan(starts, goal);
  assert.equal(raw.status, 'complete');
  assert.ok(raw.status === 'complete' && raw.start === 'unsupported');
  const evaluator = execution(surfaces, physical);
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(physical)), starts, goal, {
    ...options,
    groundPlanner: planner,
    evaluateCandidate: evaluator.evaluateCandidate,
    maxCandidates: 16,
  });
  assert.ok(evaluator.rejections.some(({ reason }) => reason === 'walk-unproved'));
  assert.ok(result.route.status === 'complete');
  assert.equal(result.route.start, 'supported');
  assert.equal(result.diagnostics.baselineCost, null);
  const verified = createPhysicalVerifier(() => [evaluator.snapshot])(
    { starts, goal },
    result.route,
  );
  assert.equal(verified.valid, true, JSON.stringify(verified));
});

test('rejected navigation walking leaves the airborne fallback and local prefixes eligible', () => {
  const surfaces = [floor('nav', 0, 11)],
    physical = [floor('left', 0, 4), floor('right', 7, 11)];
  const starts = [arrival('player', [2, 0, 0])],
    goal: Vec3 = [5.5, 0.8, 0];
  const interaction = { radius: 0.9, airborne: true };
  const planner = createGroundPlanner(surfaces, options);
  assert.equal(planner.plan(starts, goal, { interaction }).status, 'complete');
  const evaluator = execution(surfaces, physical);
  const result = planJumpRoute(surfaces, createCollisionWorld(geometry(physical)), starts, goal, {
    ...options,
    interaction,
    groundPlanner: planner,
    evaluateCandidate: evaluator.evaluateCandidate,
  });
  assert.ok(evaluator.rejections.some(({ reason }) => reason === 'walk-unproved'));
  assert.ok(result.diagnostics.airborne?.approaches);
  assert.ok(result.route.status === 'complete', JSON.stringify(result.diagnostics));
  assert.ok(result.route.goalHit);
  assert.ok(result.route.segments.some(({ mode }) => mode === 'jump' || mode === 'drop'));
  assert.deepEqual(result.route.points.at(-1), result.route.goalHit.position);
  assert.equal(
    evaluator.evaluateCandidate(result.route, { starts, goal, interaction }).route.status,
    'complete',
  );
  const verified = createPhysicalVerifier(() => [evaluator.snapshot])(
    { starts, goal, interaction },
    result.route,
  );
  assert.equal(verified.valid, true, JSON.stringify(verified));
});
