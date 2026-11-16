import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGroundTiles, type BuildOptions, type TileCache } from '#@/src/build.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { projectPoint, surfaceGraph } from '#@/src/v1/geo/surfaces.ts';
import { planGroundRoute } from '#@/src/v1/route/ground.ts';

type TileProgress = Parameters<NonNullable<Parameters<typeof buildGroundTiles>[1]['onTile']>>[0];

const options: Parameters<typeof buildGroundTiles>[1] = {
  profile: { radius: 0.35, height: 1.66 },
  maxSlope: 46,
  stepUp: 0.4,
  stepDown: 0.6,
  cellSize: 0.1,
  cellHeight: 0.05,
  tileCells: 80,
  bounds: { min: [0, 0], max: [16, 8] },
};
const quad = (x0: number, x1: number, z0: number, z1: number, y0: number, y1 = y0): Vec3[] => [
  [x0, y0, z0],
  [x0, y0, z1],
  [x1, y1, z1],
  [x0, y0, z0],
  [x1, y1, z1],
  [x1, y1, z0],
];
const geometry = (vertices: Vec3[]) => ({
  positions: vertices.flat(),
  indices: vertices.map((_, index) => index),
});
const plan = (
  data: Pick<Awaited<ReturnType<typeof buildGroundTiles>>, 'surfaces' | 'portals'>,
  start: Vec3,
  goal: Vec3,
) =>
  planGroundRoute(
    data.surfaces,
    [{ id: 'player', position: start, cost: 0, state: 'available' }],
    goal,
    { profile: options.profile, walls: [], speed: 5, maxVertical: 0.15, portals: data.portals },
  );

test('padded tiles retain continuous ground and detail heights across core seams', async () => {
  const data = await buildGroundTiles(geometry(quad(-2, 18, -2, 10, -0.7, 1.3)), options);
  assert.equal(data.tiles.length, 2);
  assert.ok(data.tiles.every((tile) => tile.surfaces > 0));
  assert.ok(data.portals.length > 0);
  assert.equal(new Set(data.surfaces.map((surface) => surface.id)).size, data.surfaces.length);
  for (const surface of data.surfaces) {
    const tile = data.tiles.find((tile) => surface.id.startsWith(`${tile.x},${tile.z}/`));
    assert.ok(
      surface.vertices.every(
        (point) =>
          point[0] >= tile!.bounds.min[0] &&
          point[0] <= tile!.bounds.max[0] &&
          point[2] >= tile!.bounds.min[1] &&
          point[2] <= tile!.bounds.max[1],
      ),
    );
  }
  for (const z of [1, 4, 7]) {
    const route = plan(data, [1, -0.4, z], [15, 1, z]);
    assert.ok(route.status === 'complete');
    assert.ok(route.points.every((point) => Math.abs(point[1] - (-0.5 + point[0] * 0.1)) < 0.15));
  }
});

test('height-separated builds preserve horizontal tile seams without joining floors', async () => {
  const data = await buildGroundTiles(
    geometry([...quad(-2, 18, -2, 10, -200), ...quad(-2, 18, -2, 10, 300)]),
    options,
  );
  for (const y of [-200, 300]) {
    assert.equal(plan(data, [2, y, 4], [14, y, 4]).status, 'complete');
  }
  assert.equal(plan(data, [2, -200, 4], [14, 300, 4]).status, 'no-verified-route');
  assert.doesNotThrow(() => surfaceGraph(data.surfaces, { speed: 5, portals: data.portals }));
  assert.equal(new Set(data.surfaces.map((surface) => surface.id)).size, data.surfaces.length);
});

test('large negative Float32 coordinates retain exact core planes on sloping detail triangles', async () => {
  const vertices: Vec3[] = [];
  const point = (x: number, z: number): Vec3 => [
    x,
    160 + 0.05 * (x + 806.4) + 0.08 * Math.sin(z * 5),
    z,
  ];
  for (let i = 0; i < 80; i++) {
    for (let j = 0; j < 50; j++) {
      const x = -814 + i * 0.2,
        z = -8 + j * 0.2;
      vertices.push(
        point(x, z),
        point(x, z + 0.2),
        point(x + 0.2, z + 0.2),
        point(x, z),
        point(x + 0.2, z + 0.2),
        point(x + 0.2, z),
      );
    }
  }
  const data = await buildGroundTiles(geometry(vertices), {
    ...options,
    tileCells: 64,
    bounds: { min: [-812.8, -6.4], max: [-800, 0] },
  });
  assert.ok(data.portals.length > 0);
  assert.doesNotThrow(() => surfaceGraph(data.surfaces, { speed: 5, portals: data.portals }));
  for (const surface of data.surfaces) {
    const tile = data.tiles.find((tile) => surface.id.startsWith(`${tile.x},${tile.z}/`));
    for (const vertex of surface.vertices) {
      for (let axis = 0; axis < 2; axis++) {
        for (const boundary of [tile!.bounds.min[axis], tile!.bounds.max[axis]]) {
          const coordinate = vertex[axis === 0 ? 0 : 2];
          if (Math.abs(coordinate - boundary) <= 1e-4) assert.equal(coordinate, boundary);
        }
      }
    }
  }
});

