import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalWorld, createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import { verifyRoute } from '#@/src/evaluation/route.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteEvent } from '#@/src/solver/contract.ts';
import { prepareRouteSolver, gangliaV1Defaults, type SceneResources } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { createDeviceConnections } from '#@/src/v1/solver/physical/devices.ts';
import { composeRoutes, admitAuthoredStart } from '#@/src/v1/solver/route-result.ts';
import { createWindowRoute } from '#@/src/v1/solver/window-route.ts';

type Job = { status: 'ready'; route?: Route };
function fixture() {
  const starts = [
    {
      id: 'blocked',
      position: [0, 0.1, 0] as [number, number, number],
      state: 'available' as const,
      cost: 0,
    },
    {
      id: 'open',
      position: [10, 0.1, 0] as [number, number, number],
      state: 'available' as const,
      cost: 100,
    },
  ];
  const resources: SceneResources<null, Job> = {
    query: async () => ({ status: 'ready' }),
    solve: async (_job, request) => {
      // The physical floor settles the nominal arrival by the permitted 0.1 m.
      const position: [number, number, number] = [request.arrival.position[0], 0, 0];
      return {
        status: 'ready',
        route:
          request.arrival.id === 'blocked'
            ? { status: 'no-verified-route' }
            : {
                status: 'complete',
                start: request.arrival.id,
                arrivalCost: 0,
                cost: 1,
                length: 20 - position[0],
                points: [position, request.target],
                segments: [{ mode: 'walk', points: [position, request.target], times: [0, 1] }],
              },
      };
    },
    key: () => 'floor',
    ground: async () => ({
      surfaces: [
        {
          id: 'floor',
          vertices: [
            [-1, 0, -1],
            [21, 0, -1],
            [21, 0, 1],
            [-1, 0, 1],
          ],
        },
      ],
      options: { speed: 5, maxVertical: 0.1, walls: [], profile: { radius: 0.1, height: 1.8 } },
    }),
    route: (job) => ({ route: job.route }),
    wait: async () => {},
  };
  const navigation = {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [-1, 0, -1],
          [21, 0, -1],
          [21, 0, 1],
          [-1, 0, 1],
        ] as [number, number, number][],
      },
    ],
    options: { speed: 5, maxVertical: 0.1 },
  };
  const scene = { scene: 'fixture', source: null, walls: [], navigation };
  const config = {
    ...gangliaV1Defaults,
    tileSpan: 38.4,
    gridSpan: 32,
    maxTiles: 16,
    margin: 4,
  };
  const locomotion = { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 };
  return { starts, resources, scene, config, locomotion };
}

function waypointFixture() {
  const data = fixture();
  data.scene.navigation.surfaces[0].vertices = [
    [-1, 0, -10],
    [21, 0, -10],
    [21, 0, 10],
    [-1, 0, 10],
  ];
  const options = {
    speed: 5,
    maxVertical: 0.1,
    walls: [],
    profile: { radius: 0.1, height: 1.8 },
    locomotion: data.locomotion,
  };
  data.resources.ground = async () => ({ surfaces: data.scene.navigation.surfaces, options });
  const planner = createGroundPlanner(data.scene.navigation.surfaces, options);
  data.resources.solve = async (_job, request) => ({
    status: 'ready',
    route: planner.plan([request.arrival], request.target, { interaction: request.interaction }),
  });
  return data;
}

