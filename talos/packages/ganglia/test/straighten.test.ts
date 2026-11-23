import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Portal, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import {
  createGroundStraightener,
  createGroundStraightenerFromMesh,
  prepareGroundStraightenerMesh,
} from '#@/src/v1/route/straighten.ts';

const options = { walls: [], profile: { radius: 0.3, height: 1.7 } };
const rectangle = (
  id: string,
  x: number,
  z: number,
  width = 1,
  depth = 1,
  height: (x: number, z: number) => number = () => 0,
): Surface => ({
  id,
  vertices: [
    [x, height(x, z), z],
    [x + width, height(x + width, z), z],
    [x + width, height(x + width, z + depth), z + depth],
    [x, height(x, z + depth), z + depth],
  ],
});
const closePoint = (actual: Vec3, expected: number[]) =>
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));

test('removes centre and portal zigzags across an arbitrary planar strip', () => {
  const surfaces: Surface[] = Array.from({ length: 12 }, (_, i) => rectangle(String(i), i, 0));
  const points: Vec3[] = [[0.1, 0, 0.2]];
  for (let i = 0; i < 11; i++) points.push([i + 0.5, 0, 0.5], [i + 1, 0, 0.5]);
  points.push([11.9, 0, 0.8]);
  const original = structuredClone(points);
  const straighten = createGroundStraightener(surfaces, options);
  assert.deepEqual(straighten(points), [points[0], points.at(-1)]);
  assert.deepEqual(points, original);
  assert.deepEqual(straighten([...points].reverse()), [points.at(-1), points[0]]);
});

test('retains required corners around an unsupported inside corner', () => {
  const surfaces: Surface[] = [
    rectangle('a', 0, 0),
    rectangle('b', 1, 0),
    rectangle('c', 2, 0),
    rectangle('d', 2, 1),
    rectangle('e', 2, 2),
  ];
  const input: Vec3[] = [
    [0.1, 0, 0.5],
    [0.5, 0, 0.5],
    [1, 0, 0.5],
    [1.5, 0, 0.5],
    [2, 0, 0.5],
    [2.5, 0, 0.5],
    [2.5, 0, 1],
    [2.5, 0, 1.5],
    [2.5, 0, 2.9],
  ];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.length > 2 && result.length < input.length);
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
  for (let i = 1; i < result.length; i++) {
    for (let step = 0; step <= 20; step++) {
      const t = step / 20,
        point = result[i - 1].map((value, axis) => value + t * (result[i][axis] - value));
      assert.ok(point[2] <= 1 + 1e-7 || point[0] >= 2 - 1e-7);
    }
  }
});

test('preserves a closed portal and a gap even where endpoints share a height', () => {
  const closed: Surface = rectangle('a', 0, 0);
  closed.portals = [0, 2, 3];
  const surfaces: Surface[] = [closed, rectangle('b', 1, 0), rectangle('far', 2.1, 0)];
  const input: Vec3[] = [
    [0.2, 0, 0.2],
    [0.5, 0, 0.7],
    [1.5, 0, 0.7],
    [2.8, 0, 0.2],
  ];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.some((point) => point[0] === 0.5));
  assert.ok(result.some((point) => point[0] === 1.5));
});

test('never projects a ground shortcut onto a stacked floor', () => {
  const surfaces: Surface[] = [
    rectangle('lower', 0, 0, 4, 1),
    rectangle('upper', 0, 0, 4, 1, () => 3),
  ];
  const input: Vec3[] = [
    [0.2, 0, 0.2],
    [1.2, 0, 0.8],
    [1.2, 3, 0.8],
    [3.8, 3, 0.2],
  ];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.ok(result.length >= 4);
  assert.deepEqual(result[1], input[1]);
  assert.deepEqual(result[2], input[2]);
});

test('reconstructs changes in ground slope but collapses coplanar crossings', () => {
  const surfaces: Surface[] = [
    rectangle('a', 0, 0, 1, 1, (x) => x),
    rectangle('b', 1, 0, 1, 1, () => 1),
    rectangle('c', 2, 0, 1, 1, () => 1),
  ];
  const input: Vec3[] = [
    [0.1, 0.1, 0.2],
    [0.5, 0.5, 0.5],
    [1, 1, 0.5],
    [1.5, 1, 0.5],
    [2, 1, 0.5],
    [2.9, 1, 0.8],
  ];
  const result = createGroundStraightener(surfaces, options)(input);
  assert.equal(result.length, 3);
  closePoint(result[1], [1, 1, 0.2 + (0.6 * 0.9) / 2.8]);
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
});

