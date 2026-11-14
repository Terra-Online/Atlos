import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classify,
  expectation,
  resourcePath,
  scenarioInput,
  exercised,
  readMechanismSuite,
  type MechanismCase,
} from '#@/bench/mechanism-suite.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { readWorkload } from '#@/bench/workload.ts';
import type { Evaluation } from '#@/src/evaluation/route.ts';
import type { RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput, FollowingSupport } from '#@/src/solver/physical.ts';

const item = (): MechanismCase => ({
  id: 'test',
  scene: 'map01',
  group: 'positive',
  query: {
    starts: [{ id: 'player', position: [0, 0, 0], state: 'available', cost: 0 }],
    goal: [3, 0, 0],
  },
  setup: {},
  assertions: [],
  tags: [],
  evidence: [],
});
const box = (id: string, x: number): FollowingSupport => ({
  id,
  level: 'level',
  model: 'fixture',
  spawn: [x, 0, 0],
  maxDistance: 10,
  initialState: 0,
  geometryKind: 'box',
  assumption: 'placement-within-activity-range',
  bodies: [
    Array.from({ length: 8 }, (_, bits) => [
      x + (bits & 1 ? 1 : -1),
      bits & 2 ? 2 : 0,
      bits & 4 ? 1 : -1,
    ]),
  ],
});
const input = (): PhysicalInput => ({
  ground: {
    surfaces: [],
    options: { walls: [], speed: 5, maxVertical: 0.5, profile: { radius: 0.2, height: 1.6 } },
  },
  collision: { positions: [], indices: [] },
  locomotion: {
    speed: 5,
    sprintSpeed: 7,
    sprintAcceleration: 10,
    stamina: { capacity: 8, initial: 8, recoveryRate: 1, recoveryDelay: 1, reserve: 0 },
  },
  movement: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 1,
      maxFallingSpeed: 10,
      apexTime: 0,
      maxHorizontalSpeed: 5,
      startHorizontalSpeed: 5,
      airOverspeedDeceleration: 5,
      airAcceleration: 10,
      airDeceleration: 10,
    },
    maxSlope: 45,
    runAirSpeed: 5,
    stepUp: 0.4,
    stepDown: 0.5,
  },
  devices: { devices: [], ropes: [], followingSupports: [box('a', 0), box('b', 4)] },
});
const unavailable: RouteResult = {
  route: { status: 'no-verified-route' },
  connections: [],
  diagnostics: { truncated: false },
};