test('a complete root query admits the built authored entry without paying a vertical navigation join', async () => {
  const { starts, resources, scene, config } = fixture();
  const vertices = scene.navigation.surfaces[0].vertices;
  const input: PhysicalInput = {
    ground: {
      surfaces: scene.navigation.surfaces,
      options: {
        speed: 5,
        maxVertical: 0.5,
        walls: [],
        profile: { radius: 0.1, height: 1.8 },
      },
    },
    collision: { positions: vertices.flat(), indices: [0, 2, 1, 0, 3, 2] },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 10,
        maxJumpHeight: 1,
        maxFallingSpeed: 10,
        apexTime: 0,
        maxHorizontalSpeed: 5,
        startHorizontalSpeed: 5,
        airOverspeedDeceleration: 10,
        airAcceleration: 20,
        airDeceleration: 20,
      },
      maxSlope: 45,
      runAirSpeed: 5,
      stepUp: 0.4,
      stepDown: 0.5,
    },
    locomotion: {
      speed: 5,
      sprintSpeed: 5,
      sprintAcceleration: 1,
      stamina: {
        capacity: 8,
        initial: 8,
        activationCost: 1,
        sprintDrain: 0,
        recoveryRate: 0.5,
        recoveryDelay: 1,
        reserve: 0,
      },
    },
    devices: {
      ropes: [],
      devices: [
        {
          id: 'pad',
          kind: 'launch',
          position: [10, 0, 0],
          goal: { position: [10, 0.3, 0], interaction: { radius: 0.5 } },
          seeds: [[10, 0, 0]],
          unitScale: true,
          resolved: true,
          speed: 1,
          overhead: 0,
          duration: 0,
          fixedLaunch: true,
          aim: [18, 0, 0],
          height: 2,
          aimClearance: 3,
          boostMultiplier: 1,
        },
      ],
    },
  };
  const built = createDeviceConnections(input.devices!, {
    surfaces: input.ground.surfaces,
    world: createCollisionWorld(input.collision),
    profile: input.ground.options.profile,
    walls: [],
    model: input.movement.model,
    maxSlope: input.movement.maxSlope,
  });
  const launch = built.connections.find((connection) => connection.mode === 'launch');
  assert.ok(launch, JSON.stringify(built.outcomes));
  const entry = launch.points[0],
    end = launch.points.at(-1)!;
  const origin: Vec3 = [entry[0], entry[1] + 0.09, entry[2]],
    goal: Vec3 = [20, end[1], 0];
  const piece: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'open',
    arrivalCost: 7,
    cost: 0,
    length: 0,
    points: [origin, entry, ...launch.points.slice(1), goal],
    segments: [
      { mode: 'walk', points: [origin, entry], times: [0, 0.09 / 5] },
      { ...launch, connection: launch.id },
      { mode: 'walk', points: [end, goal], times: [0, 2 / 5] },
    ],
  };
  const candidate = composeRoutes([piece], input.locomotion);
  assert.ok(candidate.status === 'complete');
  let currentCandidate = candidate;
  resources.solve = async (_job, request) => {
    if (request.target[0] !== 19) return { status: 'ready', route: currentCandidate };
    const from = request.arrival.position,
      to = request.target;
    const length = Math.hypot(...from.map((v, i) => v - to[i]));
    return {
      status: 'ready',
      route: {
        status: 'complete',
        start: request.arrival.id,
        arrivalCost: 0,
        cost: length / 5,
        length,
        points: [from, to],
        segments: [{ mode: 'walk', points: [from, to], times: [0, length / 5] }],
      },
    };
  };
  resources.route = (job) => ({ route: job.route, connections: built.connections });
  const query = { starts: [{ ...starts[1], cost: 7, position: [10, 0.005, 0] as Vec3 }], goal };
  const events: RouteEvent[] = [];
  const solver = await prepareRouteSolver(config, {
    kind: 'scene',
    scene,
    resources,
    locomotion: input.locomotion,
  });
  try {
    const result = await solver.solve(query, { onEvent: (event) => events.push(event) });
    assert.equal(result.partial, false);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.equal(result.route.segments[0].mode, 'launch');
    assert.deepEqual(result.route.segments[0].points, launch.points);
    const world = createPhysicalWorld(input, 'complete');
    const physical = createPhysicalVerifier(() => [world]);
    const evaluation = physical(query, result.route),
      old = physical(query, candidate);
    assert.equal(evaluation.valid, true, evaluation.issues.join());
    assert.equal(old.valid, true, old.issues.join());
    assert.ok(evaluation.costSeconds! < old.costSeconds!);
    for (const event of events)
      if (
        event.type === 'candidate' &&
        !event.result.partial &&
        event.result.route.status === 'complete'
      )
        assert.equal(event.result.route.segments[0].mode, 'launch');
    assert.ok(
      events.some(
        (event) =>
          event.type === 'candidate' &&
          event.result.partial &&
          event.result.route.status === 'complete' &&
          event.result.route.segments[0].mode === 'walk',
      ),
    );
    const wholeTail = await solver.solve({
      ...query,
      starts: [{ ...query.starts[0], position: origin }],
    });
    assert.ok(wholeTail.route.status === 'complete');
    assert.equal(wholeTail.partial, false);
    assert.equal(wholeTail.route.segments[0].mode, 'walk');
    const nearOrigin: Vec3 = [entry[0], entry[1] + 0.005, entry[2]];
    const near = composeRoutes(
      [
        {
          ...piece,
          points: [nearOrigin, ...piece.points.slice(1)],
          segments: [
            { mode: 'walk', points: [nearOrigin, entry], times: [0, 0.005 / 5] },
            ...piece.segments.slice(1),
          ],
        },
      ],
      input.locomotion,
    );
    assert.ok(near.status === 'complete');
    currentCandidate = near;
    const admittedTail = await solver.solve({
      ...query,
      starts: [{ ...query.starts[0], position: nearOrigin }],
    });
    assert.ok(admittedTail.route.status === 'complete');
    assert.equal(admittedTail.partial, false);
    assert.equal(admittedTail.route.segments[0].mode, 'launch');
    const ordered = await solver.solve({ ...query, goal: [19, entry[1], 0], waypoints: [goal] });
    assert.ok(ordered.route.status === 'complete');
    assert.equal(ordered.route.segments[0].mode, 'walk');
    assert.deepEqual(
      verifyRoute({ ...query, goal: [19, entry[1], 0], waypoints: [goal] }, ordered.route, {
        maxVertical: 0.5,
      }).issues,
      [],
    );
    const proof = { connections: built.connections };
    assert.equal(
      admitAuthoredStart(
        candidate,
        { ...query.starts[0], position: [entry[0], entry[1] + 0.4, entry[2]] },
        0.5,
        input.locomotion,
        [proof],
      ),
      candidate,
    );
    assert.equal(
      admitAuthoredStart(candidate, query.starts[0], 0.5, input.locomotion, [proof, proof]),
      candidate,
    );
    assert.equal(
      admitAuthoredStart(
        candidate,
        query.starts[0],
        0.5,
        { ...input.locomotion, stamina: { ...input.locomotion.stamina!, initial: 7 } },
        [proof],
      ),
      candidate,
    );
    const boosted = {
      ...candidate,
      boosts: [{ id: 'boost', multiplier: 2, duration: 3, position: origin, elapsed: 0 }],
    };
    assert.equal(
      admitAuthoredStart(boosted, query.starts[0], 0.5, input.locomotion, [proof]),
      boosted,
    );
    assert.equal(
      admitAuthoredStart(candidate, query.starts[0], 0.5, input.locomotion, []),
      candidate,
    );
    assert.equal(
      admitAuthoredStart(candidate, query.starts[0], 0.5, input.locomotion, [
        { connections: [{ ...launch, times: launch.times.slice(1) }] },
      ]),
      candidate,
    );
  } finally {
    await solver.close();
  }
});

