import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld, type Capsule } from '#@/src/collision.ts';
import type { Vec3, Wall } from '#@/src/geometry.ts';
import { motionEvidence } from '#@/src/v1/motion/evidence.ts';
import {
  type ApproachCache,
  type JumpOptions,
  type RunOffOptions,
  jumpConnection,
  jumpDuration,
  runOffConnection,
  createMotionVariants,
} from '#@/src/v1/motion/jumps.ts';

const profile = { radius: 0.35, height: 1.66 };
const options: JumpOptions = {
  profile,
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 10,
  apexTime: 0.2,
  maxHorizontalSpeed: 7,
  mode: 'jump',
  sweep: () => null,
  walls: [],
};
const world = (triangles: Vec3[][]) =>
  createCollisionWorld({
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  });
const plane = (axis: number, position: number, min = -100, max = 100): Vec3[][] => {
  const point = (a: number, b: number): Vec3 => (axis === 0 ? [position, a, b] : [a, position, b]);
  return [
    [point(min, min), point(max, min), point(max, max)],
    [point(min, min), point(max, max), point(min, max)],
  ];
};

test('source height and horizontal speed bounds keep jump feasibility directed', () => {
  assert.equal(jumpConnection([0, 0, 0], [1, 2.01, 0], options), null);
  assert.equal(jumpConnection([0, 0, 0], [1, 1, 0], { ...options, mode: 'drop' }), null);
  assert.equal(jumpConnection([0, 0, 0], [100, 0, 0], options), null);
  const drop = jumpConnection([100, 69, 200], [105, 0, 201], { ...options, mode: 'drop' });
  assert.ok(drop);
  assert.equal(drop.mode, 'drop');
  assert.equal(drop.motionValidation, 'model-based');
  assert.ok(!('state' in drop));
  assert.deepEqual(drop.points[0], [100, 69, 200]);
  assert.deepEqual(drop.points.at(-1), [105, 0, 201]);
  assert.equal(jumpConnection([105, 0, 201], [100, 69, 200], options), null);
});

test('descent reaches terminal speed analytically and preserves phase boundaries', () => {
  const drop = jumpConnection([0, 69, 0], [0, 0, 0], { ...options, mode: 'drop' });
  assert.ok(drop);
  assert.ok(Math.abs(drop.times.at(-1)! - 7.4) < 1e-12);
  const terminal = drop.times.findIndex((time) => time === 1);
  assert.ok(terminal > 0);
  assert.equal(drop.points[terminal][1], 64);
  for (let i = 1; i < drop.times.length; i++) {
    const dt = drop.times[i] - drop.times[i - 1];
    assert.ok(dt > 0 && dt <= 0.025 + 1e-12);
    assert.ok((drop.points[i - 1][1] - drop.points[i][1]) / dt <= 10 + 1e-10);
  }
  const short = jumpConnection([0, 1, 0], [0, 0, 0], { ...options, mode: 'drop' });
  assert.ok(short);
  assert.ok(Math.abs(short.times.at(-1)! - Math.sqrt(0.2)) < 1e-12);
  const jump = jumpConnection([0, 0, 0], [1, 0, 0], options);
  assert.ok(jump);
  const apexStart = Math.sqrt(40) / 10;
  assert.ok(jump.times.some((time) => Math.abs(time - apexStart) < 1e-12));
  assert.ok(jump.times.some((time) => Math.abs(time - apexStart - 0.2) < 1e-12));
  assert.ok(jump.points.some((point) => Math.abs(point[1] - 2) < 1e-12));
});

test('continuous capsule sweeps catch a thin obstacle between clear sample endpoints', () => {
  const collision = world(plane(0, 0.03));
  const body = { radius: 0.001, height: 0.01 };
  const start: Vec3 = [0, 1, 0],
    end: Vec3 = [5, 1, 0];
  assert.equal(collision.sweepCapsule(start, start, body), null);
  assert.equal(collision.sweepCapsule(end, end, body), null);
  assert.equal(
    jumpConnection(start, end, { ...options, profile: body, sweep: collision.sweepCapsule }),
    null,
  );
});

