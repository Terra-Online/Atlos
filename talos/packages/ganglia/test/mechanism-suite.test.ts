import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  checkSetup,
  classify,
  scenarioInput,
  type MechanismCase,
} from '#@/bench/mechanism-suite.ts';
import { readWorkload } from '#@/bench/workload.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

const item = (): MechanismCase => ({
  id: 'fixture',
  scene: 'fixture',
  group: 'resources-and-composition',
  query: {
    starts: [{ id: 'start', position: [0, 0, 0], state: 'available', cost: 0 }],
    goal: [3, 0, 0],
  },
  setup: {},
  assertions: [],
  evidence: [],
  tags: [],
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
  devices: {
    devices: [],
    ropes: [],
    followingSupports: ['a', 'b'].map((id, index) => ({
      id,
      level: 'level',
      model: 'box',
      spawn: [index * 4, 0, 0],
      maxDistance: 10,
      initialState: 0,
      geometryKind: 'box',
      assumption: 'placement-within-activity-range',
      bodies: [
        Array.from({ length: 8 }, (_, bits) => [
          index * 4 + (bits & 1 ? 1 : -1),
          bits & 2 ? 2 : 0,
          bits & 4 ? 1 : -1,
        ]),
      ],
    })),
  },
});

test('scenario resources apply before preparation without mutating source movement', () => {
  const source = input(),
    c = item();
  c.setup = {
    locomotion: { ...source.locomotion, stamina: { ...source.locomotion.stamina!, initial: 0 } },
    locomotionPatch: { stamina: { initial: 0 } },
  };
  const transformed = scenarioInput(source, c);
  assert.equal(transformed.locomotion.stamina!.initial, 0);
  assert.equal(transformed.ground.options.locomotion!.stamina!.initial, 0);
  assert.equal(source.locomotion.stamina!.initial, 8);
  c.setup.locomotionPatch!.stamina!.initial = 2;
  assert.throws(() => scenarioInput(source, c), /Resolved locomotion/);
});

test('a selected movable box retains unselected bodies as source collision', () => {
  const source = input(),
    before = structuredClone(source),
    c = item();
  c.setup.followingPlacement = {
    movableSourceIds: ['a'],
    minimumDistinctUsedBoxes: 1,
    retainOtherSourceBoxes: true,
    jointSnapshot: true,
    sourceActivityRanges: [{ id: 'a', spawn: [0, 0, 0], radius: 10 }],
  };
  const transformed = scenarioInput(source, c);
  assert.deepEqual(
    transformed.devices!.followingSupports!.map((s) => s.id),
    ['a'],
  );
  assert.ok(transformed.collision.indices.length > 0);
  assert.deepEqual(source, before);
  c.setup.followingPlacement.sourceActivityRanges[0].radius = 11;
  assert.throws(() => scenarioInput(source, c), /activity sphere/);
});

test('missing capabilities and scenario manifests cannot silently become ordinary query success', async () => {
  const c = item();
  c.setup.supportModel = 'phase-free-circular-surface';
  assert.doesNotThrow(() => checkSetup(c));
  Object.assign(c.setup, { supportModel: 'unknown' });
  assert.throws(() => checkSetup(c), /Unsupported support model/);
  await assert.rejects(
    readWorkload(fileURLToPath(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url))),
    /Scenario manifests/,
  );
  const unavailable = {
    route: { status: 'no-verified-route' as const },
    connections: [],
    diagnostics: { truncated: false },
    reason: 'timeout',
  };
  assert.equal(classify(c, unavailable), 'timeout');
  assert.equal(
    classify(c, { ...unavailable, reason: 'input-unavailable:source missing' }),
    'input-unavailable',
  );
});
