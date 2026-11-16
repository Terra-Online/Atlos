import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

const surface = (id: string, min: number, max: number, width = 2): Surface => ({
  id,
  vertices: [
    [min, 0, -width],
    [max, 0, -width],
    [max, 0, width],
    [min, 0, width],
  ],
});

test('Rust scene composition times boost pickup and expiry across physical windows and a ride', async () => {
  const floor = surface('floor', -4, 64);
  const v = floor.vertices;
  const input: PhysicalInput = {
    ground: {
      surfaces: [floor],
      options: { speed: 4, maxVertical: 0.5, profile: { radius: 0.2, height: 1.8 }, walls: [] },
    },
    collision: {
      positions: [v[0], v[2], v[1], v[0], v[3], v[2]].flat(),
      indices: [0, 1, 2, 3, 4, 5],
    },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 20,
        maxJumpHeight: 0,
        maxFallingSpeed: 12,
        apexTime: 0,
        maxHorizontalSpeed: 0,
        startHorizontalSpeed: 0,
        airAcceleration: 0,
        airDeceleration: 0,
        airOverspeedDeceleration: 0,
      },
      maxSlope: 45,
      runAirSpeed: 0,
      stepUp: 0.3,
      stepDown: 0.3,
    },
    locomotion: { speed: 4, sprintSpeed: 4, sprintAcceleration: 10 },
    devices: {
      devices: [
        {
          id: 'fast',
          kind: 'accelerate',
          position: [2, 0, 0],
          goal: { position: [2, 0, 0], interaction: { radius: 0.15 } },
          seeds: [[2, 0, 0]],
          unitScale: true,
          resolved: true,
          speed: 2,
          overhead: 0,
          duration: 1,
          fixedLaunch: false,
          aim: null,
          height: 0,
          aimClearance: 0,
          boostMultiplier: 2,
        },
      ],
      ropes: [],
      movingSupports: [
        {
          id: 'shuttle',
          family: 'platform',
          level: 'test',
          model: 'shuttle',
          assumption: 'phase-free-swept-support',
          surfaces: [surface('sweep', 3.5, 10.5, 1)],
          surfacePoses: [[{ fromPose: 0, toPose: 1, body: 0 }]],
          transfers: [
            { from: [4, 0, 0], to: [10, 0, 0], speed: 20, fromPose: 0, toPose: 1, body: 0 },
          ],
        },
      ],
    },
  };
  const windows: { start: number[]; target: number[] }[] = [];
  const request: RouteQuery = {
    starts: [{ id: 'player', position: [0, 0, 0], state: 'available', cost: 0.25 }],
    goal: [60, 0, 0],
  };
  const solver = await prepareRouteSolver(
    {
      ...gangliaV1Defaults,
      algorithm: 'ganglia-v1-rust',
      maxCandidates: 0,
      maxShortcutCandidates: 0,
      tileSpan: 16,
      gridSpan: 8,
      maxTiles: 4,
      margin: 1,
    },
    {
      kind: 'scene',
      scene: {
        scene: 'boost-clock',
        source: null,
        walls: [],
        navigation: { surfaces: [floor], options: { speed: 4, maxVertical: 0.5 } },
      },
      locomotion: input.locomotion,
      resources: {
        query: async (_scene, _source, start, target) => {
          windows.push({ start: [...start], target: [...target] });
          return { status: 'ready' as const };
        },
        physical: async () => ({ input, revision: 'boost-clock/1', coverage: 'complete' as const }),
        solve: async () => {
          throw new Error('TypeScript solving must not run');
        },
        ground: async () => {
          throw new Error('TypeScript ground preparation must not run');
        },
        key: () => 'boost-clock/1',
        route: () => ({}),
        wait: async () => {},
      },
    },
  );
  try {
    const result = await solver.solve(request);
    assert.equal(result.route.status, 'complete');
    assert.equal(result.partial, false);
    assert.ok(result.route.status === 'complete');
    assert.ok(windows.some((window) => window.start[0] < 1 && window.target[0] < 30));
    assert.ok(windows.some((window) => window.start[0] > 10 && window.target[0] === 60));
    const route = result.route;
    const ride = route.segments.find((segment) => segment.connection === 'moving-ride/shuttle/0');
    assert.ok(ride, 'the fixture must exercise a boost-independent device clock');
    assert.equal(ride.boost, undefined);
    assert.deepEqual(ride.times, [0, 0.3]);
    const afterRide = route.segments.slice(route.segments.indexOf(ride) + 1);
    assert.ok(afterRide.some((segment) => segment.boost?.id === 'fast'));
    assert.equal(route.segments.at(-1)!.boost, undefined);
    const verifier = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')]);
    const evaluation = verifier(request, route);
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    // Reaching the pickup centre happens after first entering its volume. A
    // clock based on that source node, or paused across the ride, expires late.
    const invalid = structuredClone(route);
    let elapsed = 0;
    const late = route.segments.find((segment) => {
      const start = elapsed;
      elapsed += segment.times.at(-1)!;
      return segment.mode === 'walk' && !segment.boost && start > 1.5 && start < 2.5;
    });
    assert.ok(late);
    for (const block of invalid.schedule ?? [])
      for (const segment of block.segments)
        if (segment.mode === 'walk' && segment.points[0][0] === late.points[0][0])
          segment.boost = { id: 'fast', multiplier: 2, duration: 1 };
    assert.equal(verifier(request, invalid).valid, false);
  } finally {
    await solver.close();
  }
});