test('curved intervals inflate the full body and include sphere, headroom and floor contacts', () => {
  const seen: { a: Vec3; b: Vec3; capsule: Capsule }[] = [];
  assert.ok(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      sweep: (a, b, capsule) => {
        seen.push({ a, b, capsule });
        return null;
      },
    }),
  );
  assert.ok(seen.some(({ capsule }) => capsule.inflation! > 0));
  assert.ok(
    seen.every(
      ({ capsule }) => capsule.radius === profile.radius && capsule.height === profile.height,
    ),
  );
  const ceiling = world(plane(1, 1.7));
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, sweep: ceiling.sweepCapsule }),
    null,
  );
  const floor = world(plane(1, 0));
  assert.equal(
    jumpConnection([0, 0, 0], [1, 0, 0], { ...options, sweep: floor.sweepCapsule }),
    null,
  );
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0, 0], { ...options, sweep: floor.sweepCapsule }),
    null,
  );
  assert.ok(jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, sweep: floor.sweepCapsule }));
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      clearance: 0.03,
      sweep: floor.sweepCapsule,
    }),
    null,
  );
  const sphere = world([
    [
      [0.5, 2.3, 0],
      [0.5, 2.3, 0],
      [0.5, 2.3, 0],
    ],
  ]);
  assert.equal(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      profile: { radius: 0.35, height: 0.7 },
      sweep: sphere.sweepCapsule,
    }),
    null,
  );
});

test('quadratic deviation inflation catches an arc contact missed by every sample and uninflated chord', () => {
  const body = { radius: 0.00001, height: 0.00002 };
  const start: Vec3 = [0, 1, 0],
    end: Vec3 = [5, 1, 0];
  const arc = jumpConnection(start, end, { ...options, profile: body });
  assert.ok(arc);
  const time = arc.times[1] / 2;
  const point: Vec3 = [
    (5 * time) / arc.times.at(-1)!,
    1 + Math.sqrt(40) * time - 5 * time * time + body.radius,
    0,
  ];
  const collision = world([[point, point, point]]);
  assert.ok(
    arc.points.every((position) => collision.sweepCapsule(position, position, body) === null),
  );
  assert.equal(collision.sweepCapsule(arc.points[0], arc.points[1], body), null);
  assert.equal(
    jumpConnection(start, end, { ...options, profile: body, sweep: collision.sweepCapsule }),
    null,
  );
});

test('active and unresolved air walls block each curved segment with body clearance', () => {
  const wall: Wall = { min: [0.4, -10, -0.2], max: [0.6, 10, 0.2], state: 'unknown' };
  for (const state of ['active', 'unknown'] as const) {
    assert.equal(
      jumpConnection([0, 0.02, 0], [1, 0.02, 0], { ...options, walls: [{ ...wall, state }] }),
      null,
    );
  }
  assert.ok(
    jumpConnection([0, 0.02, 0], [1, 0.02, 0], {
      ...options,
      walls: [{ ...wall, state: 'inactive' }],
    }),
  );
});

test('invalid parameters and unsupported sweep budgets cannot create candidates', () => {
  for (const changed of [
    { gravity: 0 },
    { fallingGravity: -1 },
    { maxFallingSpeed: 0 },
    { apexTime: -1 },
    { maxJumpHeight: -1 },
    { maxHorizontalSpeed: -1 },
    { clearance: -1 },
    { mode: 'launch' },
    { profile: { radius: 1, height: 1 } },
    { sweep: null },
    { walls: [{}] },
  ])
    assert.throws(() =>
      jumpConnection([0, 0, 0], [1, 0, 0], { ...options, ...changed } as unknown as Parameters<
        typeof jumpConnection
      >[2]),
    );
  assert.throws(() => jumpConnection([0, NaN, 0], [1, 0, 0], options));
  assert.throws(
    () => jumpConnection([0, 1e8, 0], [0, 0, 0], { ...options, mode: 'drop' }),
    /sweep budget/,
  );
});

test('analytic duration reuses the complete jump and terminal-fall phase model', () => {
  for (const [startHeight, endHeight, mode] of [
    [0, 0, 'jump'],
    [69, 0, 'drop'],
    [0, 1, 'jump'],
  ] as [number, number, 'jump' | 'drop'][]) {
    const model: JumpOptions = { ...options, mode };
    const connection = jumpConnection([0, startHeight, 0], [0, endHeight, 0], model);
    assert.ok(connection);
    assert.equal(jumpDuration(startHeight, endHeight, model), connection.times.at(-1));
  }
  // Frozen phase-sum result: a sampled phase endpoint's multiply/divide can
  // differ by one ulp, so it is not an exact analytic-duration reference.
  assert.equal(
    jumpDuration(0, 0, { ...options, fallingGravity: 17.25, maxFallingSpeed: 20, apexTime: 0.2 }),
    1.3139989443767528,
  );
  assert.equal(jumpDuration(0, 3, { ...options, mode: 'jump' }), null);
  assert.throws(() => jumpDuration(0, 0, { ...options, gravity: 0 }), /Invalid jump model/);
  assert.throws(
    () => jumpDuration(Number.MAX_VALUE, 0, { ...options, maxJumpHeight: Number.MAX_VALUE }),
    /Non-finite jump model/,
  );
});

