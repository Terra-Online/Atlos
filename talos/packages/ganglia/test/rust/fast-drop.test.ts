import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

// Raw two-level support and body facts. The native solver must discover the
// flight and its gait preparation; no precomputed connection or witness is supplied.
const input: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'lower',
        vertices: [
          [-4.0, 0.0, -2.0],
          [5.0, 0.0, -2.0],
          [5.0, 0.0, 2.0],
          [-4.0, 0.0, 2.0],
        ],
      },
      {
        id: 'upper',
        vertices: [
          [-4.0, 2.0, -2.0],
          [0.0, 2.0, -2.0],
          [0.0, 2.0, 2.0],
          [-4.0, 2.0, 2.0],
        ],
      },
    ],
    options: {
      speed: 2.0,
      maxVertical: 0.5,
      profile: {
        height: 1.8,
        radius: 0.1,
      },
      walls: [],
    },
  },
  collision: {
    indices: [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6],
    positions: [
      -4.0, 0.0, -2.0, 5.0, 0.0, -2.0, 5.0, 0.0, 2.0, -4.0, 0.0, 2.0, -4.0, 2.0, -2.0, 0.0, 2.0,
      -2.0, 0.0, 2.0, 2.0, -4.0, 2.0, 2.0,
    ],
  },
  locomotion: {
    speed: 2.0,
    sprintAcceleration: 10.0,
    sprintSpeed: 5.0,
    sprintThrough: ['drop'],
    stamina: {
      activationCost: 1.0,
      capacity: 10.0,
      initial: 10.0,
      recoveryDelay: 1.0,
      recoveryRate: 1.0,
      reserve: 1.0,
      sprintDrain: 2.0,
    },
  },
  movement: {
    model: {
      airAcceleration: 30.0,
      airDeceleration: 30.0,
      apexTime: 0.0,
      fallingGravity: 10.0,
      gravity: 10.0,
      maxFallingSpeed: 20.0,
      maxHorizontalSpeed: 6.0,
      // Equal entry/cap speed expresses the source model's constant-speed flight.
      startHorizontalSpeed: 6,
      airOverspeedDeceleration: 1,
      maxJumpHeight: 1.0,
    },
    maxSlope: 45,
    runAirSpeed: 2.0,
    stepUp: 0.5,
    stepDown: 0.5,
  },
};

test('Rust fast drop replays with its sprint approach and rejects the same flight without it', async () => {
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-2, 2.01, 0], state: 'available', cost: 0 }],
    goal: [2, 0.01, 0],
  };
  const solver = await prepareRouteSolver(
    {
      ...gangliaV1Defaults,
      algorithm: 'ganglia-v1-rust',
      maxCandidates: 1500,
      maxShortcutCandidates: 16,
      maxLinks: 10,
      sampleSpacing: 0.5,
    },
    { kind: 'physical', input },
  );
  try {
    const result = await solver.solve(query);
    assert.notEqual(result.partial, true);
    const route = result.route;
    assert.equal(route.status, 'complete');
    if (route.status !== 'complete') return;
    const dropIndex = route.segments.findIndex((s) => s.mode === 'drop');
    assert.ok(dropIndex > 0, 'native route prepares its drop on supported ground');
    const drop = route.segments[dropIndex];
    assert.ok(drop.flight, 'native discovery supplies the physical flight witness');
    assert.equal(drop.requiredGait, 'sprint');
    assert.ok(
      route.segments.slice(0, dropIndex).some((s) => s.mode === 'walk' && s.gait === 'sprint'),
    );
    const verify = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')]);
    const positive = verify(query, route);
    assert.equal(positive.valid, true, positive.issues.join('; '));

    // Keep the actual selected drop witness, timing and control. Rebind the
    // arrival so rejection demonstrates missing gait, rather than a start mismatch.
    const segments = route.segments.slice(dropIndex);
    const points = [segments[0].points[0], ...segments.flatMap((s) => s.points.slice(1))];
    const schedule = route.schedule!.filter((block) =>
      block.segments.every((s) => s.mode !== 'walk'),
    );
    assert.ok(schedule.length > 0);
    const omitted: Route = {
      status: 'complete',
      start: route.start,
      arrivalCost: 0,
      points,
      segments,
      schedule,
      cost: segments.reduce((n, s) => n + s.times.at(-1)!, 0),
      length: segments.reduce(
        (n, s) =>
          n +
          s.points
            .slice(1)
            .reduce(
              (total, p, i) => total + Math.hypot(...p.map((v, axis) => v - s.points[i][axis])),
              0,
            ),
        0,
      ),
    };
    const negative = verify(
      { ...query, starts: [{ ...query.starts[0], position: points[0] }] },
      omitted,
    );
    assert.equal(negative.valid, false);
    assert.ok(
      negative.issues.some(
        (issue) =>
          issue.includes('Resource controls are infeasible') || issue.includes('active sprint'),
      ),
      negative.issues.join('; '),
    );
  } finally {
    await solver.close();
  }
});
