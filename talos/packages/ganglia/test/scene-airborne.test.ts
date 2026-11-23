import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyRoute } from '#@/src/evaluation/route.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { Route } from '#@/src/route.ts';
import type { PhysicalInput, SceneResources } from '#@/src/solver/index.ts';
import { prepareRouteSolver, gangliaV1Defaults } from '#@/src/solver/index.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';

const floor = (id: string, left: number, right: number): Surface => ({
  id,
  vertices: [
    [left, 0, -2],
    [right, 0, -2],
    [right, 0, 2],
    [left, 0, 2],
  ],
});
const lower = floor('lower', 10, 14);
lower.vertices = lower.vertices.map(([x, , z]): Vec3 => [x, -10, z]);
const surfaces = [floor('left', 0, 4), floor('right', 10, 14), lower];
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
const input: PhysicalInput = {
  ground: {
    surfaces,
    options: { speed: 3, maxVertical: 0.5, profile: { radius: 0.3, height: 1.7 }, walls: [] },
  },
  collision: { positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) },
  movement: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 2,
      maxFallingSpeed: 20,
      apexTime: 0.2,
      maxHorizontalSpeed: 3,
      startHorizontalSpeed: 3,
      airOverspeedDeceleration: 5,
      airAcceleration: 20,
      airDeceleration: 10,
    },
    maxSlope: 46,
    runAirSpeed: 3,
    stepUp: 0.4,
    stepDown: 0.5,
  },
  locomotion: { speed: 3, sprintSpeed: 3, sprintAcceleration: 20 },
  devices: {
    ropes: [],
    devices: [
      {
        id: 'boost',
        kind: 'accelerate',
        position: [2, 0, 0],
        goal: { position: [2, 0, 0], interaction: { radius: 0.2 } },
        seeds: [],
        unitScale: true,
        resolved: true,
        speed: 0,
        overhead: 0,
        duration: 3,
        fixedLaunch: false,
        aim: null,
        height: 0,
        aimClearance: 0,
        boostMultiplier: 2.2,
      },
    ],
  },
};

for (const connected of [true, false])
  test(`fresh airborne discovery requires an original-start prefix (connected=${connected})`, async () => {
    const query = {
      starts: [
        { id: 'original', position: [1, 0, 0] as Vec3, cost: 0, state: 'available' as const },
      ],
      goal: [9, 1.8, 0] as Vec3,
      interaction: { radius: 0.5, airborne: true },
    };
    const ground = createGroundPlanner(surfaces, {
      ...input.ground.options,
      locomotion: input.locomotion,
    });
    let snapshots = 0;
    const resources: SceneResources<null, { status: 'ready'; route?: Route }> = {
      query: async (_scene, _source, _start, _target, options) => {
        assert.ok(
          options.corridor.tiles.length > 0,
          'the exporter requires an explicit nonempty tile selection',
        );
        return { status: 'ready' };
      },
      key: () => 'facts',
      ground: async () => input.ground,
      route: () => ({}),
      wait: async () => {},
      physical: async () => {
        snapshots++;
        return { input, revision: 'source', coverage: 'complete' };
      },
      // The global corridor has no grounded airborne endpoint. Its ordinary
      // walking provider can still prove the prefix to a newly discovered entry.
      solve: async (_job, request) => {
        if (request.arrival.id.startsWith('device-entry/')) {
          const native = await preparePhysicalSolver(input, {
            ...gangliaV1Defaults,
            maxCandidates: 600,
            maxLinks: 32,
          });
          try {
            const result = await native.solve({
              starts: [request.arrival],
              goal: request.target,
              interaction: request.interaction,
            });
            return { status: 'ready', route: result.route };
          } finally {
            await native.close();
          }
        }
        return {
          status: 'ready',
          route:
            !connected || request.interaction?.airborne
              ? { status: 'no-verified-route' }
              : ground.plan([request.arrival], request.target, {
                  interaction: request.interaction,
                }),
        };
      },
    };
    resources.route = (job) => ({
      route: job.route,
    });
    const create = (facts = true) =>
      prepareRouteSolver(
        { ...gangliaV1Defaults, maxCandidates: 600, maxLinks: 32 },
        {
          kind: 'scene',
          scene: {
            scene: 'test',
            source: null,
            walls: [],
            navigation: { surfaces, options: input.ground.options },
          },
          resources: facts ? resources : { ...resources, physical: undefined },
          locomotion: input.locomotion,
        },
      );
    if (connected) {
      const baseline = await create(false);
      try {
        const result = await baseline.solve(query);
        assert.ok(result.route.status !== 'complete' || result.partial);
        assert.equal(snapshots, 0);
      } finally {
        await baseline.close();
      }
    }
    const solver = await create();
    try {
      const result = await solver.solve(query);
      assert.equal(snapshots, 1);
      if (!connected) {
        assert.equal(result.partial, true);
        assert.notEqual(result.arrival?.id, 'device-entry/boost');
        return;
      }
      assert.equal(result.route.status, 'complete');
      if (result.route.status !== 'complete') return;
      assert.equal(result.route.start, 'original');
      assert.deepEqual(result.route.points[0], query.starts[0].position);
      assert.ok(result.route.goalHit);
      assert.equal(result.route.boosts?.[0].id, 'boost');
      assert.ok(result.route.boosts![0].elapsed <= 3);
      assert.ok(result.route.boosts![0].position[0] < 2);
      const boostedDuration = result.route.segments
        .filter((s) => s.boost?.id === 'boost')
        .reduce((total, s) => total + (s.boostExpiry ?? s.times.at(-1)!), 0);
      assert.ok(result.route.boosts![0].elapsed > boostedDuration);
      assert.deepEqual(verifyRoute(query, result.route, { maxVertical: 0.5 }).issues, []);
      const repeated = await solver.solve(query);
      assert.equal(snapshots, 2, 'each leg loads its own discovery window');
      assert.deepEqual(repeated.route, result.route);
    } finally {
      await solver.close();
    }
  });
