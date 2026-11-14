import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Route } from '#@/src/route.ts';
import type { RouteEvent } from '#@/src/solver/contract.ts';
import { prepareRouteSolver, gangliaV1Defaults, type SceneResources } from '#@/src/solver/index.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
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