test('keeps a wall-avoiding bend and checks body clearance', () => {
  const surface: Surface = rectangle('floor', 0, 0, 4, 4);
  const wall: Wall = { min: [1.8, -1, 1.2], max: [2.2, 3, 2.8], state: 'unknown' };
  const input: Vec3[] = [
    [0.5, 0, 2],
    [1, 0, 3.5],
    [3, 0, 3.5],
    [3.5, 0, 2],
  ];
  const result = createGroundStraightener([surface], { ...options, walls: [wall] })(input);
  assert.ok(result.length > 2);
  const length = (points: Vec3[]) =>
    points
      .slice(1)
      .reduce(
        (sum, point, index) =>
          sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])),
        0,
      );
  assert.ok(length(result) < length(input) - 0.1);
  const tracer = createGroundStraightener([surface], { ...options, walls: [wall] });
  for (let index = 1; index < result.length; index++)
    assert.ok(tracer.trace(result[index - 1], result[index]));
  assert.deepEqual(result[0], input[0]);
  assert.deepEqual(result.at(-1), input.at(-1));
});

test('rejects malformed inputs and preserves stationary paths', () => {
  const straighten = createGroundStraightener([rectangle('floor', 0, 0)], options);
  assert.deepEqual(straighten([[0.2, 0, 0.2]]), [[0.2, 0, 0.2]]);
  assert.throws(() => straighten([]), /Invalid ground path/);
  assert.throws(() => straighten([[NaN, 0, 0]]), /Invalid ground path/);
  assert.throws(
    () => createGroundStraightener([rectangle('a', 0, 0), rectangle('a', 1, 0)], options),
    /Invalid surface/,
  );
});

test('does not pass through a vertex shared by disconnected polygons', () => {
  const surfaces: Surface[] = [rectangle('a', 0, 0), rectangle('b', 1, 1)];
  const input: Vec3[] = [
    [0.2, 0, 0.2],
    [0.2, 0, 0.8],
    [1.8, 0, 1.8],
  ];
  assert.deepEqual(createGroundStraightener(surfaces, options)(input), input);
});

test('traverses connected triangle fans at a shared vertex', () => {
  const surfaces: Surface[] = [
    rectangle('a', 0, 0),
    rectangle('b', 1, 0),
    rectangle('c', 0, 1),
    rectangle('d', 1, 1),
  ];
  const input: Vec3[] = [
    [0.2, 0, 0.2],
    [0.5, 0, 0.5],
    [1, 0, 0.5],
    [1.5, 0, 0.5],
    [1.5, 0, 1],
    [1.8, 0, 1.8],
  ];
  assert.deepEqual(createGroundStraightener(surfaces, options)(input), [input[0], input.at(-1)]);
});

test('straightens through split portals and stays inside their overlap', () => {
  const a: Surface = rectangle('a', 0, 0, 1, 2);
  const b: Surface = rectangle('b', 1, 0),
    c: Surface = rectangle('c', 1, 1);
  const input: Vec3[] = [
    [0.2, 0, 0.3],
    [0.5, 0, 1],
    [1, 0, 0.5],
    [1.8, 0, 0.3],
  ];
  assert.deepEqual(createGroundStraightener([a, b, c], options)(input), [input[0], input.at(-1)]);
});

test('shared portals admit both directions only within the clipped interval', () => {
  const ground = createGroundStraightener(
    [rectangle('wide', 0, 0, 1, 2), rectangle('upper', 1, 1)],
    options,
  );
  const start: Vec3 = [0.25, 0, 1.25],
    end: Vec3 = [1.75, 0, 1.25],
    below: Vec3 = [0.25, 0, 0.25];
  assert.deepEqual(ground.trace(start, end), [start, end]);
  assert.deepEqual(ground.trace(end, start), [end, start]);
  assert.equal(ground.mayConnect(below, end), true);
  assert.equal(ground.trace(below, end), null);
  assert.equal(ground.trace(end, below), null);
});

test('shared support primitives rebuild independent portal neighbours and global traversal order', () => {
  const base: Surface[] = [];
  for (let group = 0; group < 8; group++) {
    const x = group * 20;
    base.push(
      rectangle(`a${group}`, x, 0, 4, 4),
      rectangle(`b${group}`, x + 4, 0, 4, 2),
      rectangle(`c${group}`, x + 4, 2, 4, 2),
    );
  }
  const before = createGroundStraightener(base, options);
  const path: Vec3[] = [
    [1, 0, 1],
    [3, 0, 1],
    [4, 0, 1],
    [7, 0, 1],
  ];
  const expected = before(path);
  assert.deepEqual(expected, [path[0], path.at(-1)]);
  const scenarios = [
    [...base, rectangle('remote', 1000, 1000, 2, 2)],
    [...base, rectangle('third-owner', 4, 0, 2, 2)],
    [base[1], base[0], ...base.slice(2)],
  ];
  for (const surfaces of scenarios) {
    const shared = createGroundStraightener(surfaces, options);
    const fresh = createGroundStraightener(structuredClone(surfaces), options);
    for (const run of [
      path,
      [...path].reverse(),
      [
        [1, 0, 3],
        [4, 0, 3],
        [7, 0, 3],
      ],
    ] satisfies Vec3[][]) {
      assert.deepEqual(shared(run), fresh(run));
      assert.deepEqual(shared.trace(run[0], run.at(-1)!), fresh.trace(run[0], run.at(-1)!));
    }
    assert.deepEqual(before(path), expected);
  }
});