test('shared manifest remains a complete population and cannot be mistaken for plain service queries', async () => {
  const file = new URL('../bench/scenes/mechanisms/suite.json', import.meta.url);
  const suite = await readMechanismSuite(fileURLToPath(file));
  assert.equal(suite.cases.length, 266);
  assert.equal(suite.cases.filter((c) => expectation(c) === 'reject').length, 4);
  await assert.rejects(readWorkload(fileURLToPath(file)), /Scenario manifests/);
  assert.equal(
    JSON.parse(await readFile(file, 'utf8')).cases[0].query.goal[0],
    suite.cases[0].query.goal[0],
  );
});
test('portable roots cannot resolve outside their explicitly supplied directories', () => {
  assert.equal(
    resourcePath('exports/map01.json', { exports: '/data/export', retained: '/data/old' }),
    '/data/export/map01.json',
  );
  assert.throws(
    () => resourcePath('exports/../../config', { exports: '/data/export', retained: '/data/old' }),
    /escapes/,
  );
});
test('resource scenarios are applied before preparation without changing the source policy', () => {
  const source = input(),
    c = item();
  c.setup = {
    locomotion: { ...source.locomotion, stamina: { ...source.locomotion.stamina!, initial: 0 } },
    locomotionPatch: { stamina: { initial: 0 } },
  };
  const next = scenarioInput(source, c);
  assert.equal(next.locomotion.stamina!.initial, 0);
  assert.equal(next.ground.options.locomotion!.stamina!.initial, 0);
  assert.equal(source.locomotion.stamina!.initial, 8);
  c.setup.locomotionPatch!.stamina!.initial = 2;
  assert.throws(() => scenarioInput(source, c), /Resolved locomotion/);
});
test('disallowed boxes become fixed collision while movable source spheres remain exact', () => {
  const source = input(),
    c = item(),
    before = structuredClone(source);
  c.setup.followingPlacement = {
    movableSourceIds: ['a'],
    minimumDistinctUsedBoxes: 1,
    retainOtherSourceBoxes: true,
    jointSnapshot: true,
    sourceActivityRanges: [{ id: 'a', spawn: [0, 0, 0], radius: 10 }],
  };
  const next = scenarioInput(source, c);
  assert.deepEqual(
    next.devices!.followingSupports!.map((b) => b.id),
    ['a'],
  );
  assert.ok(next.collision.positions.length > 0);
  assert.deepEqual(source, before);
  c.setup.followingPlacement.sourceActivityRanges[0].radius = 11;
  assert.throws(() => scenarioInput(source, c), /activity sphere/);
});
test('explicit rejections never turn missing assets, timeouts or partial traces into passes', () => {
  const c = item();
  c.assertions = ['no-complete-route-from-unavailable-arrival'];
  assert.equal(classify(c, unavailable), 'correct-rejection');
  for (const [reason, status] of [
    ['timeout', 'timeout'],
    ['input-unavailable:missing', 'input-unavailable'],
    ['unsupported-setup:x', 'unsupported-setup'],
  ] as const)
    assert.equal(classify(c, { ...unavailable, reason }), status);
  assert.equal(classify(c, { ...unavailable, partial: true }), 'incomplete');
  const invalid = {
    ...unavailable,
    route: {
      status: 'complete',
      start: 'player',
      arrivalCost: 0,
      cost: 1,
      length: 1,
      points: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      segments: [],
    },
  } as RouteResult;
  assert.equal(classify(c, invalid, { valid: false } as Evaluation), 'invalid-route');
  assert.equal(classify(c, invalid, { valid: true } as Evaluation), 'unexpected-complete');
});
test('mechanism witnesses are separate from valid alternative routes', () => {
  const c = item();
  c.assertions = ['exercise:launch', 'exercise:stair-support-transitions'];
  const route = {
    ...unavailable,
    route: {
      status: 'complete',
      start: 'player',
      arrivalCost: 0,
      cost: 1,
      length: 1,
      points: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      segments: [],
    },
  } as RouteResult;
  assert.deepEqual(exercised(c, route), [
    { assertion: 'exercise:launch', status: 'not-exercised' },
    { assertion: 'exercise:stair-support-transitions', status: 'unassessed' },
  ]);
});
test('diagnostic bootstrap deadline retires an unready worker instead of hanging before query timing', async () => {
  await assert.rejects(
    prepareWorkerSolver({
      count: 1,
      config: gangliaV1Defaults,
      dataRoot: 'slow-start',
      extractor: '',
      startupTimeoutMs: 10,
      entry: new URL('./fixtures/scene-worker.ts', import.meta.url),
    }),
    /startup exceeded its deadline/,
  );
});

test('one displayed conveyor box cannot certify a walk across its whole swept path', async () => {
  const { sweepSupports } = await import('#@/src/model/supports.ts');
  const body = (x: number) =>
    Array.from({ length: 8 }, (_, bits): [number, number, number] => [
      x + (bits & 1 ? 1 : -1),
      bits & 2 ? 2 : 1,
      bits & 4 ? 1 : -1,
    ]);
  const source = input();
  source.devices!.movingSupports = [
    {
      id: 'belt',
      level: 'test',
      model: 'source',
      family: 'conveyor',
      assumption: 'phase-free-swept-support',
      ...sweepSupports('belt', [[body(0)], [body(10)]], null),
    },
  ];
  const c = item();
  c.setup.requiredSupport = 'belt';
  c.assertions = ['exercise:single-conveyor-pose'];
  const result: RouteResult = {
    route: {
      status: 'complete',
      start: 'player',
      arrivalCost: 0,
      cost: 1,
      length: 1.6,
      points: [
        [4.2, 2.01, 0],
        [5.8, 2.01, 0],
      ],
      segments: [
        {
          mode: 'walk',
          points: [
            [4.2, 2.01, 0],
            [5.8, 2.01, 0],
          ],
          times: [0, 1],
        },
      ],
    },
    connections: [],
    diagnostics: { truncated: false },
    supportBoxes: [
      { device: 'belt', family: 'conveyor', role: 'use', min: [4, 1, -1], max: [6, 2, 1] },
    ],
  };
  assert.equal(exercised(c, result, source)[0].status, 'exercised');
  if (result.route.status === 'complete')
    result.route.segments[0].points = [
      [0, 2.01, 0],
      [10, 2.01, 0],
    ];
  assert.equal(exercised(c, result, source)[0].status, 'not-exercised');
});
