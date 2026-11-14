import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface, Vec3 } from '#@/src/geometry.ts';
import {
  type GoalProjectionOptions,
  createGoalProjector,
  projectGoal,
} from '#@/src/model/goals.ts';

const ground = (id: string, x0: number, x1: number, z0 = 0, z1 = 2, y = 0): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const closePoint = (actual: Vec3, expected: number[]) =>
  actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-9));

test('preserves strict foot projection and requires an explicit interaction range', () => {
  const surfaces: Surface[] = [ground('floor', 0, 2)];
  assert.deepEqual(projectGoal(surfaces, [1, 0.1, 1], { maxVertical: 0.5 }), [
    { surface: 'floor', position: [1, 0, 1], distance: 0.1 },
  ]);
  assert.deepEqual(projectGoal(surfaces, [1, 1, 1], { maxVertical: 0.5 }), []);
  assert.throws(
    () =>
      projectGoal(surfaces, [1, 1, 1], { interaction: {} } as unknown as Parameters<
        typeof projectGoal
      >[2]),
    /Invalid interaction goal range/,
  );
});

test('allows interaction with an elevated item from nearby supported ground', () => {
  const surface: Surface = ground('lower', 1, 3);
  const target: Vec3 = [0, 1, 1];
  assert.deepEqual(projectGoal([surface], target, { maxVertical: 0.5 }), []);
  const result = projectGoal([surface], target, { maxVertical: 0.5, interaction: { radius: 1.5 } });
  assert.equal(result.length, 1);
  closePoint(result[0].position, [1, 0, 1]);
  assert.ok(Math.abs(result[0].distance - Math.sqrt(2)) < 1e-9);
  assert.deepEqual(projectGoal([surface], target, { interaction: { radius: 1.1 } }), []);
});

test('never fills a hole or silently projects onto a distant stacked floor', () => {
  const surfaces: Surface[] = [
    ground('left', -3, -1),
    ground('right', 1, 3),
    ground('upper', -3, 3, 0, 2, 5),
  ];
  const project = createGoalProjector(surfaces);
  assert.deepEqual(project([0, 0, 1], { maxVertical: 0.5 }), []);
  assert.deepEqual(project([0, 0, 1], { interaction: { radius: 0.5 } }), []);
  const near = project([0, 0, 1], { interaction: { radius: 1.1 } });
  assert.deepEqual(
    near.map((candidate) => candidate.surface),
    ['left', 'right'],
  );
  assert.ok(near.every((candidate) => candidate.position[1] === 0 && candidate.distance === 1));
});

test('uses a strict 3D sphere and retains every eligible surface in distance order', () => {
  const surfaces: Surface[] = [
    ground('near', 0, 2),
    ground('upper', 0, 2, 0, 2, 2),
    ground('far', 0, 2, 0, 2, -2),
  ];
  const candidates = projectGoal(surfaces, [1, 0.9, 1], { interaction: { radius: 1.2 } });
  assert.deepEqual(
    candidates.map((candidate) => candidate.surface),
    ['near', 'upper'],
  );
  assert.deepEqual(
    projectGoal([ground('floor', 0, 2)], [1, 1, 1], { interaction: { radius: 1 } }),
    [{ surface: 'floor', position: [1, 0, 1], distance: 1 }],
  );
  assert.deepEqual(
    projectGoal([ground('floor', 0, 2)], [1, 1, 1], { interaction: { radius: 0.999 } }),
    [],
  );
});

test('clips a sloping standing surface to an independent vertical interaction limit', () => {
  const slope: Surface = {
    id: 'slope',
    vertices: [
      [0, 0, 0],
      [3, 3, 0],
      [3, 3, 1],
      [0, 0, 1],
    ],
  };
  const project = createGoalProjector([slope]);
  const unlimited = project([2, 0, 0.5], { interaction: { radius: 2 } });
  closePoint(unlimited[0].position, [1, 1, 0.5]);
  const limited = project([2, 0, 0.5], { interaction: { radius: 2, maxVertical: 0.5 } });
  closePoint(limited[0].position, [0.5, 0.5, 0.5]);
  const exactHeight = project([2, 0, 0.5], { interaction: { radius: 2, maxVertical: 0 } });
  closePoint(exactHeight[0].position, [0, 0, 0.5]);
});

test('indexes a snapshot and serves independent repeated queries without mutation', () => {
  const surface: Surface = ground('floor', 0, 2),
    source: Vec3 = [1, 0.2, 1];
  const project = createGoalProjector([surface]);
  surface.vertices.forEach((point) => {
    point[1] = 100;
  });
  const first = project(source, { maxVertical: 0.5 });
  assert.equal(first[0].position[1], 0);
  first[0].position[1] = 50;
  assert.equal(project(source, { maxVertical: 0.5 })[0].position[1], 0);
  assert.deepEqual(source, [1, 0.2, 1]);
});

