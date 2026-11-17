import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  matchesExpectation,
  captureFirstComplete,
  expectation,
  exercised,
} from '#@/bench/mechanisms/assessment.ts';
import { scenarioInput } from '#@/bench/mechanisms/scenario.ts';
import { resourcePath, readSuite, type Case } from '#@/bench/mechanisms/suite.ts';
import { classify } from '#@/bench/outcome.ts';
import { prepareWorkerSolver } from '#@/bench/workers.ts';
import { readWorkload } from '#@/bench/workload.ts';
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

test('shared manifest remains a complete population and cannot be mistaken for plain service queries', async () => {
  const file = new URL('../bench/scenes/mechanisms/suite.json', import.meta.url);
  const suite = await readSuite(fileURLToPath(file));
  assert.equal(suite.cases.length, 266);
  assert.equal(suite.cases.filter((c) => expectation(c) === 'reject').length, 0);
  assert.ok(suite.cases.every((c) => c.query.starts.some((start) => start.state === 'available')));
  const raw = JSON.parse(await readFile(file, 'utf8'));
  raw.cases = suite.cases;
  assert.ok(
    raw.cases.every(
      (c: { target: { template?: string } }) => !/teleport|campfire/.test(c.target.template ?? ''),
    ),
  );
  for (const number of ['234-', '240-'])
    assert.equal(suite.cases.find((c) => c.id.startsWith(number))!.setup.physical, undefined);
  const controls = JSON.parse(
    await readFile(
      new URL('../bench/scenes/mechanisms/negative-controls.json', import.meta.url),
      'utf8',
    ),
  );
  const decodedControls = await readSuite(
    fileURLToPath(new URL('../bench/scenes/mechanisms/negative-controls.json', import.meta.url)),
  );
  assert.equal(decodedControls.cases.length, 7);
  assert.equal(controls.cases.length, 7);
  assert.ok(controls.cases.slice(0, 4).every((c: Case) => expectation(c) === 'reject'));
  assert.equal(controls.cases[4].knownIssue.kind, 'occupied-origin-and-target');
  assert.equal(controls.cases[5].knownIssue.kind, 'occupied-device-center');
  assert.equal(raw.revision, 12);
  const repaired = raw.cases.find((entry: Case) => entry.id === '250-0HTXfPs');
  const original = controls.cases[6];
  assert.equal(original.id, repaired.id);
  assert.deepEqual(original.query, {
    starts: [
      {
        id: 'player',
        position: [-753.6831389540318, 236.56261122226294, -1386.8426979152664],
        cost: 0,
        state: 'available',
      },
    ],
    goal: [-753.5995646927754, 236.77915376497816, -1386.749716245405],
    interaction: { radius: 0.2, maxVertical: 0.2 },
  });
  assert.equal(original.knownIssue.kind, 'occupied-steep-source-contact');
  assert.equal(original.knownIssue.allProjectedSupportsBodyBlocked, true);
  assert.equal(original.knownIssue.sourceTriangle, 628);
  assert.ok(original.knownIssue.sourceSlopeDegrees > original.knownIssue.maxSlopeDegrees);
  assert.equal(original.knownIssue.bridgeAvailability, 'unknown');
  assert.deepEqual(repaired.target, original.target);
  assert.equal(repaired.target.id, '10100030203');
  assert.equal(repaired.pointToken, original.pointToken);
  assert.equal(repaired.tokenSourceId, '10100030203');
  assert.deepEqual(repaired.assertions, original.assertions);
  assert.deepEqual(repaired.setup, original.setup);
  assert.deepEqual(repaired.query.interaction, original.query.interaction);
  assert.deepEqual(repaired.query.starts[0], {
    ...original.query.starts[0],
    position: [-750.8124754961185, 242.92857397079467, -1390.6126245598507],
  });
  assert.deepEqual(
    repaired.query.goal,
    [-754.9692209716405, 242.92857397079467, -1386.651332564841],
  );
  const revision = repaired.inputRevision;
  assert.equal(revision.revision, 11);
  assert.equal(revision.originalControl, 'negative-controls.json#250-0HTXfPs');
  assert.equal(
    revision.classification,
    'source-contact input repair, not same-input algorithm gain',
  );
  assert.equal(revision.seed, 20261115);
  assert.equal(revision.sourceActor, repaired.target.id);
  assert.equal(revision.sourceTriangle, 10);
  assert.equal(revision.targetTriangle, 189);
  assert.equal(revision.minimumSeparation, 3);
  assert.equal(revision.legalCandidates, 8);
  assert.equal(revision.pose, original.knownIssue.exportedPose);
  assert.deepEqual(revision.sourceProfile, { ...raw.sources.map02.profile, maxSlope: 46 });
  assert.equal(revision.source.file, 'exports/map02-traversal-devices.json');
  assert.match(revision.source.sha256, /^[0-9a-f]{64}$/);
  assert.match(revision.source.geometrySha256, /^[0-9a-f]{64}$/);
  for (const [triangle, rank] of [
    [revision.sourceTriangle, revision.sourceRank],
    [revision.targetTriangle, revision.targetRank],
  ])
    assert.equal(
      rank,
      createHash('sha256')
        .update(`${revision.seed}/${revision.sourceActor}/${triangle}/centroid`)
        .digest('hex'),
    );
  const separation = Math.hypot(
    ...repaired.query.goal.map((v: number, i: number) => v - repaired.query.starts[0].position[i]),
  );
  assert.equal(revision.separation, separation);
  assert.ok(separation >= revision.minimumSeparation);
  const csv = await readFile(
    new URL('../bench/scenes/mechanisms/cases.csv', import.meta.url),
    'utf8',
  );
  const row = csv
    .split('\n')
    .find((line) => line.startsWith(repaired.id + ','))!
    .split(',');
  assert.deepEqual(row.slice(10, 16).map(Number), [
    ...repaired.query.starts[0].position,
    ...repaired.query.goal,
  ]);
  assert.equal(Number(row[16]), separation);
  await assert.rejects(readWorkload(fileURLToPath(file)), /Scenario manifests/);
  assert.equal(raw.scenarios[0].cases[0].query.goal[0], suite.cases[0].query.goal[0]);
});

