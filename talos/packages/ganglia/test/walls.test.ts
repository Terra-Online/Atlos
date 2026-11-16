import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3, Wall } from '#@/src/geometry.ts';
import { blockedByWalls, createWallChecker } from '#@/src/model/walls.ts';
import { route, type Graph } from '#@/src/v1/route/routes.ts';

const wall: Wall = { min: [0, 0, -2], max: [0.2, 3, 2], state: 'unknown' };
const profile = { radius: 0.4, height: 2 };
test('unknown walls reject crossing and radius grazing; inactive walls allow crossing', () => {
  assert.equal(blockedByWalls([-1, 0, 0], [1, 0, 0], [wall], profile), true);
  assert.equal(blockedByWalls([-1, 0, 2.3], [1, 0, 2.3], [wall], profile), true);
  assert.equal(
    blockedByWalls([-1, 0, 0], [1, 0, 0], [{ ...wall, state: 'inactive' }], profile),
    false,
  );
  assert.equal(blockedByWalls([-2, 0, -1], [-2, 0, 1], [{ ...wall, padding: 3 }], profile), true);
  assert.equal(blockedByWalls([-1, 4, 0], [1, 4, 0], [wall], profile), false);
  assert.equal(blockedByWalls([-1, -1, 0], [1, -1, 0], [wall], profile), true);
});

test('indexed curve inflation matches explicit body expansion for boxes and authored rings', () => {
  const cases: Wall[] = [
    wall,
    {
      ...wall,
      points: [
        [0, -2],
        [0, 2],
        [2, 2],
      ],
    },
    {
      ...wall,
      polygon: [
        [0, -2],
        [1, -2],
        [1, 2],
        [0, 2],
      ],
    },
  ];
  const segments: [Vec3, Vec3][] = [
    [
      [-1, 0, 0],
      [1, 0, 0],
    ],
    [
      [-1, 4, 0],
      [1, 4, 0],
    ],
    [
      [-1, 5, 0],
      [1, -2, 0],
    ],
    [
      [-1, 0, 2.7],
      [1, 0, 2.7],
    ],
  ];
  for (const record of cases) {
    const check = createWallChecker([record], profile);
    for (const inflation of [0, 0.01, 0.4, 1])
      for (const [start, end] of segments) {
        const shifted = (point: number[]): Vec3 => [point[0], point[1] - inflation, point[2]];
        assert.equal(
          check(start, end, inflation),
          blockedByWalls(shifted(start), shifted(end), [record], {
            radius: profile.radius + inflation,
            height: profile.height + inflation * 2,
          }),
        );
      }
    assert.throws(() => check([0, 0, 0], [0, 0, 0], -1), /wall query/);
  }
});

test('routing cannot bypass the wall test with an explicitly open edge', () => {
  const a: Vec3 = [-1, 0, 0],
    b: Vec3 = [1, 0, 0];
  const graph: Graph = {
    nodes: [
      { id: 'a', position: a },
      { id: 'b', position: b },
    ],
    edges: [{ from: 'a', to: 'b', cost: 1, state: 'open', points: [a, b] }],
  };
  assert.equal(route(graph, 'a', 'b', { walls: [wall], profile }).status, 'no-verified-route');
});

test('bent wall polylines do not fill their whole bounding box or bridge stacked floors', () => {
  const bent: Wall = {
    min: [0, 0, 0],
    max: [5, 3, 5],
    state: 'unknown',
    points: [
      [0, 0],
      [0, 5],
      [5, 5],
    ],
  };
  assert.equal(blockedByWalls([2, 0, 1], [4, 0, 1], [bent], profile), false);
  assert.equal(blockedByWalls([-1, 0, 1], [1, 0, 1], [bent], profile), true);
  assert.equal(blockedByWalls([-1, 4, 1], [1, 4, 1], [bent], profile), false);
  assert.equal(blockedByWalls([0, 4, 1], [4, 0, 1], [bent], profile), false);
  assert.equal(blockedByWalls([1, 0, 1], [1, 0, 4.8], [bent], profile), true);
});

