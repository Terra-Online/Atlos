import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  resolveQuery,
  sourceSupportWorld,
  QueryInputError,
  type QuerySource,
} from '#@/bench/mechanisms/query.ts';
import { type Case } from '#@/bench/mechanisms/suite.ts';
import { classify } from '#@/bench/outcome.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
const source = { buildGuid: 'build', contentHash: 'content' };
const profile = { radius: 0.2, height: 1.6 };
function fixture() {
  const volume = {
    position: [0, 0.3, 0] as Vec3,
    interaction: { radius: 2 },
    source: { ...source, path: 'template.json' },
    model: 'normal-trigger-probe-v1',
  };
  const placement = {
    id: 'start-device',
    position: [0, 0, 0],
    template: 'rope',
    source: 'level.json',
  };
  const item: Case = {
    id: 'fixture',
    scene: 'scene',
    group: 'rope',
    query: {
      starts: [{ id: placement.id, position: [...volume.position], cost: 7, state: 'available' }],
      goal: [3, 0.005, 0],
      interaction: { radius: 0.3 },
      waypoints: [[2, 0.005, 0]],
    },
    assertions: [],
    setup: { projectStartToPhysicalSupport: true },
    tags: ['descent'],
    evidence: [{ file: 'exports/devices.json', collection: 'ropes.pairs', index: 0 }],
  };
  const vertices: Vec3[] = [
    [1, 0.05, -3],
    [1, 0.05, 3],
    [4, 0.05, 3],
    [4, 0.05, -3],
  ];
  const input: PhysicalInput = {
    ground: {
      surfaces: [{ id: 'navigation', vertices }],
      options: { speed: 5, maxVertical: 0.5, walls: [], profile },
    },
    collision: { positions: vertices.flatMap((p) => [p[0], 0, p[2]]), indices: [0, 1, 2, 0, 2, 3] },
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
    locomotion: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 },
    devices: {
      ropes: [{ top: placement.id, bottom: 'bottom' }],
      devices: [
        {
          id: placement.id,
          kind: 'rope',
          position: [0, 0, 0],
          goal: volume,
          seeds: [],
          unitScale: true,
          resolved: true,
          speed: 1,
          overhead: 0,
          duration: 0,
          fixedLaunch: false,
          aim: null,
          height: 0,
          aimClearance: 0,
          boostMultiplier: 1,
        },
      ],
    },
  };
  const placed = {
    ...placement,
    templatePath: volume.source.path,
    rules: { source: volume.source },
    navigationGoal: volume,
    navigationUnresolved: [],
  };
  const catalog = {
    scene: item.scene,
    source,
    devices: [placement],
    ropes: { pairs: [{ top: placement.id, bottom: 'bottom', ascent: 'rope', descent: 'drop' }] },
  };
  const binding: QuerySource = {
    file: '/fixture/interactions.json',
    source,
    profile,
    catalog,
    document: { scene: item.scene, source, points: [placed] },
  };
  const snapshot = async () => ({
    input,
    world: createPhysicalWorld(input, 'complete'),
    revision: 'frozen-revision',
    source,
    files: { ground: 'fixture-ground', collision: 'fixture-collision' },
    reuse: 'fixture',
  });
  return { item, input, binding, volume, placed, snapshot };
}
test('source-start resolution binds by start id and preserves the frozen query contract', async () => {
  const { item, input, binding, snapshot } = fixture();
  const original = structuredClone(item.query);
  const resolved = await resolveQuery(item, binding, snapshot);
  assert.equal(resolved.receipt.status, 'resolved');
  assert.equal(resolved.receipt.starts[0].direction, 'descent');
  const start = resolved.query.starts[0];
  assert.equal(start.id, original.starts[0].id);
  assert.equal(start.cost, 7);
  assert.equal(start.state, 'available');
  assert.deepEqual(start.position, [1, 0.005, 0]);
  assert.deepEqual({ ...resolved.query, starts: original.starts }, original);
  assert.deepEqual(item.query, original);
  assert.deepEqual(input.ground.options.profile, profile);
  assert.equal(resolved.receipt.starts[0].snapshot?.revision, 'frozen-revision');
});
test('a legal original foot is retained and an unrequested repair does no preflight work', async () => {
  const { item, binding, snapshot } = fixture();
  item.query.starts[0].position = [1.5, 0.005, 0];
  const resolved = await resolveQuery(item, binding, snapshot);
  assert.equal(resolved.receipt.status, 'retained');
  assert.equal(resolved.query.starts[0], item.query.starts[0]);
  item.setup.projectStartToPhysicalSupport = undefined;
  const unrequested = await resolveQuery(item, { ...binding, document: null }, async () => {
    throw new Error('No snapshot may be prepared without the explicit setup flag');
  });
  assert.equal(unrequested.query, item.query);
  assert.equal(unrequested.receipt.status, 'not-requested');
});
test('source provenance and normalized device conflicts remain input errors', async () => {
  const { item, input, binding, placed, snapshot } = fixture();
  placed.navigationGoal.source.path = 'wrong-template.json';
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-invalid',
  );
  placed.navigationGoal.source.path = 'template.json';
  input.devices!.devices[0].goal = { position: [9, 0, 0], interaction: { radius: 2 } };
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-invalid',
  );
});
test('missing coverage differs from finite witness exhaustion and cannot authorize another floor', async () => {
  const { item, input, binding, snapshot } = fixture();
  await assert.rejects(
    resolveQuery(item, binding, async () => null),
    (error) => error instanceof QueryInputError && error.status === 'input-unavailable',
  );
  input.ground.surfaces[0].vertices = input.ground.surfaces[0].vertices.map((p) => [p[0], 1, p[2]]);
  await assert.rejects(resolveQuery(item, binding, snapshot), (error) => {
    assert.ok(error instanceof QueryInputError);
    assert.equal(error.status, 'input-unresolved');
    assert.equal(error.receipt.starts[0].witnessCount, 0);
    assert.equal(
      classify({
        route: { status: 'no-verified-route' },
        connections: [],
        diagnostics: { truncated: false },
        reason: error.status + ':' + error.message,
      }),
      'error',
    );
    return true;
  });
});
test('launch starts require their own normalized launch id and kind', async () => {
  const { item, input, binding, snapshot } = fixture();
  item.group = 'launch';
  item.tags = [];
  item.setup.requiredDevice = item.query.starts[0].id;
  input.devices!.devices[0].kind = 'launch';
  assert.equal((await resolveQuery(item, binding, snapshot)).receipt.status, 'resolved');
  item.setup.requiredDevice = 'another-device';
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-invalid',
  );
});