test('rejects malformed inputs and ignores surfaces without standing area', () => {
  assert.throws(
    () =>
      createGoalProjector([
        {
          id: 'bad',
          vertices: [
            [0, 0, 0],
            [1, NaN, 0],
            [0, 0, 1],
          ],
        },
      ]),
    /Invalid goal surface/,
  );
  assert.throws(
    () => projectGoal([], [0, 0, 0], { maxVertical: -1 }),
    /Invalid goal projection height/,
  );
  assert.throws(
    () => projectGoal([], [0, 0, 0], { interaction: { radius: -1 } }),
    /Invalid interaction goal range/,
  );
  assert.throws(
    () => projectGoal([], [0, 0, 0], { interaction: { radius: 1, maxVertical: NaN } }),
    /Invalid interaction goal range/,
  );
  const vertical: Surface = {
    id: 'wall',
    vertices: [
      [0, 0, 0],
      [0, 1, 0],
      [0, 1, 1],
    ],
  };
  assert.deepEqual(projectGoal([vertical], [0, 0.5, 0.5], { interaction: { radius: 1 } }), []);
});

test('clips a shared front/back surface before selecting an interaction standing point', () => {
  const slope: Surface = {
    id: 'slope',
    vertices: [
      [-1, 0.5, -1],
      [1, 0.5, -1],
      [1, 2.5, 1],
      [-1, 2.5, 1],
    ],
  };
  const target: Vec3 = [0, 0, 0],
    project = createGoalProjector([slope]);
  const unrestricted = project(target, { interaction: { radius: 2 } });
  assert.ok(unrestricted[0].position[2] < 0);
  const front = project(target, { interaction: { radius: 2, facing: [0, 0, 3], halfAngle: 45 } });
  assert.equal(front.length, 1);
  closePoint(front[0].position, [0, 1.5, 0]);
  const behind: Surface = ground('behind', -1, 1, -2, -0.5);
  assert.deepEqual(
    projectGoal([behind], [0, 1, 0], {
      interaction: { radius: 3, facing: [0, 0, 1], halfAngle: 90 },
    }),
    [],
  );
});

test('uses an explicit horizontal cone angle and rejects incomplete facing rules', () => {
  const side: Surface = ground('side', 1, 2, 0.2, 0.5);
  assert.deepEqual(
    projectGoal([side], [0, 0, 0], {
      interaction: { radius: 3, facing: [0, 0, 1], halfAngle: 30 },
    }),
    [],
  );
  assert.equal(
    projectGoal([side], [0, 0, 0], { interaction: { radius: 3, facing: [0, 0, 1], halfAngle: 90 } })
      .length,
    1,
  );
  for (const interaction of [
    { radius: 1, facing: [0, 0, 1] },
    { radius: 1, halfAngle: 45 },
    { radius: 1, facing: [0, 1, 0], halfAngle: 45 },
    { radius: 1, facing: [0, 0, 1], halfAngle: 0 },
  ]) {
    assert.throws(
      () =>
        projectGoal([], [0, 0, 0], { interaction } as unknown as Parameters<typeof projectGoal>[2]),
      /Invalid interaction facing cone/,
    );
  }
});

test('reused support geometry preserves projection order across local extensions and reordered inputs', () => {
  const base: Surface[] = [ground('left', -3, -1), ground('right', 1, 3)];
  const original = createGoalProjector(base);
  const additions = [ground('refined/0', -0.5, 0.5, 0, 2, 2), ground('remote', 100, 102)];
  for (const surfaces of [
    [...base, ...additions],
    [base[1], base[0], ...additions],
  ]) {
    const shared = createGoalProjector(surfaces),
      fresh = createGoalProjector(structuredClone(surfaces));
    for (const [target, query] of [
      [[0, 0, 1], { interaction: { radius: 3 } }],
      [[0, 1, 1], { interaction: { radius: 3, maxVertical: 1, facing: [0, 0, 1], halfAngle: 90 } }],
      [[2, 0.1, 1], { maxVertical: 0.5 }],
    ] satisfies [Vec3, Parameters<ReturnType<typeof createGoalProjector>>[1]][]) {
      assert.deepEqual(shared(target, query), fresh(target, query));
    }
  }
  assert.deepEqual(
    original([0, 0, 1], { interaction: { radius: 1.1 } }).map((value) => value.surface),
    ['left', 'right'],
  );
});

test('constructing after support mutation revalidates and keeps earlier projections isolated', () => {
  const surface: Surface = ground('before', 0, 2);
  const old = createGoalProjector([surface]);
  surface.id = 'after';
  for (const point of surface.vertices) point[1] = 3;
  const updated = createGoalProjector([surface]);
  assert.equal(old([1, 0.1, 1], { maxVertical: 0.5 })[0].surface, 'before');
  assert.deepEqual(updated([1, 0.1, 1], { maxVertical: 0.5 }), []);
  assert.equal(updated([1, 3.1, 1], { maxVertical: 0.5 })[0].surface, 'after');
  surface.vertices[1][0] = NaN;
  assert.throws(() => createGoalProjector([surface]), /Invalid goal surface/);
  assert.equal(updated([1, 3.1, 1], { maxVertical: 0.5 })[0].position[1], 3);
});