test('scenario training references must name cases in the same scenario', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-suite-'));
  try {
    const raw = JSON.parse(
      await readFile(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url), 'utf8'),
    );
    raw.scenarios[0].training = [raw.scenarios[1].cases[0].id];
    const file = join(directory, 'suite.json');
    await writeFile(file, JSON.stringify(raw));
    await assert.rejects(readSuite(file), /training references/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('explicit expectations drive scoring and malformed arrival states fail during parsing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-suite-'));
  try {
    const file = join(directory, 'suite.json');
    const raw = JSON.parse(
      await readFile(new URL('../bench/scenes/mechanisms/suite.json', import.meta.url), 'utf8'),
    );
    const scenario = raw.scenarios[0];
    const testCase = scenario.cases[0];
    raw.scenarios = [{ ...scenario, training: [testCase.id], cases: [testCase] }];
    testCase.expect = { kind: 'reject', assertions: [] };
    await writeFile(file, JSON.stringify(raw));
    const [decoded] = (await readSuite(file)).cases;
    assert.equal(expectation(decoded), 'reject');
    assert.equal(matchesExpectation(decoded, unavailable), true);

    testCase.query.starts[0].state = ['available'];
    await writeFile(file, JSON.stringify(raw));
    await assert.rejects(readSuite(file), /Invalid mechanism test case/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

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
test('service mechanism audit preserves input bindings and leaves queries unrun', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ganglia-service-audit-'));
  const output = join(directory, 'report.json');
  const suiteFile = new URL('../bench/scenes/mechanisms/suite.json', import.meta.url);
  const bytes = await readFile(suiteFile);
  const suite = JSON.parse(bytes.toString());
  const scenario = suite.scenarios[0];
  const selected = scenario.cases[0];
  const required = new Set<string>([...scenario.training, selected.id]);
  const bindingIds = scenario.cases
    .filter((item: { id: string }) => required.has(item.id))
    .map((item: { id: string }) => item.id);
  try {
    await writeFile(
      join(directory, 'input-index.json'),
      JSON.stringify({
        suiteSha256: 'eb906c8b4cb678050b4a8f2db5cf1913e841f3325bc8dffb1484777e4f884a48',
        revision: 'audit-only',
        source: suite.requiredSource,
        profiles: Object.fromEntries(
          Object.entries(suite.sources).map(([scene, value]) => [
            scene,
            (value as { profile: unknown }).profile,
          ]),
        ),
        cases: Object.fromEntries(bindingIds.map((id: string) => [id, { directory: selected.id }])),
      }),
    );
    const process = spawnSync(
      globalThis.process.execPath,
      [
        fileURLToPath(new URL('../bench/mechanism-benchmark.ts', import.meta.url)),
        '--audit',
        '--adapter',
        'ganglia-v1-ts',
        '--data-root',
        directory,
        '--ids',
        selected.id,
        '--output',
        output,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(process.status, 0, process.stderr);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.adapter, 'ganglia-v1-ts');
    assert.equal(report.suiteSha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(report.selectedIds, [selected.id]);
    assert.deepEqual(report.results, []);
    assert.equal(report.inputAudit.length, 1);
    assert.deepEqual(report.preparations, []);
    assert.equal(report.sourceUnchanged, true);
    const binding = JSON.parse(await readFile(report.inputAudit[0].binding, 'utf8'));
    assert.deepEqual(binding.ids, bindingIds);
    assert.equal(binding.inputRevision, 'audit-only');
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
  c.assertions = ['no-complete-route-from-unavailable-arrival'];
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