test('an obstacle spanning a tile boundary remains impassable', async () => {
  const data = await buildGroundTiles(
    geometry([...quad(-2, 18, -2, 10, 0), ...quad(7, 9, -2, 10, 1.4)]),
    options,
  );
  assert.ok(projectPoint(data.surfaces, [2, 0, 4], { maxVertical: 0.15 }));
  assert.ok(projectPoint(data.surfaces, [14, 0, 4], { maxVertical: 0.15 }));
  assert.equal(plan(data, [2, 0, 4], [14, 0, 4]).status, 'no-verified-route');
});

test('a hole at the shared boundary and excessive floor separation receive no bridge', async () => {
  for (const vertices of [
    [...quad(-2, 7, -2, 10, 0), ...quad(9, 18, -2, 10, 0)],
    [...quad(-2, 8, -2, 10, 0), ...quad(8, 18, -2, 10, 1)],
  ]) {
    const data = await buildGroundTiles(geometry(vertices), options);
    const goalY = vertices.at(-1)![1];
    assert.equal(plan(data, [2, 0, 4], [14, goalY, 4]).status, 'no-verified-route');
    assert.equal(data.portals.length, 0);
  }
});

test('global tile coordinates support negative bounds and report empty tiles', async () => {
  const data = await buildGroundTiles(geometry(quad(-7, -1, -7, -1, 0)), {
    ...options,
    bounds: { min: [-8, -8], max: [16, 8] },
  });
  assert.equal(data.tiles.length, 6);
  assert.ok(data.tiles.some((tile) => tile.x === -1 && tile.z === -1 && tile.surfaces > 0));
  assert.ok(data.tiles.some((tile) => tile.x === 1 && tile.z === 0 && tile.surfaces === 0));
  const empty = await buildGroundTiles(geometry([]), options);
  assert.deepEqual(empty.surfaces, []);
  assert.deepEqual(empty.portals, []);
  assert.ok(empty.tiles.every((tile) => tile.surfaces === 0));
  const outside = geometry(quad(1000, 1010, 1000, 1010, 100000));
  const distant = await buildGroundTiles(outside, options);
  assert.deepEqual(distant, empty);
  outside.positions[0] = NaN;
  await assert.rejects(buildGroundTiles(outside, options), /Non-finite collision vertex/);
  const decimal = await buildGroundTiles(geometry(quad(-2, 2, -2, 2, 0)), {
    ...options,
    tileCells: 3,
    bounds: { min: [0.3, -0.3], max: [0.9, 0.3] },
  });
  assert.deepEqual(
    decimal.tiles.map((tile) => [tile.x, tile.z]),
    [
      [1, -1],
      [2, -1],
      [1, 0],
      [2, 0],
    ],
  );
});

test('invalid bounds, tile budgets and failed tile builds reject the whole result', async () => {
  const floor = geometry(quad(-2, 18, -2, 10, 0));
  for (const bounds of [undefined, { min: [0, 0], max: [0, 8] }, { min: [NaN, 0], max: [16, 8] }]) {
    await assert.rejects(
      buildGroundTiles(floor, { ...options, bounds } as unknown as Parameters<
        typeof buildGroundTiles
      >[1]),
      /bounds/,
    );
  }
  await assert.rejects(buildGroundTiles(floor, { ...options, tileCells: 0 }), /tile cell/);
  await assert.rejects(buildGroundTiles(floor, { ...options, tileCells: 1 }), /512 tile/);
  await assert.rejects(
    buildGroundTiles(
      geometry([...quad(-2, 18, -2, 10, 0), ...quad(-2, 18, -2, 10, 1e12)]),
      options,
    ),
    /Ground tile \(0, 0\) build failed:.*voxel limits/,
  );
});

test('completed empty polygon meshes are reported empty without concealing a failed tile', async () => {
  const downward = quad(-2, 18, -2, 10, 0);
  for (let i = 0; i < downward.length; i += 3)
    [downward[i], downward[i + 1]] = [downward[i + 1], downward[i]];
  for (const vertices of [
    downward,
    [
      [8, 0, -2],
      [8, 0, 10],
      [8, 4, 10],
      [8, 0, -2],
      [8, 4, 10],
      [8, 4, -2],
    ],
    quad(7.9, 8.1, -2, 10, 0),
  ] satisfies Vec3[][]) {
    const data = await buildGroundTiles(geometry(vertices), options);
    assert.deepEqual(data.surfaces, []);
    assert.deepEqual(data.portals, []);
    assert.ok(data.tiles.every((tile) => tile.surfaces === 0));
  }
});

