import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { SceneResources, SceneTerminal, WindowJob } from '#@/src/solver/resources.ts';

const surface = (id: string, min: number, max: number, y = 0): Surface => ({
  id,
  vertices: [
    [min, y, -2],
    [max, y, -2],
    [max, y, 2],
    [min, y, 2],
  ],
});
const physical = (surfaces: Surface[]): PhysicalInput => {
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[2], v[1], v[0], v[3], v[2]]);
  return {
    ground: {
      surfaces,
      options: { speed: 4, maxVertical: 0.5, walls: [], profile: { radius: 0.2, height: 1.8 } },
    },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 20,
        maxJumpHeight: 0.5,
        maxFallingSpeed: 12,
        apexTime: 0.1,
        maxHorizontalSpeed: 2,
        startHorizontalSpeed: 2,
        airAcceleration: 30,
        airDeceleration: 30,
        airOverspeedDeceleration: 5,
      },
      maxSlope: 45,
      runAirSpeed: 2,
      stepUp: 0.1,
      stepDown: 0.3,
    },
    locomotion: { speed: 4, sprintSpeed: 4, sprintAcceleration: 10 },
  };
};
const config = {
  ...gangliaV1Defaults,
  algorithm: 'ganglia-v1-rust' as const,
  maxCandidates: 1500,
  maxShortcutCandidates: 16,
  maxLinks: 10,
  sampleSpacing: 0.5,
};
const query = (position: Vec3, goal: Vec3): RouteQuery => ({
  starts: [{ id: 'player', position, state: 'available', cost: 0.25 }],
  goal,
});
const scene = (
  input: PhysicalInput,
  navigation: Surface[],
  options: Partial<GangliaV1Config> = {},
  resources: Partial<SceneResources<null, WindowJob>> = {},
) =>
  prepareRouteSolver(
    { ...config, ...options },
    {
      kind: 'scene',
      scene: {
        scene: 'continuation',
        source: null,
        walls: [],
        navigation: { surfaces: navigation, options: { speed: 4, maxVertical: 0.5 } },
      },
      locomotion: input.locomotion!,
      resources: {
        query: async () => ({ status: 'ready' as const }),
        physical: async () => ({
          input,
          revision: 'continuation/1',
          coverage: 'complete' as const,
        }),
        solve: async () => {
          throw new Error('TypeScript solving must not run');
        },
        ground: async () => {
          throw new Error('TypeScript ground preparation must not run');
        },
        key: () => 'continuation/1',
        route: () => ({}),
        wait: async () => {},
        ...resources,
      },
    },
  );