test('walk-off drops preserve support before free fall under low headroom', () => {
  const rectangle = (left: number, right: number, height: number): Vec3[][] => [
    [
      [left, height, -3],
      [right, height, 3],
      [right, height, -3],
    ],
    [
      [left, height, -3],
      [left, height, 3],
      [right, height, 3],
    ],
  ];
  for (const angle of [0, Math.PI / 3, Math.PI / 2]) {
    const transform: (value: readonly number[]) => Vec3 = ([x, y, z]: readonly number[]): Vec3 => [
      -1024.8 + x * Math.cos(angle) - z * Math.sin(angle),
      y,
      512.4 + x * Math.sin(angle) + z * Math.cos(angle),
    ];
    const collision = world(
      [...rectangle(0, 4, 5), ...rectangle(4.5, 10, 0), ...rectangle(0, 4, 7)].map((triangle) =>
        triangle.map(transform),
      ),
    );
    const model: RunOffOptions = {
      ...options,
      gravity: 40,
      fallingGravity: 38,
      maxJumpHeight: 2.1,
      maxFallingSpeed: 80,
      apexTime: 0.1,
      maxHorizontalSpeed: 6.5,
      sweep: collision.sweepCapsule,
      world: collision,
      maxSlope: 46,
    };
    const start: Vec3 = transform([3.5, 5.005, 0]),
      end: Vec3 = transform([6, 0.005, 0]);
    assert.equal(jumpConnection(start, end, { ...model, mode: 'jump' }), null);
    assert.equal(jumpConnection(start, end, { ...model, mode: 'drop' }), null);
    const connection = runOffConnection(start, end, model);
    assert.ok(connection);
    assert.deepEqual(connection.points[0], start);
    assert.deepEqual(connection.points.at(-1), end);
    assert.ok(connection.points.filter((point) => point[1] === start[1]).length > 2);
    for (let index = 1; index < connection.points.length; index++) {
      assert.ok(connection.times[index] > connection.times[index - 1]);
      assert.equal(
        collision.sweepCapsule(connection.points[index - 1], connection.points[index], profile),
        null,
      );
    }
    const barrier = transform([3.8, 5, 0]);
    assert.equal(
      runOffConnection(start, end, {
        ...model,
        walls: [
          {
            min: barrier.map((value) => value - 0.05) as Vec3,
            max: barrier.map((value) => value + 0.05) as Vec3,
            state: 'unknown',
          },
        ],
      }),
      null,
    );
  }
});

test('shared ledge proofs replay query-local approaches without changing steering variants', () => {
  const rectangle = (left: number, right: number, height: number): Vec3[][] => [
    [
      [left, height, -3],
      [right, height, 3],
      [right, height, -3],
    ],
    [
      [left, height, -3],
      [left, height, 3],
      [right, height, 3],
    ],
  ];
  const collision = world([...rectangle(0, 4, 5), ...rectangle(4.5, 10, 0)]);
  let supports = 0;
  const counted = {
    sweepCapsule: collision.sweepCapsule,
    groundAt: (...args: Parameters<typeof collision.groundAt>) => {
      supports++;
      return collision.groundAt(...args);
    },
  };
  const start: Vec3 = [3.5, 5.005, 0],
    end: Vec3 = [6, 0.005, 0];
  for (const blocked of [false, true]) {
    const settings: RunOffOptions = {
      ...options,
      gravity: 40,
      fallingGravity: 38,
      maxJumpHeight: 2.1,
      maxFallingSpeed: 80,
      apexTime: 0.1,
      maxHorizontalSpeed: 6.5,
      airAcceleration: 60,
      airDeceleration: 10,
      sweep: counted.sweepCapsule,
      world: counted,
      maxSlope: 46,
      exit: [4.5, 0],
      speedFraction: 0.5,
      terminal: 'balanced',
      walls: blocked ? [{ min: [3.8, 4, -1], max: [3.9, 8, 1], state: 'active' }] : [],
    };
    const evidence = motionEvidence(counted, [], JSON.stringify(settings.walls));
    const coldCache: ApproachCache = new Map();
    const cold = runOffConnection(start, end, settings, coldCache, evidence.approach);
    assert.ok(supports > 0);
    assert.equal(cold !== null, !blocked);
    supports = 0;
    const warmCache: ApproachCache = new Map();
    assert.equal(warmCache.size, 0);
    const warm = runOffConnection(start, end, settings, warmCache, evidence.approach);
    assert.equal(supports, 0);
    assert.deepEqual(warm, cold);
    assert.deepEqual(warmCache, coldCache);
    assert.deepEqual(
      [
        ...createMotionVariants(
          settings,
          counted,
          profile,
          new Map(),
          warmCache,
        )(start, end, settings.exit),
      ],
      [
        ...createMotionVariants(
          settings,
          counted,
          profile,
          new Map(),
          coldCache,
        )(start, end, settings.exit),
      ],
    );
    const prefix = warmCache.values().next().value;
    if (prefix) {
      prefix.launch[0] = 999;
      prefix.points[0][0] = 999;
      prefix.distances[0] = 999;
      warm!.points[0][0] = 999;
    } else assert.equal(warmCache.values().next().value, null);
    const againCache: ApproachCache = new Map();
    assert.deepEqual(runOffConnection(start, end, settings, againCache, evidence.approach), cold);
    assert.deepEqual(againCache, coldCache);
    supports = 0;
  }
});