test('shared primitives retain one-way imported steps without sharing planner neighbour state', () => {
  const lower: Surface = rectangle('lower', 0, 0),
    upper: Surface = rectangle('upper', 1, 0, 1, 1, () => 0.3);
  const portal: Portal = {
    from: 'lower',
    to: 'upper',
    points: [
      [1, 0, 0.5],
      [1, 0.3, 0.5],
    ],
    entry: [
      [1, 0, 0],
      [1, 0, 1],
    ],
    exit: [
      [1, 0.3, 0],
      [1, 0.3, 1],
    ],
  };
  const surfaces: Surface[] = [lower, upper],
    start: Vec3 = [0.2, 0, 0.5],
    end: Vec3 = [1.8, 0.3, 0.5];
  const forward = createGroundStraightener(surfaces, { ...options, portals: [portal] });
  const reverse = createGroundStraightener([...surfaces, rectangle('far', 100, 100)], {
    ...options,
    portals: [
      {
        from: portal.to,
        to: portal.from,
        points: [portal.points[1], portal.points[0]],
        entry: portal.exit,
        exit: portal.entry,
      },
    ],
  });
  assert.deepEqual(forward.trace(start, end), [start, portal.points[0], portal.points[1], end]);
  assert.equal(forward.mayConnect(start, end), true);
  assert.equal(forward.mayConnect(end, start), true);
  assert.equal(forward.trace(end, start), null);
  assert.ok(reverse.trace(end, start));
  assert.equal(reverse.trace(start, end), null);
  assert.ok(forward.trace(start, end));
});

test('weak support rejection retains overlapping faces and rechecks mutated endpoint positions', () => {
  const ground = createGroundStraightener(
    [
      rectangle('small', 0, 0, 2, 2),
      rectangle('overlap', -1, -1, 12, 4),
      rectangle('island', 20, 0),
    ],
    options,
  );
  const start: Vec3 = [0.5, 0, 0.5],
    end: Vec3 = [20.5, 0, 0.5];
  assert.equal(ground.mayConnect(start, end), false);
  assert.equal(ground.trace(start, end), null);
  end[0] = 9;
  assert.equal(ground.mayConnect(start, end), true);
  assert.deepEqual(ground.trace(start, end), [start, end]);
});

test('rebuilding mutated supports revalidates geometry and masks while previous traces stay owned', () => {
  const surface: Surface = rectangle('floor', 0, 0, 2, 2),
    path: Vec3[] = [
      [0.2, 0, 0.2],
      [1, 0, 1],
      [1.8, 0, 1.8],
    ];
  const original = createGroundStraightener([surface], options);
  for (const point of surface.vertices) point[1] = 5;
  const updated = createGroundStraightener([surface], options);
  assert.deepEqual(original(path), [path[0], path.at(-1)]);
  assert.equal(updated.trace(path[0], path.at(-1)!), null);
  assert.ok(updated.trace([0.2, 5, 0.2], [1.8, 5, 1.8]));
  surface.vertices[1][0] = NaN;
  assert.throws(() => createGroundStraightener([surface], options, []), /Invalid surface/);
  surface.vertices[1][0] = 2;
  surface.portals = [4];
  assert.throws(() => createGroundStraightener([surface], options, []), /Invalid surface portals/);
  assert.ok(updated.trace([0.2, 5, 0.2], [1.8, 5, 1.8]));
});

test('fan neighbours stay local to each face when identical polygons overlap', () => {
  const a: Surface = { ...rectangle('floor"/0', 0, 0, 2, 2), portals: [] };
  const b: Surface = { ...structuredClone(a), id: 'floor/"0' };
  const input: Vec3[] = [
    [0.2, 0, 0.3],
    [0.8, 0, 0.7],
    [1.8, 0, 1.7],
  ];
  const trace = createGroundStraightener([a, b], options);
  assert.deepEqual(trace.trace(input[0], input.at(-1)!), [input[0], input.at(-1)]);
  assert.deepEqual(trace(input), [input[0], input.at(-1)]);
});