test('Rust scene keeps the original final goal geometry instead of accepting a nearby support', async () => {
  const input = physical([surface('floor', 0, 4)]);
  const solver = await scene(input, input.ground.surfaces, {
    maxCandidates: 0,
    maxShortcutCandidates: 0,
  });
  try {
    for (const goal of [
      [4.2, 0, 0],
      [3, 2, 0],
    ] satisfies Vec3[]) {
      const result = await solver.solve(query([1, 0, 0], goal));
      assert.notEqual(
        result.route.status,
        'complete',
        'projection allowance cannot replace the original goal',
      );
    }
    const request = query([1, 0, 0], [3, 0, 0]);
    const result = await solver.solve(request);
    assert.equal(result.partial, false);
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      request,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('Rust scene carries an earlier pickup into a later window whose raw facts omit the trigger', async () => {
  const input = physical([surface('takeoff', -2, 24), surface('landing', 26, 36)]);
  input.movement.runAirSpeed = 4;
  input.devices = {
    devices: [
      {
        id: 'fast',
        kind: 'accelerate',
        position: [24, 0, 0],
        goal: { position: [24, 0, 0], interaction: { radius: 0.15 } },
        seeds: [[24, 0, 0]],
        unitScale: true,
        resolved: true,
        speed: 2,
        overhead: 0,
        duration: 6,
        fixedLaunch: false,
        aim: null,
        height: 0,
        aimClearance: 0,
        boostMultiplier: 4,
      },
    ],
    ropes: [],
  };
  // Bind a native-generated physical action so this regression isolates window
  // continuation from optional discovery coverage in the later window.
  const generator = await prepareRouteSolver(config, { kind: 'physical', input });
  try {
    const generationQuery = query([24, 0, 0], [27, 0, 0]);
    const generated = await generator.solve(generationQuery);
    assert.ok(generated.route.status === 'complete');
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      generationQuery,
      generated.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    const flight = generated.route.segments.find(
      (s) => s.flight && s.points[0][0] < 25 && s.points.at(-1)![0] > 25.5,
    );
    assert.ok(flight?.connection);
    const action = generated.connections.find((c) => c.id === flight.connection);
    assert.ok(action);
    input.ground.options.connections = [action];
  } finally {
    await generator.close();
  }
  const withoutTrigger: PhysicalInput = { ...input, devices: { devices: [], ropes: [] } };
  const continuations: {
    x: number;
    boost?: { id: string; remaining: number };
    usedBoost?: string;
  }[] = [];
  const solver = await scene(
    input,
    [surface('coarse', -2, 36)],
    {
      tileSpan: 16,
      gridSpan: 8,
      margin: 1,
      maxTiles: 4,
      maxCandidates: 0,
      maxShortcutCandidates: 0,
    },
    {
      physical: async (_job, request) => {
        const arrival = request.arrival as typeof request.arrival & {
          continuation?: { boost?: { id: string; remaining: number }; usedBoost?: string };
        };
        continuations.push({ x: arrival.position[0], ...arrival.continuation });
        const later = arrival.position[0] >= 23.5;
        return {
          input: later ? withoutTrigger : input,
          revision: later ? 'continuation/no-trigger' : 'continuation/pickup',
          coverage: 'complete' as const,
        };
      },
    },
  );
  try {
    const request = query([0, 0, 0], [32, 0, 0]);
    const result = await solver.solve(request);
    assert.equal(
      result.partial,
      false,
      JSON.stringify({
        reason: result.reason,
        status: result.route.status,
        diagnostics: result.diagnostics,
        continuations,
      }),
    );
    assert.ok(result.route.status === 'complete');
    assert.ok(
      continuations.some(
        (c) =>
          c.x >= 23.5 && c.boost?.id === 'fast' && c.boost.remaining > 0 && c.usedBoost === 'fast',
      ),
    );
    const flight = result.route.segments.find(
      (s) => s.flight && s.points[0][0] < 25 && s.points.at(-1)![0] > 25.5,
    );
    assert.equal(flight?.boost?.id, 'fast', 'the physical gap requires the carried boost');
    const evaluation = createPhysicalVerifier(() => [
      createPhysicalWorld(input, 'complete'),
      createPhysicalWorld(withoutTrigger, 'complete'),
    ])(request, result.route);
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('Rust scene tries a second native terminal after the cheaper prefix cannot cross a gap', async () => {
  const input = physical([
    surface('main', -6, 2),
    surface('target', 2.9, 3.1),
    surface('island', 4, 6),
  ]);
  input.movement.model.maxJumpHeight = 2;
  input.movement.model.maxHorizontalSpeed = 6;
  input.movement.model.startHorizontalSpeed = 6;
  input.movement.runAirSpeed = 7;
  const request: RouteQuery = {
    ...query([0.2, 0, 0], [3, 0.01, 0]),
    interaction: { airborne: true, radius: 0.05 },
  };
  const physicalSolver = await prepareRouteSolver(config, { kind: 'physical', input });
  const assets: SceneTerminal[] = [];
  try {
    for (const [id, position] of [
      ['cheaper', [4.5, 0, 0]],
      ['reachable', [-5.5, 0, 0]],
    ] as const) {
      const approach: RouteQuery = {
        ...request,
        starts: [{ id, position: [...position], state: 'available', cost: 0 }],
      };
      const result = await physicalSolver.solve(approach);
      assert.ok(result.route.status === 'complete');
      const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
        approach,
        result.route,
      );
      assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
      assets.push({ id, route: result.route });
    }
  } finally {
    await physicalSolver.close();
  }
  const estimate = (asset: (typeof assets)[number]) =>
    asset.route.cost +
    Math.hypot(...asset.route.points[0].map((v, i) => v - request.starts[0].position[i])) / 4;
  assert.ok(
    estimate(assets[0]) < estimate(assets[1]),
    'the inaccessible island terminal must rank first',
  );
  const targets: Vec3[] = [];
  const solver = await scene(
    input,
    [surface('coarse', -6, 6)],
    { maxCandidates: 0, maxShortcutCandidates: 0, maxAttempts: 2 },
    {
      terminals: async () => assets,
      query: async (_scene, _source, _start, target) => {
        targets.push([...target] as Vec3);
        return { status: 'ready' };
      },
    },
  );
  try {
    const result = await solver.solve(request);
    assert.equal(result.partial, false);
    assert.ok(targets.some((p) => p[0] > 4));
    assert.ok(
      targets.some((p) => p[0] === -5.5),
      'failed terminal prefixes must reveal other supplied approaches',
    );
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      request,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('Rust scene carries one selected following pose through prefix windows and a native terminal', async () => {
  const input = physical([surface('floor', -2, 6), surface('upper', 3.5, 5, 0.8)]);
  input.movement.model.maxHorizontalSpeed = 3;
  input.movement.model.startHorizontalSpeed = 3;
  input.movement.runAirSpeed = 3;
  input.devices = {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'box',
        level: 'test',
        model: 'box',
        spawn: [0, 0, 0],
        bodies: [
          Array.from({ length: 8 }, (_, bits): Vec3 => [
            bits & 1 ? 0.5 : -0.5,
            bits & 2 ? 0.4 : 0,
            bits & 4 ? 0.5 : -0.5,
          ]),
        ],
        geometryKind: 'box',
        maxDistance: 4.5,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  };
  const request: RouteQuery = {
    ...query([-1, 0, 0], [4, 0.8, 0]),
    interaction: { airborne: true, radius: 0.015 },
  };
  const physicalSolver = await prepareRouteSolver(config, { kind: 'physical', input });
  let terminalStart: Vec3;
  let placements: { device: string; position: Vec3 }[];
  try {
    const result = await physicalSolver.solve(request);
    assert.ok(result.route.status === 'complete');
    assert.ok(result.route.placements?.length);
    placements = result.route.placements;
    const ontoBox = result.route.segments.find(
      (s) => s.flight && Math.abs(s.points.at(-1)![1] - 0.41) < 1e-6,
    );
    assert.ok(ontoBox, 'the native route must use the selected roof');
    terminalStart = ontoBox.points.at(-1)!;
  } finally {
    await physicalSolver.close();
  }
  // Bind the Rust-selected pose as raw preparation metadata, then ask Rust for
  // the terminal flight from that roof. No flight controls are manufactured here.
  const bound = { kind: 'physical' as const, input, placements };
  const fixedConfig = { ...config, fixedPlacements: placements };
  const terminalSolver = await prepareRouteSolver(fixedConfig, bound);
  let terminal: SceneTerminal['route'];
  try {
    const approach: RouteQuery = {
      ...request,
      starts: [{ id: 'roof', position: terminalStart, state: 'available', cost: 0 }],
    };
    const result = await terminalSolver.solve(approach);
    assert.ok(result.route.status === 'complete');
    terminal = { ...result.route, placements };
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      approach,
      terminal,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await terminalSolver.close();
  }
  const starts: Vec3[] = [];
  let omittedFacts = false;
  const solver = await scene(
    input,
    [surface('coarse', -2, 6)],
    { tileSpan: 2, gridSpan: 1, margin: 0.1, maxTiles: 4, maxAttempts: 1 },
    {
      terminals: async () => [{ id: 'roof-terminal', route: terminal }],
      physical: async (_job, request) => {
        const later = request.arrival.position[0] > -0.5;
        omittedFacts ||= later;
        return {
          input: later ? { ...input, devices: { devices: [], ropes: [] } } : input,
          revision: later ? 'following/omitted' : 'following/facts',
          coverage: 'complete' as const,
        };
      },
      query: async (_scene, _source, start) => {
        starts.push([...start] as Vec3);
        return { status: 'ready' };
      },
    },
  );
  try {
    const result = await solver.solve(request);
    assert.equal(result.partial, false);
    assert.ok(result.route.status === 'complete');
    assert.equal(
      omittedFacts,
      true,
      'later physical windows must omit the earlier device metadata',
    );
    assert.deepEqual(
      result.route.placements,
      placements,
      'identical fixed poses must occur once in the composed route',
    );
    assert.ok(
      starts.some((p) => p[0] > -0.5 && p[0] < terminalStart[0]),
      'the prefix must cross a physical window boundary',
    );
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      request,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});