test('builds sparse corridor tiles without granting access through unselected ground', async () => {
  const source = geometry(quad(-2, 34, -2, 10, 0));
  const selected = [
      { x: 3, z: 0 },
      { x: 1, z: 0 },
      { x: 0, z: 0 },
    ],
    before = structuredClone(selected),
    progress: TileProgress[] = [];
  const settings: Parameters<typeof buildGroundTiles>[1] = {
    ...options,
    bounds: { min: [0, 0], max: [32, 8] },
    tiles: selected,
    onTile: (value) => progress.push(value),
  };
  const data = await buildGroundTiles(source, settings);
  assert.deepEqual(selected, before);
  assert.deepEqual(
    data.tiles.map((tile) => tile.x),
    [0, 1, 3],
  );
  assert.equal(progress.at(-1)!.completed, 3);
  assert.equal(plan(data, [2, 0, 4], [14, 0, 4]).status, 'complete');
  assert.notEqual(plan(data, [2, 0, 4], [26, 0, 4]).status, 'complete');
  assert.equal(projectPoint(data.surfaces, [20, 0, 4], { maxVertical: 0.15 }), null);
  await assert.rejects(
    buildGroundTiles(source, {
      ...settings,
      tiles: [
        { x: 0, z: 0 },
        { x: 0, z: 0 },
      ],
    }),
    /selection/,
  );
  await assert.rejects(
    buildGroundTiles(source, { ...settings, tiles: [{ x: -1, z: 0 }] }),
    /selection/,
  );
});

test('reuses padded meshes across differently clipped regions while rebuilding seams', async () => {
  const source = geometry(quad(-2, 18, -2, 10, 0)),
    records = new Map<string, Surface[]>(),
    progress: TileProgress[] = [];
  const key = (geometry: unknown, options: unknown) => JSON.stringify([geometry, options]);
  const cache: TileCache = {
    async load(geometry, options) {
      return structuredClone(records.get(key(geometry, options)) ?? null);
    },
    async save(geometry, options, surfaces: Surface[]) {
      records.set(key(geometry, options), structuredClone(surfaces));
    },
  };
  const initial = await buildGroundTiles(source, { ...options, cache });
  const bounds: NonNullable<BuildOptions['bounds']> = { min: [2, 0], max: [14, 8] };
  const expected = await buildGroundTiles(source, { ...options, bounds });
  const reused = await buildGroundTiles(source, {
    ...options,
    bounds,
    cache,
    onTile: (value) => progress.push(value),
  });
  assert.ok(progress.every((value) => value.cached));
  assert.deepEqual(reused, expected);
  assert.equal(plan(reused, [3, 0, 4], [13, 0, 4]).status, 'complete');
  assert.ok(initial.surfaces.some((surface) => surface.vertices.some((point) => point[0] < 2)));
  const changed: TileProgress[] = [];
  await buildGroundTiles(geometry([...quad(-2, 18, -2, 10, 0), ...quad(7, 9, -2, 10, 1.4)]), {
    ...options,
    cache,
    onTile: (value) => changed.push(value),
  });
  assert.ok(changed.every((value) => !value.cached));
});

test('tile cache inputs retain source order and inclusive padding contacts after spatial assignment', async () => {
  const a: Vec3[] = [
    [9, 0, 1],
    [9, 0, 2],
    [10, 0, 1],
  ];
  const broad: Vec3[] = [
    [-1000, 0, 0],
    [1000, 0, 0],
    [0, 0, 1000],
  ];
  const padding = (Math.ceil(options.profile.radius / options.cellSize) + 3) * options.cellSize;
  const left: Vec3[] = [
    [-padding, 0, 0],
    [-padding, 2, 0],
    [-padding, 0, 2],
  ];
  const seam: Vec3[] = [
    [8 - padding, 0, 0],
    [8 - padding, 2, 0],
    [8 - padding, 0, 2],
  ];
  const distant: Vec3[] = [
    [1000, 0, 0],
    [1001, 0, 0],
    [1000, 0, 1],
  ];
  const received: Parameters<TileCache['load']>[0][] = [];
  await buildGroundTiles(geometry([...a, ...broad, ...left, ...distant, ...seam]), {
    ...options,
    tiles: [
      { x: 1, z: 0 },
      { x: 0, z: 0 },
    ],
    cache: {
      async load(input) {
        received.push(input);
        return [];
      },
      async save() {
        assert.fail('an admitted empty tile must remain cached');
      },
    },
  });
  assert.deepEqual(
    received.map((input) => input.positions),
    [[...broad, ...left, ...seam].flat(), [...a, ...broad, ...seam].flat()],
  );
  for (const input of received)
    assert.deepEqual(
      input.indices,
      Array.from({ length: input.positions.length / 3 }, (_, index) => index),
    );
});