test('overlapping supports retain the first trace in bounds traversal order', () => {
  const crease: Surface = {
    id: 'crease',
    portals: [],
    vertices: [
      [0, 2, 0],
      [2, 0, 0],
      [2, 2, 2],
      [0, 0, 2],
    ],
  };
  const flat = { ...rectangle('flat', 0, 0, 2, 2), portals: [] };
  const start: Vec3 = [2, 0, 0],
    end: Vec3 = [0, 0, 2];
  assert.deepEqual(createGroundStraightener([crease, flat], options).trace(start, end), [
    start,
    [1, 2, 1],
    end,
  ]);
  assert.deepEqual(createGroundStraightener([flat, crease], options).trace(start, end), [
    start,
    end,
  ]);
});

test('support tolerance applies barycentric tests to the entire selected leaf', () => {
  const floor = rectangle('floor', 0, 0, 10, 2);
  const overlapping = rectangle('above', -1, 0, 10, 2, () => 4);
  const start: Vec3 = [-5e-7, 0, 0.5],
    end: Vec3 = [9, 0, 0.5];
  assert.equal(createGroundStraightener([floor], options).trace(start, end), null);
  assert.deepEqual(createGroundStraightener([floor, overlapping], options).trace(start, end), [
    start,
    end,
  ]);
});

test('duplicate IDs are rejected even when the first face has no support triangles', () => {
  const empty: Surface = {
    id: 'floor',
    vertices: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
    portals: [],
  };
  assert.throws(
    () => createGroundStraightener([empty, rectangle('floor', 0, 0)], options, []),
    /Invalid surface/,
  );
});

test('prepareGroundStraightenerMesh shares static mesh while each straightener enforces its own walls', () => {
  const surfaces: Surface[] = [
    rectangle('left', 0, 0, 2, 4),
    rectangle('right', 2, 0, 2, 4),
    rectangle('island', 10, 0, 2, 2),
  ];
  const mesh = prepareGroundStraightenerMesh(surfaces);
  const centerWall: Wall = { min: [1.8, -1, 1.2], max: [2.2, 3, 2.8], state: 'active' };
  const topWall: Wall = { min: [1.8, -1, 2.5], max: [2.2, 3, 4.1], state: 'active' };
  const clear = createGroundStraightenerFromMesh(mesh, createWallChecker([], options.profile));
  const centerBlocked = createGroundStraightenerFromMesh(
    mesh,
    createWallChecker([centerWall], options.profile),
  );
  const topBlocked = createGroundStraightenerFromMesh(
    mesh,
    createWallChecker([topWall], options.profile),
  );
  const freshClear = createGroundStraightener(surfaces, options);
  const freshCenter = createGroundStraightener(surfaces, { ...options, walls: [centerWall] });
  const freshTop = createGroundStraightener(surfaces, { ...options, walls: [topWall] });

  const start: Vec3 = [0.5, 0, 2];
  const goal: Vec3 = [3.5, 0, 2];
  const islandPt: Vec3 = [11, 0, 1];
  const lowerBend: Vec3[] = [start, [1, 0, 0.5], [3, 0, 0.5], goal];
  const upperBend: Vec3[] = [start, [1, 0, 3.5], [3, 0, 3.5], goal];

  assert.equal(clear.mayConnect(start, goal), true);
  assert.equal(centerBlocked.mayConnect(start, goal), true);
  assert.equal(clear.mayConnect(start, islandPt), false);
  assert.equal(centerBlocked.mayConnect(start, islandPt), false);

  assert.deepEqual(clear.trace(start, goal), freshClear.trace(start, goal));
  assert.equal(centerBlocked.trace(start, goal), null);
  assert.deepEqual(topBlocked.trace(start, goal), freshTop.trace(start, goal));

  assert.deepEqual(clear(upperBend), freshClear(upperBend));
  assert.deepEqual(centerBlocked(upperBend), freshCenter(upperBend));
  assert.deepEqual(topBlocked(upperBend), freshTop(upperBend));
  assert.deepEqual(topBlocked(lowerBend), freshTop(lowerBend));
});

test('direct fans preserve exact crease heights and skip an initial degenerate fan', () => {
  const surface: Surface = {
    id: 'crease',
    vertices: [
      [-0, -0, -0],
      [1, 0, 0],
      [2, 0, 0],
      [2, 2, 2],
      [0, 0, 2],
    ],
  };
  const mesh = prepareGroundStraightenerMesh([surface], []);
  assert.ok(Object.is(mesh.vertCoords[0], -0));
  const straighten = createGroundStraightenerFromMesh(mesh, createWallChecker([], options.profile));
  const start: Vec3 = [0.25, 0.25, 0.75];
  const end: Vec3 = [1.75, 0.75, 0.75];
  const expected: Vec3[] = [start, [0.75, 0.75, 0.75], end];
  assert.deepEqual(straighten.trace(start, end), expected);
  for (const point of surface.vertices) point[1] += 10;
  assert.deepEqual(straighten.trace(start, end), expected);
});