test('filled hazard prisms preserve concavities, interior exclusion and rounded clearance', () => {
  const zone: Wall = {
    min: [0, 0, 0],
    max: [4, 4, 4],
    state: 'unknown',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ],
  };
  const profile = { radius: 0.2, height: 1.6 };
  assert.equal(blockedByWalls([2, 1, 2], [3, 1, 3], [zone], profile), false);
  assert.equal(blockedByWalls([2, 1, 0.5], [3, 1, 0.5], [zone], profile), true);
  assert.equal(blockedByWalls([-0.5, 1, 2], [0.5, 1, 2], [zone], profile), true);
  assert.equal(blockedByWalls([1.1, 1, 2], [1.1, 1, 3], [zone], profile), true);
  assert.equal(blockedByWalls([0.5, 5, 2], [0.5, 5, 3], [zone], profile), false);
  assert.equal(blockedByWalls([0.5, -1, 2], [0.5, -1, 3], [zone], profile), true);
  assert.equal(
    blockedByWalls([0.5, 1, 2], [0.5, 1, 3], [{ ...zone, state: 'inactive' }], profile),
    false,
  );
  assert.throws(
    () =>
      blockedByWalls(
        [0, 0, 0],
        [1, 0, 1],
        [
          {
            ...zone,
            points: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
        profile,
      ),
    /polygon/,
  );
});

test('prepared exclusions own their bounds, rings, active states and body profile', () => {
  const zone: Wall = {
    min: [0, 0, 0],
    max: [4, 4, 4],
    state: 'unknown',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ],
  };
  const body = { radius: 0.2, height: 2 },
    check = createWallChecker([zone], body);
  assert.equal(check([0.5, -1, 2], [0.5, -1, 3]), true);
  assert.equal(check([2, 1, 2], [3, 1, 3]), false);
  zone.state = 'inactive';
  zone.min.fill(100);
  zone.max.fill(101);
  zone.polygon!.forEach((point) => point.fill(100));
  body.radius = 0;
  body.height = 0.1;
  assert.equal(check([0.5, -1, 2], [0.5, -1, 3]), true);
  assert.equal(createWallChecker([zone], body)([0.5, -1, 2], [0.5, -1, 3]), false);
});

test('all records are validated before early hits, including inactive and distant walls', () => {
  const start: Vec3 = [-1, 0, 0],
    end: Vec3 = [1, 0, 0];
  const invalid: Wall = { ...wall, min: [100, NaN, 100], max: [101, 2, 101] };
  assert.throws(() => createWallChecker([wall, invalid], profile), /Invalid wall/);
  assert.throws(() => blockedByWalls(start, end, [wall, invalid], profile), /Invalid wall/);
  assert.throws(
    () =>
      createWallChecker(
        [
          wall,
          {
            ...wall,
            state: 'inactive',
            polygon: [
              [0, 0],
              [1, NaN],
              [1, 1],
            ],
          },
        ],
        profile,
      ),
    /polygon/,
  );
  for (const body of [
    { radius: -1, height: 2 },
    { radius: 0, height: 0 },
    { radius: NaN, height: 2 },
  ]) {
    assert.throws(() => createWallChecker([], body), /wall query/);
  }
  assert.throws(() => createWallChecker([], profile)([0, NaN, 0], [1, 0, 0]), /wall query/);
});

test('broad-phase bounds retain tall bodies, padding and ring vertices outside declared bounds', () => {
  const zone: Wall = {
    min: [100, 1, 100],
    max: [101, 2, 101],
    state: 'active',
    padding: 0.3,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
  };
  const tall = createWallChecker([zone], { radius: 0.2, height: 2 });
  assert.equal(tall([4.5, 0, 1], [4.5, 0, 3]), true);
  assert.equal(tall([4.51, 0, 1], [4.51, 0, 3]), false);
  assert.equal(tall([1, 3, 1], [3, 3, 1]), false);
  assert.equal(
    createWallChecker([zone], { radius: 0.2, height: 0.5 })([1, 0, 1], [3, 0, 1]),
    false,
  );
});