test('source snapshot preflight bounds support without routing or exporting', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadSceneData } = await import('#@/bench/scene-data.ts');
  const { prepareSceneResources } = await import('#@/bench/adapters/ganglia-v1/scene.ts');
  const { item, input, volume } = fixture();
  const root = await mkdtemp(join(tmpdir(), 'source-start-'));
  const bounds = { min: [-4, -4], max: [8, 4] };
  const tiles = [
    { x: -1, z: -1 },
    { x: 0, z: -1 },
    { x: -1, z: 0 },
    { x: 0, z: 0 },
  ];
  const ground = {
    scene: item.scene,
    source,
    surfaces: input.ground.surfaces,
    options: input.ground.options,
    build: { bounds, cellSize: 0.15, tileCells: 256 },
    tiles,
  };
  const json = async (path: string, value: unknown) => {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  };
  try {
    await json('routing/scene-ground-all.json', ground);
    await json('routing/movement-settings-current.json', {
      source,
      defaultProfile: profile,
      sustainedSprint: input.locomotion,
    });
    await json('scene-scene/regions/start.ground.json', ground);
    await json('scene-scene/regions/start.collision.json', {
      scene: item.scene,
      source,
      options: { bounds, profile },
      ...input.collision,
    });
    const data = await loadSceneData(root, item.scene);
    data.query = async () => {
      throw new Error('Preflight must not route, expand or export');
    };
    let normalizations = 0,
      solves = 0,
      cloneGeometry = false;
    let current = input;
    const prepared = prepareSceneResources(
      data,
      async () => {
        normalizations++;
        return {
          input: {
            ...current,
            collision: cloneGeometry
              ? {
                  positions: Array.from(current.collision.positions),
                  indices: Array.from(current.collision.indices),
                }
              : current.collision,
            ground: {
              ...current.ground,
              options: { ...current.ground.options, walls: [...current.ground.options.walls] },
            },
          },
          solve: async () => {
            solves++;
            throw new Error('Preflight must not solve');
          },
        };
      },
      1,
      'adapter-revision',
    );
    try {
      const first = await prepared.prepareSourceSnapshot(item.query, item.query.starts[0], volume);
      const second = await prepared.prepareSourceSnapshot(item.query, item.query.starts[0], volume);
      assert.ok(first && second);
      assert.notEqual(first.world, second.world);
      assert.match(second.reuse, /source-only/);
      assert.equal(first.world.covered([7, 0.005, 0], [7, 0.005, 0]), false);
      assert.ok(first.world.configured().standing([2, 0.005, 0]));
      assert.equal(solves, 0);
      assert.equal(normalizations, 2);
      current = { ...input, roundedWalls: [{ min: [1, 0, -1], max: [3, 2, 1], state: 'active' }] };
      const blocked = await prepared.prepareSourceSnapshot(
        item.query,
        item.query.starts[0],
        volume,
      );
      assert.ok(blocked);
      assert.notEqual(blocked.world, first.world);
      assert.equal(blocked.world.configured().standing([2, 0.005, 0]), null);
      current = {
        ...input,
        devices: { ...input.devices!, devices: [{ ...input.devices!.devices[0], kind: 'launch' }] },
      };
      const authority = await prepared.prepareSourceSnapshot(
        item.query,
        item.query.starts[0],
        volume,
      );
      assert.ok(authority);
      assert.equal(authority.world.input.devices?.devices[0].kind, 'launch');
      current = {
        ...input,
        ground: {
          ...input.ground,
          build: { cellHeight: 0.05 },
          options: { ...input.ground.options, maxVertical: 0.1 },
        },
      };
      const narrow = await prepared.prepareSourceSnapshot(item.query, item.query.starts[0], volume);
      assert.ok(narrow);
      assert.equal(narrow.world.input.ground.options.maxVertical, 0.1);
      assert.equal(narrow.world.configured().standing([2, 0.25, 0]), null);
      current = { ...current, ground: { ...current.ground, build: { cellHeight: 0.1 } } };
      const wider = await prepared.prepareSourceSnapshot(item.query, item.query.starts[0], volume);
      assert.ok(wider);
      assert.notEqual(wider.world, narrow.world);
      assert.ok(wider.world.configured().standing([2, 0.25, 0]));
      current = {
        ...current,
        ground: {
          ...current.ground,
          options: {
            ...current.ground.options,
            connections: [
              {
                id: 'authored',
                mode: 'rope',
                points: [
                  [1, 0.005, 0],
                  [2, 0.005, 0],
                ],
                times: [0, 1],
                state: 'open',
              },
            ],
          },
        },
      };
      const authored = await prepared.prepareSourceSnapshot(
        item.query,
        item.query.starts[0],
        volume,
      );
      assert.ok(authored);
      assert.equal(authored.world.input.ground.options.connections?.[0].id, 'authored');
      cloneGeometry = true;
      const unproven = await prepared.prepareSourceSnapshot(
        item.query,
        item.query.starts[0],
        volume,
      );
      assert.ok(unproven);
      assert.notEqual(unproven.world, first.world);
      assert.match(unproven.reuse, /source-only/);
      data.regions[0].tiles.delete('0,0');
      assert.equal(
        await prepared.prepareSourceSnapshot(item.query, item.query.starts[0], volume),
        null,
      );
      assert.equal(normalizations, 8);
    } finally {
      await prepared.resources.close?.();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('source candidates cannot bypass a blocking full-body exclusion', async () => {
  const { item, input, binding, snapshot } = fixture();
  input.ground.options.walls = [{ min: [0.5, -1, -4], max: [4.5, 3, 4], state: 'active' }];
  await assert.rejects(resolveQuery(item, binding, snapshot), (error) => {
    assert.ok(error instanceof QueryInputError);
    assert.equal(error.status, 'input-unresolved');
    assert.ok(error.receipt.starts[0].candidates?.every((candidate) => candidate.reason));
    return true;
  });
});

test('an eroded source contact can use raw support without relaxing floor or capsule exclusions', async () => {
  const { item, input, binding, volume } = fixture();
  input.ground.surfaces = [];
  input.collision.positions = [1, 0, -3, 1, 0, 3, 1.1, 0, 3, 1.1, 0, -3];
  const snapshot = async () => ({
    input,
    world: sourceSupportWorld(
      input,
      {
        bounds: { min: [-4, -4], max: [4, 4] },
        tiles: [
          { x: -1, z: -1 },
          { x: -1, z: 0 },
          { x: 0, z: -1 },
          { x: 0, z: 0 },
        ],
        tileSpan: 32,
      },
      volume,
    ),
    revision: 'raw-contact',
    source,
    files: {},
    reuse: 'bounded-source',
  });
  const resolved = await resolveQuery(item, binding, snapshot);
  assert.deepEqual(resolved.query.starts[0].position, [1, 0.005, 0]);
  assert.equal(resolved.receipt.starts[0].witnessCount, 0);
  assert.ok(resolved.receipt.starts[0].selected?.witness?.surface.startsWith('source-raw/'));
  input.ground.options.walls = [{ min: [0.5, -1, -4], max: [2, 3, 4], state: 'active' }];
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-unresolved',
  );
  input.ground.options.walls = [];
  input.collision.positions = input.collision.positions.map((v, i) => (i % 3 === 1 ? v - 1 : v));
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-unresolved',
  );
});