test('scene queries visit ordered waypoints before publishing a complete original query', async () => {
  const { starts, resources, scene, config, locomotion } = waypointFixture();
  const query = {
    starts: [{ ...starts[1], position: [10, 0, 0] as [number, number, number], cost: 7 }],
    goal: [20, 0, 0] as [number, number, number],
    waypoints: [
      [12, 0, 5],
      [16, 0, -4],
    ] as [number, number, number][],
    interaction: { radius: 1 },
  };
  const events: RouteEvent[] = [];
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(query, { onEvent: (event) => events.push(event) });
    assert.equal(result.partial, false);
    assert.equal(result.route.status, 'complete');
    assert.deepEqual(verifyRoute(query, result.route, { maxVertical: 0.1 }).issues, []);
    if (result.route.status === 'complete') {
      assert.equal(result.route.arrivalCost, 7);
      assert.equal(result.route.start, 'open');
      assert.ok(result.route.cost > 7 + 10 / 5);
    }
    const complete = events.filter((event) => event.type === 'candidate' && !event.result.partial);
    assert.ok(complete.length > 0);
    for (const event of complete) {
      if (event.type === 'candidate')
        assert.deepEqual(verifyRoute(query, event.result.route, { maxVertical: 0.1 }).issues, []);
    }
  } finally {
    await solver.close();
  }
});

