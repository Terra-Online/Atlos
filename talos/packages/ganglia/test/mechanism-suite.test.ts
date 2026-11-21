import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  matchesExpectation,
  captureFirstComplete,
  exercised,
} from '#@/bench/mechanisms/assessment.ts';
import { scenarioInput } from '#@/bench/mechanisms/scenario.ts';
import { readSuite, resourcePath, type Case } from '#@/bench/mechanisms/suite.ts';
import { classify } from '#@/bench/outcome.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput, FollowingSupport } from '#@/src/solver/physical.ts';

const item = (): Case => ({
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

test('diagnostic audit records its cooperative deadline and solver output scoring without solving', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-mechanism-audit-'));
  const output = join(directory, 'report.json');
  const suite = await readSuite(
    fileURLToPath(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url)),
  );
  try {
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL('../bench/mechanism-run.ts', import.meta.url)),
        '--mode',
        'physical-diagnostic',
        '--audit',
        '--exports',
        directory,
        '--retained',
        directory,
        '--ids',
        suite.cases[0].id,
        '--output',
        output,
      ],
      { env: { ...process.env, GANGLIA_BENCHMARK_QUERY_CUTOFF_MS: '60000' }, stdio: 'pipe' },
    );
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.queryCutoffMs, 60000);
    assert.equal(report.cancellation, 'cooperative-checkpoints');
    assert.equal(report.deadlineScope, 'dispatch-through-solver');
    assert.equal(report.acceptance, 'solver complete route, excluding partial approaches');
    assert.equal('verification' in report, false);
    assert.deepEqual(report.results, []);
    assert.match(report.inputAudit[0].errors.join('; '), /Missing/);
    assert.equal(report.invalid, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
test('service benchmark reports all selected scenario binding errors before starting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-service-bindings-'));
  const output = join(directory, 'report.json');
  const suite = join(directory, 'suite.json');
  const source = { buildGuid: 'test', contentHash: 'test' };
  const profile = { radius: 0.3, height: 1.6 };
  const scenarios = ['valid', 'split', 'missing'].map((id) => ({
    id,
    setup: { scene: id, input: { kind: 'dynamic' } },
    training: [`${id}-training`],
    cases: ['query', 'training'].map((kind) => ({
      id: `${id}-${kind}`,
      query: item().query,
      expect: { kind: 'complete', assertions: [] },
    })),
  }));
  try {
    await writeFile(
      suite,
      JSON.stringify({
        id: 'bindings',
        requiredSource: source,
        sources: Object.fromEntries(
          scenarios.map(({ id }) => [
            id,
            {
              source,
              profile,
              locomotion: { speed: 5, sprintSpeed: 7, sprintAcceleration: 60 },
              regions: {},
            },
          ]),
        ),
        scenarios,
      }),
    );
    await writeFile(
      join(directory, 'input-index.json'),
      JSON.stringify({
        inputs: {
          valid: { directory: 'scenarios/valid' },
          split: { directory: 'scenarios/split' },
        },
      }),
    );
    await mkdir(join(directory, 'scenarios/valid'), { recursive: true });
    for (const file of ['physical.json', 'ground.bin', 'collision.bin'])
      await writeFile(join(directory, 'scenarios/valid', file), '');
    await mkdir(join(directory, 'routing'));
    await writeFile(join(directory, 'routing/valid-ground-all.json'), '');
    await writeFile(join(directory, 'routing/movement-settings-current.json'), '');
    await writeFile(join(directory, 'routing/valid-traversal-devices.json'), '');
    const process = spawnSync(
      globalThis.process.execPath,
      [
        fileURLToPath(new URL('../bench/mechanism-benchmark.ts', import.meta.url)),
        '--adapter',
        'ganglia-v1-ts',
        '--suite',
        suite,
        '--data-root',
        directory,
        '--ids',
        'valid-query,split-query,missing-query',
        '--output',
        output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(process.status, 1, process.stderr);
    assert.match(process.stderr, /split:.*missing dataset input.*scenarios\/split/);
    assert.match(process.stderr, /missing:.*missing physical pack registration/);
    assert.deepEqual((await readdir(directory)).sort(), [
      'input-index.json',
      'routing',
      'scenarios',
      'suite.json',
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  c.expected = 'reject';
  assert.equal(classify(unavailable), 'no-route');
  assert.equal(matchesExpectation(c, unavailable), true);
  assert.equal(matchesExpectation(c, { ...unavailable, reason: 'timeout' }), false);
  assert.equal(matchesExpectation(c, { ...unavailable, partial: true }), false);
  for (const [reason, status] of [
    ['timeout', 'timeout'],
    ['aborted', 'error'],
    ['input-unavailable:missing', 'error'],
    ['unsupported-setup:x', 'error'],
  ] as const)
    assert.equal(classify({ ...unavailable, reason }), status);
  assert.equal(classify({ ...unavailable, partial: true }), 'no-route');
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
  assert.equal(classify(invalid), 'success');
  assert.equal(matchesExpectation(c, invalid), false);
  c.assertions = [];
  assert.equal(classify(invalid), 'success');
  assert.equal(classify({ ...invalid, partial: true }), 'no-route');
  assert.equal(classify({ ...invalid, reason: 'timeout' }), 'timeout');
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
test('indexed native device actions count without a top-level connection catalog', () => {
  const c = item();
  c.setup.requiredDevice = 'pad';
  c.assertions = ['exercise:launch'];
  const result: RouteResult = {
    ...unavailable,
    route: {
      status: 'complete',
      start: 'player',
      arrivalCost: 0,
      cost: 1,
      length: 3,
      points: [
        [0, 0, 0],
        [3, 0, 0],
      ],
      segments: [
        {
          mode: 'launch',
          connection: 'launch/pad/18',
          points: [
            [0, 0, 0],
            [3, 0, 0],
          ],
          times: [0, 1],
        },
      ],
    },
  };
  assert.deepEqual(result.connections, []);
  assert.equal(exercised(c, result)[0].status, 'exercised');
  if (result.route.status !== 'complete') return;
  const segment = result.route.segments[0];
  for (const connection of ['launch/pad', 'launch/pad/47']) {
    segment.connection = connection;
    assert.equal(exercised(c, result)[0].status, 'exercised');
  }
  for (const connection of ['launch/padding/18', 'launch/other/18', undefined]) {
    segment.connection = connection;
    assert.equal(exercised(c, result)[0].status, 'not-exercised');
  }
});
test('diagnostic bootstrap is separate from the cooperative query deadline and forwards memory progress', async () => {
  const events: unknown[] = [];
  const prepared = await prepareWorkerSolver({
    count: 1,
    config: gangliaV1Defaults,
    dataRoot: 'slow-start',
    extractor: '',
    timeoutMs: 50,
    entry: new URL('./fixtures/scene-worker.ts', import.meta.url),
    onEvent(query, event, memory, detail) {
      events.push({ query, event, memory, detail });
    },
  });
  try {
    assert.ok(prepared.timings.workerStartupMs >= 80);
    const query: RouteQuery = {
      starts: [{ id: 'ready', state: 'available', position: [0, 0, 0], cost: 0 }],
      goal: [1, 0, 0],
    };
    const result = await prepared.solver.solve(query);
    assert.equal(result.route.status, 'complete');
    assert.equal(events.length, 1);
    assert.ok(prepared.metadata.execution.memory.processRssSampledPeakBytes > 0);
    const event = events[0] as { query: unknown; memory: { rssBytes: number }; detail: string };
    assert.deepEqual(event.query, query);
    assert.ok(event.memory.rssBytes > 0);
    assert.equal(event.detail, 'fixture-search');
  } finally {
    await prepared.solver.close();
  }
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

test('first complete candidate survives later cancellation without changing timeout status', async () => {
  const captured: RouteResult[] = [];
  const capture = captureFirstComplete((event) => captured.push(structuredClone(event.result)));
  const prepared = await prepareWorkerSolver({
    count: 1,
    config: gangliaV1Defaults,
    dataRoot: 'first-complete-test',
    extractor: '',
    timeoutMs: 100,
    entry: new URL('./fixtures/scene-worker.ts', import.meta.url),
    onEvent(_query, event) {
      capture(event);
    },
  });
  try {
    const result = await prepared.solver.solve({
      starts: [{ id: 'player', state: 'available', position: [0, 0, 0], cost: 0 }],
      goal: [1000, 0, 0],
    });
    assert.equal(classify(result), 'timeout');
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].partial, false);
    assert.equal(captured[0].route.status, 'complete');
    if (captured[0].route.status === 'complete')
      assert.deepEqual(captured[0].route.segments[0].times, [0, 1]);
    assert.ok('cancellationMs' in result.diagnostics);
  } finally {
    await prepared.solver.close();
  }
});
