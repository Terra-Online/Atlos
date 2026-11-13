import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { Corridor, WindowRequest } from '@opendfieldmap/ganglia/solver';

import { prepareSceneResources, type GameAdapter } from '#@/bench/adapters/ganglia-v1/scene.ts';
import { prepareCoverage, type CoveragePass } from '#@/bench/prepare-coverage.ts';
import { exportPhysicalRegion } from '#@/bench/prepare-region.ts';
import { loadSceneData } from '#@/bench/scene-data.ts';

const source = { buildGuid: 'build', contentHash: 'content' };
const profile = { radius: 0.35, height: 1.8 };
const bounds = { min: [0, 0], max: [96, 64] };
const tiles = [
  { x: 0, z: 0 },
  { x: 1, z: 0 },
  { x: 2, z: 0 },
];
const fixture = async (physicalBounds = bounds, physicalTiles = tiles) => {
  const root = await mkdtemp(join(tmpdir(), 'ganglia-scene-'));
  const json = async (file: string, value: unknown) => {
    await mkdir(join(root, file, '..'), { recursive: true });
    await writeFile(join(root, file), JSON.stringify(value));
  };
  const snapshot = { scene: 'testscene', source, selection: { area: 0, sceneState: 0 } };
  const ground = (selected = physicalTiles) => ({
    ...snapshot,
    surfaces: [],
    options: { profile, speed: 5, maxVertical: 0.5 },
    build: { bounds: physicalBounds, cellSize: 0.15, tileCells: 256 },
    tiles: selected,
  });
  await json('routing/testscene-ground-all.json', ground());
  await json('routing/movement-settings-current.json', {
    source,
    defaultProfile: profile,
    sustainedSprint: { speed: 5 },
  });
  const region = async (
    prefix: string,
    selected = physicalTiles,
    regionBounds = physicalBounds,
  ) => {
    const value = ground(selected);
    await json(`${prefix}.ground.json`, {
      ...value,
      build: { ...value.build, bounds: regionBounds },
    });
    await json(`${prefix}.collision.json`, {
      ...snapshot,
      options: { profile, bounds: regionBounds, tiles: selected },
    });
  };
  return { root, json, region, ground, snapshot };
};
const approach = (
  selected = tiles,
): { startBuild: boolean; margin: number; corridor: Corridor } => ({
  startBuild: true,
  margin: 24,
  corridor: {
    kind: 'corridor-proposal',
    bounds: { min: [1, 1], max: [90, 30] },
    tiles: selected,
    coarse: { regions: 1, edges: 0, path: [], halo: 0 },
  },
});
const request: WindowRequest & { source: typeof source } = {
  scene: 'testscene',
  source,
  arrival: { id: 'start', state: 'available', position: [1, 0, 1], cost: 0 },
  target: [90, 0, 30],
  walls: [],
};