test('a required waypoint cannot be projected onto a different floor outside its height tolerance', async () => {
  const { starts, resources, scene, config, locomotion } = waypointFixture();
  const events: RouteEvent[] = [];
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(
      {
        starts: [starts[1]],
        goal: [20, 0, 0],
        waypoints: [[12, 1, 5]],
      },
      { onEvent: (event) => events.push(event) },
    );
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(result.reason, 'no-global-candidate');
    assert.equal(
      events.some((event) => event.type === 'candidate' && !event.result.partial),
      false,
    );
  } finally {
    await solver.close();
  }
});

test('a waypoint keeps its original height when physical support differs from the coarse floor', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const ground = await resources.ground({ status: 'ready' });
  const physical = createGroundPlanner(
    ground.surfaces.map((surface) => ({
      ...surface,
      vertices: surface.vertices.map(([x, , z]): Vec3 => [x, 1, z]),
    })),
    { ...ground.options, locomotion },
  );
  resources.solve = async (_job, request) => ({
    status: 'ready',
    route: physical.plan([request.arrival], request.target, { interaction: request.interaction }),
  });
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  const query = {
    starts: [{ ...starts[1], position: [10, 1, 0] as Vec3 }],
    waypoints: [[12, 1, 0] as Vec3],
    goal: [20, 1, 0] as Vec3,
    interaction: { radius: 0.1 },
  };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    assert.equal(result.partial, false);
    assert.deepEqual(verifyRoute(query, result.route, { maxVertical: 0.1 }).issues, []);
  } finally {
    await solver.close();
  }
});

test('an airborne waypoint fallback preserves the full flight and rejects missed or reordered visits', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const ground = await resources.ground({ status: 'ready' });
  const planner = createGroundPlanner(ground.surfaces, { ...ground.options, locomotion });
  const launch: Vec3 = [10, 0, 0],
    apex: Vec3 = [15, 1, 0],
    landing: Vec3 = [18, 0, 0],
    goal: Vec3 = [20, 0, 0];
  const points = [launch, apex, landing, goal];
  const length = points
    .slice(1)
    .reduce(
      (sum, point, i) => sum + Math.hypot(...point.map((value, axis) => value - points[i][axis])),
      0,
    );
  resources.solve = async (_job, request) => ({
    status: 'ready',
    route: request.target.every((value, axis) => value === goal[axis])
      ? {
          status: 'complete',
          start: request.arrival.id,
          arrivalCost: request.arrival.cost,
          cost: request.arrival.cost + 1.4,
          length,
          points,
          segments: [
            {
              mode: 'jump',
              points: [launch, apex, landing],
              times: [0, 0.5, 1],
              connection: 'complete-flight',
            },
            { mode: 'walk', points: [landing, goal], times: [0, 0.4] },
          ],
        }
      : planner.plan([request.arrival], request.target),
  });
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    for (const waypoints of [[apex], [[15, 2, 0] as Vec3], [landing, apex]]) {
      const events: RouteEvent[] = [];
      const query = { starts: [{ ...starts[1], position: launch, cost: 7 }], goal, waypoints };
      const result = await solver.solve(query, { onEvent: (event) => events.push(event) });
      const complete = waypoints.length === 1 && waypoints[0] === apex;
      assert.equal(result.route.status === 'complete' && !result.partial, complete);
      assert.equal(
        events.some((event) => event.type === 'candidate' && !event.result.partial),
        complete,
      );
      if (complete && result.route.status === 'complete') {
        assert.equal(result.route.arrivalCost, 7);
        assert.equal(result.route.cost, 8.4);
        assert.deepEqual(result.route.segments[0].points, [launch, apex, landing]);
        assert.deepEqual(result.route.points.at(-1), goal);
        assert.deepEqual(verifyRoute(query, result.route, { maxVertical: 0.1 }).issues, []);
      }
    }
  } finally {
    await solver.close();
  }
});