test('raw witness quota favors support caps while retaining valid neighbouring contact probes', async () => {
  const { item, input, binding, volume } = fixture();
  input.ground.surfaces = [];
  const positions: number[] = [],
    indices: number[] = [];
  const triangle = (points: Vec3[]) => {
    const first = positions.length / 3;
    positions.push(...points.flat());
    indices.push(first, first + 1, first + 2);
  };
  for (let i = 0; i < 40; i++) {
    const x = 0.4 + i / 1000;
    triangle([
      [x, -0.2, -3],
      [x + 0.0005, 0.3, 3],
      [x + 0.0005, 0.3, -3],
    ]);
  }
  triangle([
    [1, 0, -3],
    [1, 0, 3],
    [1.1, 0, 3],
  ]);
  triangle([
    [1, 0, -3],
    [1.1, 0, 3],
    [1.1, 0, -3],
  ]);
  input.collision = { positions, indices };
  const snapshot = async () => ({
    input,
    world: sourceSupportWorld(
      input,
      {
        bounds: { min: [-4, -4], max: [4, 4] },
        tiles: [
          { x: -1, z: -1 },
          { x: -1, z: 0 },
          { x: 0, z: -1 },
          { x: 0, z: 0 },
        ],
        tileSpan: 32,
      },
      volume,
    ),
    revision: 'support-and-probes',
    source,
    files: {},
    reuse: 'bounded-source',
  });
  const resolved = await resolveQuery(item, binding, snapshot);
  assert.deepEqual(resolved.query.starts[0].position, [1, 0.005, 0]);
  assert.equal(resolved.receipt.starts[0].rawWitnessCount, 42);
  assert.equal(resolved.receipt.starts[0].rawCandidates?.length, 32);

  // A downward face may propose an adjacent legal sphere contact. Its own
  // orientation is not authority for support, and does not disqualify the feet.
  input.collision = {
    positions: [
      1, 0.15, -3, 1, 0.15, 3, 2, 0.15, 3, 2, 0.15, -3, 0.9, 0.05, -3, 0.95, 0.05, -3, 0.95, 0.05,
      3, 0.9, 0.05, 3,
    ],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  };
  const adjacent = await resolveQuery(item, binding, snapshot);
  const selected = adjacent.receipt.starts[0].selected!;
  assert.ok(selected.witness && selected.feet);
  assert.equal(selected.witness.position[1], 0.05);
  assert.ok(selected.feet[0] < 1 && selected.feet[1] > selected.witness.position[1]);
  assert.equal(selected.reason, undefined);
});

test('malformed source direction and absent build identities remain typed input-invalid failures', async () => {
  const { item, binding, placed, snapshot } = fixture();
  Object.assign(placed.navigationGoal.interaction, { facing: [0, 0, 0], halfAngle: 90 });
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-invalid',
  );
  binding.source = {};
  binding.document = { scene: item.scene, source: {}, points: [placed] };
  await assert.rejects(
    resolveQuery(item, binding, snapshot),
    (error) => error instanceof QueryInputError && error.status === 'input-invalid',
  );
});