test('interaction projection selects triangle interiors, edges and vertices at varied scales', () => {
  for (const scale of [0.001, 1, 1e5]) {
    const slope: Surface = {
      id: 'slope',
      vertices: [
        [0, 0, 0],
        [4 * scale, 0, 0],
        [0, 4 * scale, 4 * scale],
      ],
    };
    for (const [target, expected] of [
      [
        [scale, 0, 2 * scale],
        [scale, scale, scale],
      ],
      [
        [-scale, scale, scale],
        [0, scale, scale],
      ],
      [
        [5 * scale, -scale, -scale],
        [4 * scale, 0, 0],
      ],
    ] satisfies [Vec3, Vec3][]) {
      const result = projectGoal([slope], target, { interaction: { radius: 10 * scale } });
      assert.equal(result.length, 1);
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs(result[0].position[axis] - expected[axis]) <= scale * 1e-9);
      assert.ok(
        Math.abs(result[0].distance - Math.hypot(...target.map((v, i) => v - expected[i]))) <=
          scale * 1e-9,
      );
    }
  }
});

test('closest projection preserves the full query winner across clipping, scales and surface ties', () => {
  let seed = 0x3127fa;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const scale of [1e-4, 1, 1e5]) {
    for (const offset of [0, 1e9]) {
      const surfaces: Surface[] = Array.from({ length: 20 }, (_, id) => {
        const x = offset + (random() - 0.5) * 10 * scale;
        const z = offset + (random() - 0.5) * 10 * scale;
        const y = (random() - 0.5) * 3 * scale;
        const size = (1 + random() * 3) * scale;
        return {
          id: `surface/${id}`,
          vertices: [
            [x, y, z],
            [x + size, y + size / 2, z],
            [x + size, y + size, z + size],
            [x, y + size / 2, z + size],
          ],
        };
      });
      surfaces.push({ id: 'tie', vertices: structuredClone(surfaces[0].vertices) });
      const project = createGoalProjector(surfaces);
      for (let query = 0; query < 24; query++) {
        const target: Vec3 = [
          offset + (random() - 0.5) * 12 * scale,
          (random() - 0.5) * 5 * scale,
          offset + (random() - 0.5) * 12 * scale,
        ];
        const options: GoalProjectionOptions =
          query % 4
            ? {
                interaction: {
                  radius: query % 7 ? 15 * scale : 0,
                  ...(query % 2 ? { maxVertical: query % 3 ? scale / 2 : 0 } : {}),
                  ...(query % 3
                    ? { facing: [0.6, 0, 0.8] as Vec3, halfAngle: query % 5 ? 30 : 90 }
                    : {}),
                },
              }
            : { maxVertical: 2 * scale };
        const closest = project.closest(target, options);
        assert.deepEqual(
          closest,
          project(target, options)[0],
          `scale=${scale}, offset=${offset}, query=${query}`,
        );
        assert.deepEqual(project.closest(target, options), closest);
      }
    }
  }
  // The triangle's box is closer than the rectangle's box, while their witnesses
  // tie. Input order, rather than BVH visitation order, must select the surface.
  const rectangle = ground('input-first', Math.SQRT1_2, 2, -2, 2);
  const triangle: Surface = {
    id: 'box-first',
    vertices: [
      [-1, 0, 2],
      [2, 0, -1],
      [2, 0, 2],
    ],
  };
  for (const surfaces of [
    [rectangle, triangle],
    [triangle, rectangle],
  ]) {
    const project = createGoalProjector(surfaces);
    const options = { interaction: { radius: 3 } };
    const expected = project([0, 0, 0], options)[0];
    assert.equal(expected.surface, surfaces[0].id);
    assert.deepEqual(project.closest([0, 0, 0], options), expected);
  }
});

test('closest projection keeps its cache separate, preserves snapshots and validates repeated queries', () => {
  const surfaces = [ground('first', -1, 1, -1, 1), ground('second', -1, 1, -1, 1)];
  const project = createGoalProjector(surfaces);
  const options = { interaction: { radius: 2, maxVertical: 0.5 } };
  const target: Vec3 = [-0, 0.1, -0];
  const first = project.closest(target, options)!;
  assert.equal(first.surface, 'first');
  first.position[1] = 100;
  assert.equal(project.closest(target, options)!.position[1], 0);
  assert.deepEqual(
    project(target, options).map((hit) => hit.surface),
    ['first', 'second'],
  );
  for (const surface of surfaces) for (const point of surface.vertices) point[1] = 10;
  assert.equal(project.closest([0, 0.2, 0], options)!.position[1], 0);
  assert.equal(createGoalProjector(surfaces).closest(target, options), undefined);
  const foot = project.closest([-0, 0.1, -0], { maxVertical: 0.5 })!;
  assert.ok(Object.is(foot.position[0], -0));
  assert.ok(Object.is(foot.position[2], -0));
  assert.throws(
    () => project.closest(target, { interaction: { radius: -1 } }),
    /interaction goal range/,
  );
  assert.throws(() => project.closest(target, { maxVertical: -1 }), /projection height/);
  assert.throws(
    () => project.closest(target, { interaction: { radius: 2, facing: [0, 0, 1] } }),
    /facing cone/,
  );
});