test('only the last waypoint leg requests an airborne terminal', async () => {
  const { starts, resources, scene, config, locomotion } = waypointFixture();
  let terminals = 0;
  resources.terminals = async (query) => {
    terminals++;
    assert.deepEqual(query.starts[0].position, [16, 0, -4]);
    assert.equal(query.waypoints, undefined);
    return [
      {
        id: 'terminal',
        route: {
          status: 'complete',
          start: 'entry',
          arrivalCost: 0,
          cost: 0.4,
          length: 2,
          points: [
            [18, 0, 0],
            [20, 0, 0],
          ],
          segments: [
            {
              mode: 'walk',
              points: [
                [18, 0, 0],
                [20, 0, 0],
              ],
              times: [0, 0.4],
            },
          ],
          goalHit: { segment: 0, time: 0.4, position: [20, 0, 0] },
        },
      },
    ];
  };
  const query = {
    starts: [{ ...starts[1], position: [10, 0, 0] as [number, number, number], cost: 7 }],
    goal: [20, 0, 0] as [number, number, number],
    waypoints: [
      [12, 0, 5],
      [16, 0, -4],
    ] as [number, number, number][],
    interaction: { radius: 0.5, airborne: true },
  };
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(query);
    assert.equal(terminals, 1);
    assert.equal(result.partial, false);
    assert.deepEqual(verifyRoute(query, result.route, { maxVertical: 0.1 }).issues, []);
    if (result.route.status === 'complete')
      assert.deepEqual(result.route.goalHit?.position, query.goal);
  } finally {
    await solver.close();
  }
});

test('incompatible waypoint leg layouts cannot publish a complete query', async () => {
  const { starts, resources, scene, config, locomotion } = waypointFixture();
  const solve = resources.solve;
  resources.solve = async (...args) => {
    const job = await solve(...args);
    if (job?.route?.status === 'complete')
      job.route.placements =
        args[1].target[2] === 5 ? [{ device: 'box', position: [0, 0, 0] }] : [];
    return job;
  };
  const events: RouteEvent[] = [];
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(
      {
        starts: [starts[1]],
        goal: [20, 0, 0],
        waypoints: [[12, 0, 5]],
      },
      { onEvent: (event) => events.push(event) },
    );
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(result.reason, 'waypoint-composition');
    assert.equal(
      events.some((event) => event.type === 'candidate' && !event.result.partial),
      false,
    );
  } finally {
    await solver.close();
  }
});

test('cancelling between waypoint legs does not publish the completed prefix', async () => {
  const { starts, resources, scene, config, locomotion } = waypointFixture();
  const controller = new AbortController();
  const events: RouteEvent[] = [];
  let searches = 0;
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(
      {
        starts: [starts[1]],
        goal: [20, 0, 0],
        waypoints: [[12, 0, 5]],
      },
      {
        signal: controller.signal,
        onEvent(event) {
          events.push(event);
          if (event.type === 'progress' && event.phase === 'search' && ++searches === 2)
            controller.abort();
        },
      },
    );
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(result.reason, 'aborted');
    assert.equal(result.diagnostics.truncated, true);
    assert.equal(
      events.some((event) => event.type === 'candidate'),
      false,
    );
  } finally {
    await solver.close();
  }
});