test('bounded air control clears an opening before descending under an overhang', () => {
  const rectangle = (left: number, right: number, height: number): Vec3[][] => [
    [
      [left, height, -3],
      [right, height, 3],
      [right, height, -3],
    ],
    [
      [left, height, -3],
      [left, height, 3],
      [right, height, 3],
    ],
  ];
  const collision = world([
    ...rectangle(-2, 0.5, 20),
    ...rectangle(1.7, 5, 20),
    ...rectangle(0.6, 6, 0),
  ]);
  const model: JumpOptions = {
    ...options,
    gravity: 40,
    fallingGravity: 38,
    maxJumpHeight: 2.1,
    maxFallingSpeed: 80,
    apexTime: 0.1,
    maxHorizontalSpeed: 6.5,
    airAcceleration: 60,
    airDeceleration: 10,
    sweep: collision.sweepCapsule,
  };
  const start: Vec3 = [0, 20.005, 0],
    end: Vec3 = [2.5, 0.005, 0];
  assert.equal(jumpConnection(start, end, model), null);
  const arc = jumpConnection(start, end, { ...model, horizontalSplit: 0.5 });
  assert.ok(arc);
  assert.ok(arc.peakHorizontalSpeed! <= model.maxHorizontalSpeed);
  assert.ok(arc.points.slice(1).some((point, index) => point[0] === arc.points[index][0]));
  for (let index = 1; index < arc.points.length; index++) {
    const speed =
      Math.abs(arc.points[index][0] - arc.points[index - 1][0]) /
      (arc.times[index] - arc.times[index - 1]);
    assert.ok(speed <= model.maxHorizontalSpeed + 1e-9);
    assert.equal(collision.sweepCapsule(arc.points[index - 1], arc.points[index], profile), null);
  }
  assert.equal(
    jumpConnection(start, end, { ...model, horizontalSplit: 0.5, airDeceleration: 0.1 }),
    null,
  );
  assert.throws(
    () => jumpConnection(start, end, { ...model, horizontalSplit: -1 }),
    /horizontal jump/,
  );
});

test('jump impulse decays above sustained air speed and remains collision checked', () => {
  const impulse: JumpOptions = {
    ...options,
    maxHorizontalSpeed: 3,
    startHorizontalSpeed: 9,
    airOverspeedDeceleration: 5,
  };
  assert.equal(jumpConnection([0, 0, 0], [7, 0, 0], { ...options, maxHorizontalSpeed: 3 }), null);
  const arc = jumpConnection([0, 0, 0], [7, 0, 0], impulse);
  assert.ok(arc);
  assert.ok(arc.peakHorizontalSpeed! > 3 && arc.peakHorizontalSpeed! <= 9);
  const speed = (index: number) =>
    (arc.points[index][0] - arc.points[index - 1][0]) / (arc.times[index] - arc.times[index - 1]);
  assert.ok(speed(1) > speed(arc.times.length - 1));
  assert.equal(jumpConnection([0, 0, 0], [20, 0, 0], impulse), null);
  assert.equal(
    jumpConnection([0, 0, 0], [7, 0, 0], {
      ...impulse,
      sweep: () => ({ triangle: 0, distance: 0 }),
    }),
    null,
  );
});