test('indexed queries match the single-query checker for deterministic mixed wall geometry', () => {
  let seed = 19;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const walls: Wall[] = Array.from({ length: 40 }, (_, index) => {
    const x = next() * 50 - 25,
      z = next() * 50 - 25,
      y = next() * 10 - 5,
      size = 1 + next() * 4;
    const shape = index % 3;
    return {
      min: [x, y, z],
      max: [x + size, y + 1 + next() * 3, z + size],
      padding: next() * 0.5,
      state: (['active', 'unknown', 'inactive'] as const)[index % 3],
      ...(shape === 0
        ? {
            polygon: [
              [x, z],
              [x + size, z],
              [x + size, z + 0.4],
              [x + 0.4, z + 0.4],
              [x + 0.4, z + size],
              [x, z + size],
            ],
          }
        : shape === 1
          ? {
              points: [
                [x, z],
                [x, z + size],
                [x + size, z + size],
              ],
            }
          : {}),
    };
  });
  for (const body of [
    { radius: 0, height: 0.1 },
    { radius: 0.35, height: 1.66 },
    { radius: 1, height: 4 },
  ]) {
    const check = createWallChecker(walls, body);
    for (let index = 0; index < 300; index++) {
      const a: Vec3 = [next() * 70 - 35, next() * 20 - 10, next() * 70 - 35];
      const b: Vec3 = [next() * 70 - 35, next() * 20 - 10, next() * 70 - 35];
      assert.equal(check(a, b), blockedByWalls(a, b, walls, body));
    }
  }
});

test('round solid occupancy rejects containment and swept contact without filling AABB corners', () => {
  const wall: Wall = {
    min: [-2, -2, -2],
    max: [2, 2, 2],
    state: 'unknown',
    sphere: { center: [0, 0, 0], radius: 2 },
  };
  const profile = { radius: 0.25, height: 1.5 };
  const query = createWallChecker([wall], profile);
  for (const [start, end, blocked] of [
    [[0, 0, 0], [0, 0, 0], true],
    [[1.9, 0, 1.9], [1.9, 0, 1.9], false],
    [[-4, 0, 0], [4, 0, 0], true],
    [[-4, 4, 0], [4, -4, 0], true],
    [[-4, 3, 0], [4, 3, 0], false],
    [[0, -4, 0], [0, -4, 0], false],
    [[0, -3, 0], [0, -3, 0], true],
  ] satisfies [Vec3, Vec3, boolean][]) {
    assert.equal(query(start, end), blocked);
    assert.equal(blockedByWalls(start, end, [wall], profile), blocked);
  }
  assert.equal(query([2.5, 0, 0], [2.5, 0, 0], 0.3), true);
  assert.equal(query([2.5, 0, 0], [2.5, 0, 0]), false);
  wall.sphere!.center[0] = 100;
  assert.equal(query([0, 0, 0], [0, 0, 0]), true);
  assert.equal(blockedByWalls([0, 0, 0], [0, 0, 0], [wall], profile), false);
});

test('sphere validation and broad-phase bounds cover the complete solid and padded body', () => {
  const wall: Wall = {
    min: [0, 0, 0],
    max: [0, 0, 0],
    state: 'active',
    padding: 0.3,
    sphere: { center: [100, 2, 0], radius: 1 },
  };
  const profile = { radius: 0.2, height: 1.6 };
  const query = createWallChecker([wall], profile);
  assert.equal(query([101.45, 1, 0], [101.45, 1, 0]), true);
  assert.equal(query([100, -0.7, 0], [100, -0.7, 0]), true);
  assert.equal(query([100, -1.5, 0], [100, -1.5, 0]), false);
  for (const sphere of [
    { center: [0, 0, 0], radius: -1 },
    { center: [NaN, 0, 0], radius: 1 },
  ]) {
    assert.throws(
      () =>
        createWallChecker(
          [{ ...wall, state: 'inactive', sphere }] as unknown as Parameters<
            typeof createWallChecker
          >[0],
          profile,
        ),
      /Invalid wall sphere/,
    );
  }
  assert.throws(
    () =>
      createWallChecker(
        [
          {
            ...wall,
            points: [
              [0, 0],
              [1, 1],
            ],
          },
        ],
        profile,
      ),
    /Invalid wall sphere/,
  );
  assert.throws(
    () =>
      createWallChecker(
        [
          {
            ...wall,
            polygon: [
              [0, 0],
              [1, 1],
              [0, 1],
            ],
          },
        ],
        profile,
      ),
    /Invalid wall sphere/,
  );
});