test('a verified whole-guide target approach completes once and pays the selected arrival overhead', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const ground = await resources.ground({ status: 'ready' });
  const planner = createGroundPlanner(ground.surfaces, { ...ground.options, locomotion });
  const calls: string[] = [];
  resources.solve = async (_job, request) => {
    calls.push(request.arrival.id);
    return {
      status: 'ready',
      route: planner.plan([request.arrival], request.target, {
        interaction: request.interaction,
      }),
    };
  };
  resources.route = (job) => ({ route: job.route, diagnostics: { truncated: true } });
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  const events: RouteEvent[] = [];
  try {
    const arrival = { ...starts[1], position: [10, 0, 0] as [number, number, number], cost: 7 };
    const result = await solver.solve(
      { starts: [arrival], goal: [20, 0, 0] },
      { onEvent: (event) => events.push(event) },
    );
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') {
      assert.equal(result.route.start, arrival.id);
      assert.equal(result.route.arrivalCost, 7);
      assert.equal(result.route.cost, 9);
      assert.deepEqual(result.route.points, [
        [10, 0, 0],
        [20, 0, 0],
      ]);
    }
    assert.equal(result.partial, false);
    assert.equal(result.diagnostics.truncated, true);
    assert.equal(result.diagnostics.candidateAttempts, 1);
    assert.deepEqual(calls, ['target-approach']);
    assert.ok(events.some((event) => event.type === 'candidate' && !event.result.partial));
    await solver.solve({ starts: [arrival], goal: [20, 0, 0] });
    assert.deepEqual(calls, ['target-approach', 'target-approach']);
    const constrainedArrival = { ...arrival, groundRange: [0, 0] as [number, number] };
    const constrained = await solver.solve({
      starts: [constrainedArrival],
      goal: [20, 0, 0],
    });
    assert.equal(constrained.route.status, 'complete');
    assert.deepEqual(calls, ['target-approach', 'target-approach', 'target-approach', 'open']);
  } finally {
    await solver.close();
  }
});

test('a target approach after a guide loop cannot certify the omitted prefix', async () => {
  const { starts, resources, config, locomotion } = fixture();
  const ground = await resources.ground({ status: 'ready' });
  const planner = createGroundPlanner(ground.surfaces, { ...ground.options, locomotion });
  const calls: string[] = [];
  resources.solve = async (_job, request) => {
    calls.push(request.arrival.id);
    return { status: 'ready', route: planner.plan([request.arrival], request.target) };
  };
  const arrival = { ...starts[0], position: [0, 0, 0] as [number, number, number] };
  const window = createWindowRoute(
    resources,
    { scene: 'fixture', source: null, walls: [], arrival, target: [10, 0, 0] },
    [
      [0, 0, 0],
      [200, 0, 0],
      [0, 0, 0],
      [10, 0, 0],
    ],
    {
      ...config,
      maxTiles: 8,
      locomotion,
      transfers: [
        [
          [200, 0, 0],
          [0, 0, 0],
        ],
      ],
    },
  );
  let result = await window.advanceTail();
  for (let attempt = 0; attempt < 12 && result.status === 'pending'; attempt++)
    result = await window.advanceTail();
  assert.equal(result.status, 'partial');
  if (result.status === 'partial') {
    assert.deepEqual(result.route.points[0], arrival.position);
    assert.equal(result.coversStart, false);
    assert.equal(result.route.cost, 2);
  }
  assert.deepEqual(calls, ['target-approach']);
});

test('a failed anchor does not discard a verified target approach or poison later queries', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  const events: RouteEvent[] = [];
  const query = { starts, goal: [20, 0, 0] as [number, number, number] };
  try {
    const result = await solver.solve(query, { onEvent: (event) => events.push(event) });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') assert.equal(result.route.start, 'open');
    assert.ok(events.some((event) => event.type === 'candidate' && event.result.partial));
    const repeated = await solver.solve(query);
    assert.deepEqual(repeated, result);
  } finally {
    await solver.close();
  }
});