test('scene regions reject tile holes, bind each job independently and solve freshly from preloaded data', async () => {
  const f = await fixture();
  try {
    await f.region('scene-testscene/regions/a-sparse', [tiles[0], tiles[2]]);
    await f.region('scene-testscene/regions/b-full');
    const data = await loadSceneData(f.root, 'testscene');
    let preparations = 0,
      solves = 0;
    const generations: string[] = [];
    const prepare: GameAdapter['preparePhysicalRoute'] = async (files, _request, { cache }) => {
      preparations++;
      const lane = cache as {
        begin(files: unknown): Promise<string>;
        read(slot: string, path: string): Promise<unknown>;
      };
      generations.push(await lane.begin(files));
      assert.equal(await lane.read('ground', files.ground), data.inputs.get(files.ground));
      return {
        solve: async () => {
          solves++;
          return {
            route: {
              status: 'complete',
              start: 'start',
              arrivalCost: 0,
              cost: solves,
              length: 1,
              points: [
                [1, 0, 1],
                [90, 0, 30],
              ],
              segments: [],
            },
            reason: `fresh-${solves}`,
          };
        },
      };
    };
    const { resources, verifyInputs } = prepareSceneResources(data, prepare, 1, 'adapter');
    // Neither queries nor adapter reads may fall back to the filesystem after setup.
    await rm(f.root, { recursive: true, force: true });
    const sparse = await resources.query(
      'testscene',
      source,
      [1, 0, 1],
      request.target,
      approach([tiles[0]]),
    );
    const full = await resources.query('testscene', source, [1, 0, 1], request.target, approach());
    assert.ok(sparse && full);
    assert.match(resources.key(sparse), /a-sparse/);
    assert.match(resources.key(full), /b-full/);
    assert.notEqual(resources.physicalRevision?.(sparse), resources.physicalRevision?.(full));
    assert.equal(await resources.ground(sparse), data.regions[0].ground);
    assert.equal(await resources.ground(full), data.regions[1].ground);
    const first = await resources.solve(sparse, request, true, { version: 1, step: 2 });
    await resources.solve(full, request, true, { version: 1, step: 2 });
    const repeated = await resources.solve(sparse, request, true, { version: 1, step: 2 });
    assert.ok(first && repeated);
    assert.equal(preparations, 3);
    assert.equal(solves, 3);
    assert.notEqual(resources.route(first).reason, resources.route(repeated).reason);
    assert.equal(generations[0], generations[2]);
    assert.notEqual(generations[0], generations[1]);
    verifyInputs();
    await assert.rejects(
      resources.query('testscene', source, [1, 0, 1], request.target, approach([{ x: 1, z: 1 }])),
      /Missing physical coverage/,
    );
    assert.throws(verifyInputs, /Missing physical coverage/);
    await resources.close?.();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('legacy single-window files retain coverage and reject rounded bounds outside the dataset', async () => {
  const f = await fixture();
  try {
    await f.json('scene-testscene/ground.json', f.ground());
    await f.json('scene-testscene/collision.json', { ...f.snapshot, options: { profile, bounds } });
    const data = await loadSceneData(f.root, 'testscene');
    assert.equal(data.regions.length, 1);
    assert.ok(data.select([1, 0, 1], request.target, approach()));
    const outside = approach();
    outside.corridor.bounds.max[0] = 97;
    assert.equal(data.select([1, 0, 1], request.target, outside), undefined);
    await f.json('scene-testscene/collision.json', {
      ...f.snapshot,
      source: { ...source, contentHash: 'other' },
      options: { profile, bounds },
    });
    await assert.rejects(loadSceneData(f.root, 'testscene'), /snapshot mismatch/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('overlapping regions select the smallest coverage and stable filename across append order and reload', async () => {
  const f = await fixture();
  try {
    const appended = await loadSceneData(f.root, 'testscene');
    const reversed = await loadSceneData(f.root, 'testscene');
    const paths = ['a-wide', 'z-small', 'b-small'];
    await f.region(`scene-testscene/regions/${paths[0]}`, tiles, {
      min: [-32, -32],
      max: [128, 96],
    });
    await f.region(`scene-testscene/regions/${paths[1]}`);
    await f.region(`scene-testscene/regions/${paths[2]}`);
    const load = (data: typeof appended, name: string) =>
      data.loadRegion(
        join(f.root, `scene-testscene/regions/${name}.ground.json`),
        join(f.root, `scene-testscene/regions/${name}.collision.json`),
      );
    for (const name of paths) await load(appended, name);
    const selected = appended.select([1, 0, 1], request.target, approach());
    assert.ok(selected);
    assert.match(selected.files.ground, /b-small\.ground\.json$/);
    const reloaded = await loadSceneData(f.root, 'testscene');
    assert.equal(
      reloaded.select([1, 0, 1], request.target, approach())?.files.ground,
      selected.files.ground,
    );
    for (const name of [...paths].reverse()) await load(reversed, name);
    assert.equal(
      reversed.select([1, 0, 1], request.target, approach())?.files.ground,
      selected.files.ground,
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('only preparation can export missing regions, which are decoded once and reused as input snapshots', async () => {
  const bounds = { min: [-96, -64], max: [0, 0] };
  const tiles = [
    { x: -3, z: -2 },
    { x: -2, z: -2 },
    { x: -1, z: -2 },
  ];
  const f = await fixture(bounds, tiles);
  const selected = approach(tiles);
  selected.corridor.bounds = { min: [-95, -63], max: [-6, -34] };
  const start = [-95, 0, -63],
    target = [-6, 0, -34];
  try {
    const extractor = join(f.root, 'extractor');
    const config = join(f.root, 'exporter-config.json');
    const devices = join(f.root, 'routing/testscene-traversal-devices.json');
    await f.json('exporter-config.json', {});
    await f.json('routing/testscene-traversal-devices.json', {});
    const script = join(extractor, 'packages/extractor/src/cli.ts');
    await mkdir(join(script, '..'), { recursive: true });
    await writeFile(
      script,
      `
      import assert from 'node:assert/strict';
      import { writeFile } from 'node:fs/promises';
      import { parseArgs } from 'node:util';
      import { serialize } from 'node:v8';
      const { values, positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true,
        options: Object.fromEntries(['bounds','scene-state','area','static-supports','config','tiles','movement-settings','input-cache','tile-cache','output','collision-output','collision-format'].map(name=>[name,{type:'string'}]).concat([['terminal-scene',{type:'boolean'}]])) });
      assert.deepEqual(positionals, ['player-ground', 'testscene']);
      assert.equal(values['terminal-scene'], true);
      assert.equal(values['scene-state'], '0');
      assert.equal(values.area, '0');
      assert.equal(values['static-supports'], ${JSON.stringify(devices)});
      assert.equal(values.config, ${JSON.stringify(config)});
      assert.equal(values['collision-format'], 'v8');
      const tiles = values.tiles.split(';').map(tile => {
        const [x,z] = tile.split(',').map(Number); return { x,z };
      });
      assert.deepEqual(tiles, ${JSON.stringify(tiles)});
      await writeFile(values.output, JSON.stringify(${JSON.stringify(f.ground())}));
      await writeFile(values['collision-output'], serialize({
        ...${JSON.stringify({ ...f.snapshot, options: { profile, bounds, tiles } })},
        positions: Float64Array.from([-95.1234567890123, 0, -63, -6, 0, -34, -95, 0, -34]),
        indices: Uint32Array.from([0, 1, 2]),
      }));
    `,
    );
    let builds = 0;
    const data = await loadSceneData(f.root, 'testscene', async (request) => {
      builds++;
      return exportPhysicalRegion({ dataRoot: f.root, extractor, config, devices }, request);
    });
    const noBuild = { ...selected, startBuild: false };
    assert.equal(await data.query(start, target, noBuild), undefined);
    assert.equal(builds, 0);
    const region = await data.query(start, target, selected);
    assert.ok(region);
    assert.equal(data.regions.length, 1);
    assert.ok(data.hashes[region.files.ground]);
    assert.ok(data.hashes[region.files.collision]);
    const collision = data.inputs.get(region.files.collision);
    assert.ok(collision && typeof collision === 'object' && 'positions' in collision);
    assert.ok(collision.positions instanceof Float64Array);
    assert.equal(collision.positions[0], -95.1234567890123);
    assert.ok('indices' in collision && collision.indices instanceof Uint32Array);
    assert.deepEqual([...collision.indices], [0, 1, 2]);
    assert.equal(await data.query(start, target, selected), region);
    assert.equal(builds, 1);
    const reloaded = await loadSceneData(f.root, 'testscene');
    assert.ok(reloaded.select(start, target, selected));
    await rm(region.files.collision);
    assert.equal(data.inputs.get(region.files.collision), collision);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('coverage preparation re-solves earlier queries after a later query adds a preferred overlapping region', async () => {
  const f = await fixture();
  try {
    await f.region('scene-testscene/regions/z-wide', tiles, { min: [-32, -32], max: [128, 96] });
    let generated = 0;
    const data = await loadSceneData(f.root, 'testscene', async () => {
      const prefix = 'scene-testscene/regions/b-narrow';
      await f.region(prefix, [...tiles, { x: 0, z: 1 }]);
      generated++;
      return {
        ground: join(f.root, `${prefix}.ground.json`),
        collision: join(f.root, `${prefix}.collision.json`),
      };
    });
    const selections: string[] = [];
    let solves = 0;
    const { resources } = prepareSceneResources(
      data,
      async (files) => {
        selections.push(files.ground);
        return {
          solve: async () => {
            solves++;
            return {
              route: {
                status: 'complete',
                start: 'start',
                arrivalCost: 0,
                cost: files.ground.includes('z-wide') ? 10 : 1,
                length: 1,
                points: [
                  [1, 0, 1],
                  [90, 0, 30],
                ],
                segments: [],
              },
            };
          },
        };
      },
      1,
      'adapter',
    );
    const passes: CoveragePass[] = [];
    const reportedCosts: number[][] = [];
    const reports = await prepareCoverage(
      async () => {
        const results = [];
        for (const options of [approach(), approach([...tiles, { x: 0, z: 1 }])]) {
          const job = await resources.query(
            'testscene',
            source,
            request.arrival.position,
            request.target,
            options,
          );
          assert.ok(job);
          const solved = await resources.solve(job, request, true, { version: 1, step: 2 });
          assert.ok(solved);
          const route = resources.route(solved).route;
          assert.ok(route && route.status === 'complete');
          results.push({ route, connections: [], diagnostics: { truncated: false } });
        }
        reportedCosts.push(results.map((result) => result.route.cost));
        return results;
      },
      () => generated,
      (pass) => passes.push(pass),
    );
    assert.deepEqual(reportedCosts, [
      [10, 1],
      [1, 1],
    ]);
    assert.deepEqual(passes, [
      { pass: 1, newRegions: 1, generatedRegions: 1 },
      { pass: 2, newRegions: 0, generatedRegions: 1 },
    ]);
    assert.equal(solves, 4);
    assert.match(selections[0], /z-wide/);
    assert.ok(selections.slice(1).every((file) => file.includes('b-narrow')));
    assert.deepEqual(
      reports.map((result) => (result.route.status === 'complete' ? result.route.cost : null)),
      [1, 1],
    );
    await resources.close?.();
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