test('batch lanes overlap and close drains every accepted query in input order', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let running = 0,
    peak = 0;
  const query = resources.query;
  resources.query = async (...args) => {
    running++;
    peak = Math.max(peak, running);
    await gate;
    try {
      return await query(...args);
    } finally {
      running--;
    }
  };
  const solver = await prepareRouteSolver(
    { ...config, batchConcurrency: 2 },
    { kind: 'scene', scene, resources, locomotion },
  );
  const queries = [18, 19, 20].map((x) => ({
    starts: [starts[1]],
    goal: [x, 0, 0] as [number, number, number],
  }));
  const batch = solver.solveBatch(queries);
  const closing = solver.close();
  const alsoClosing = solver.close();
  assert.equal(alsoClosing, closing);
  release();
  const results = await batch;
  await closing;
  assert.equal(peak, 2);
  assert.deepEqual(
    results.map((r) => (r.route.status === 'complete' ? r.route.points.at(-1)?.[0] : null)),
    [18, 19, 20],
  );
  await assert.rejects(solver.solve(queries[0]), /closed/);
});
test('exhausting the retry budget retains partial evidence and reports truncation', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const solver = await prepareRouteSolver(
    { ...config, maxAttempts: 1 },
    { kind: 'scene', scene, resources, locomotion },
  );
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] });
    assert.equal(result.partial, true);
    assert.equal(result.route.status, 'complete');
    assert.equal(result.diagnostics.truncated, true);
    assert.equal(result.diagnostics.candidateAttempts, 1);
  } finally {
    await solver.close();
  }
});
test('cancellation at the search checkpoint stops before physical work', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const controller = new AbortController();
  resources.query = async () => {
    throw new Error('Cancelled query must not load physics');
  };
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve(
      { starts, goal: [20, 0, 0] },
      {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'progress' && event.phase === 'search') controller.abort();
        },
      },
    );
    assert.equal(result.reason, 'aborted');
    assert.equal(result.diagnostics.truncated, true);
  } finally {
    await solver.close();
  }
});

test('a rejected transfer is scoped to its query while another candidate can complete', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  starts[0].position = [0, 2, 0];
  starts[1].cost = 100000;
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') assert.equal(result.route.start, 'open');
    assert.equal(result.diagnostics.candidateAttempts, 2);
    assert.deepEqual(await solver.solve({ starts, goal: [20, 0, 0] }), result);
  } finally {
    await solver.close();
  }
});
test('terminal assets are ranked by complete approach cost and joined at their proven entry', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const tail = (entry: number, cost: number) => ({
    status: 'complete' as const,
    start: 'entry',
    arrivalCost: 0,
    cost,
    length: 20 - entry,
    points: [
      [entry, 0, 0],
      [20, 0, 0],
    ] as [number, number, number][],
    segments: [
      {
        mode: 'walk' as const,
        points: [
          [entry, 0, 0],
          [20, 0, 0],
        ] as [number, number, number][],
        times: [0, cost],
      },
    ],
    goalHit: { segment: 0, time: cost, position: [20, 0, 0] as [number, number, number] },
  });
  resources.terminals = async () => [
    { id: 'expensive', route: tail(15, 100) },
    { id: 'cheap', route: tail(18, 1) },
  ];
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve({
      starts: [starts[1]],
      goal: [20, 0, 0],
      interaction: { radius: 1, airborne: true },
    });
    assert.equal(result.partial, false);
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') {
      assert.deepEqual(result.route.goalHit?.position, [20, 0, 0]);
      assert.ok(result.route.points.some((p) => p[0] === 18));
      assert.ok(result.route.cost < 10);
    }
  } finally {
    await solver.close();
  }
});

test('local discovery truncation survives retained partial output and arrival exhaustion', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  resources.route = (job) => ({ route: job.route, diagnostics: { truncated: true } });
  const solver = await prepareRouteSolver(config, { kind: 'scene', scene, resources, locomotion });
  try {
    const result = await solver.solve({ starts: [starts[0]], goal: [20, 0, 0] });
    assert.equal(result.partial, true);
    assert.equal(result.diagnostics.truncated, true);
  } finally {
    await solver.close();
  }
});

test('the fixed scene policy reaches every physical resource request', async () => {
  const { starts, resources, scene, config, locomotion } = fixture();
  const solve = resources.solve;
  resources.solve = async (job, request, start, work) => {
    assert.equal(request.solverConfig?.algorithm, 'ganglia-v1');
    assert.equal(request.solverConfig?.maxCandidates, 17);
    return solve(job, request, start, work);
  };
  const policy = { ...config, maxCandidates: 17 };
  const solver = await prepareRouteSolver(policy, { kind: 'scene', scene, resources, locomotion });
  policy.maxCandidates = 0;
  try {
    const result = await solver.solve({ starts, goal: [20, 0, 0] });
    assert.equal(result.route.status, 'complete');
    assert.equal(result.partial, false);
    assert.equal(result.route.start, 'open');
  } finally {
    await solver.close();
  }
});
