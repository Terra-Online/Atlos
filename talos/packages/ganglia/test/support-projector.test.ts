import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface, Vec3 } from '#@/src/geometry.ts';
import {
  createSupportProjector,
  verticalProjectionCandidates,
} from '#@/src/v1/geo/support-projector.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';

const floor = (id: string, y: number): Surface => ({
  id,
  vertices: [
    [-2, y, -2],
    [2, y, -2],
    [2, y, 2],
    [-2, y, 2],
  ],
});

test('cached support projections preserve exact floor selection, tolerances and mutated endpoint coordinates', () => {
  const surfaces: Surface[] = [floor('lower', 0), floor('upper', 2)];
  const byId: Map<string, Surface> = new Map(surfaces.map((surface) => [surface.id, surface]));
  const project = createSupportProjector(surfaces, byId);
  const position: Vec3 = [0, 0.2, 0];
  for (let repeat = 0; repeat < 2; repeat++)
    for (const y of [0.2, 1, 1.9, 4]) {
      position[1] = y;
      for (const tolerance of [0, 0.3, 2, 5])
        for (const surface of [undefined, 'lower', 'upper']) {
          assert.deepEqual(
            project(position, tolerance, surface),
            projectPoint(surface === undefined ? surfaces : [byId.get(surface)!], position, {
              maxVertical: tolerance,
            }),
          );
        }
    }
  for (const x of [0, -0, 0])
    assert.deepEqual(project([x, 0, 0], 0), projectPoint(surfaces, [x, 0, 0], { maxVertical: 0 }));
  for (let index = 0; index < 2100; index++) {
    const point: Vec3 = [index / 10000, 0.2, 0];
    assert.deepEqual(project(point, 0.3), projectPoint(surfaces, point, { maxVertical: 0.3 }));
  }
  assert.deepEqual(
    project([0, 0.2, 0], 0.3),
    projectPoint(surfaces, [0, 0.2, 0], { maxVertical: 0.3 }),
  );
});

test('vertical candidates preserve seeded stacked, sloping and fan projections in input order', () => {
  let seed = 731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const surfaces: Surface[] = [];
  for (let cell = 0; cell < 30; cell++)
    for (let layer = 0; layer < 4; layer++) {
      const x = (cell % 6) * 10,
        z = Math.floor(cell / 6) * 10,
        y = layer * 3,
        slope = random() - 0.5;
      surfaces.push({
        id: `${cell}/${layer}`,
        vertices: [
          [x - 2, y - slope * 2, z - 2],
          [x, y, z - 3],
          [x + 2, y + slope * 2, z - 2],
          [x + 2, y + slope * 2, z + 2],
          [x - 2, y - slope * 2, z + 2],
        ],
      });
    }
  surfaces.push({ ...surfaces[0], id: 'same-height-later' });
  const project = createSupportProjector(
    surfaces,
    new Map(surfaces.map((surface) => [surface.id, surface])),
  );
  for (let sample = 0; sample < 160; sample++) {
    const cell = Math.floor(random() * 30);
    const position: Vec3 = [
      (cell % 6) * 10 + random() * 6 - 3,
      random() * 12 - 1,
      Math.floor(cell / 6) * 10 + random() * 6 - 3,
    ];
    for (const maxVertical of [0, 0.1, 1, 4]) {
      const candidates = verticalProjectionCandidates(surfaces, position, maxVertical);
      assert.ok(candidates.length < surfaces.length / 5);
      assert.deepEqual(
        projectPoint(candidates, position, { maxVertical }),
        projectPoint(surfaces, position, { maxVertical }),
      );
      assert.deepEqual(
        project(position, maxVertical),
        projectPoint(surfaces, position, { maxVertical }),
      );
    }
  }
  assert.equal(project([0, 0, 0], 0)?.surface, '0/0');
});

test('vertical bounds retain barycentric edge extrapolation and ill-conditioned fan hits', () => {
  const surfaces: Surface[] = [
    {
      id: 'slope',
      vertices: [
        [0, 0, 0],
        [1, 2, 0],
        [0, 4, 1],
      ],
    },
    {
      id: 'narrow',
      vertices: [
        [0, 0, 0],
        [1e6, 1, 1e6],
        [1e6 + 1, 2, 1e6 + 1 + 2e-10],
      ],
    },
  ];
  for (const coordinates of [
    [-4e-9, 0, -4e-9],
    [-5e-9, 0, 0.5],
    [0.5, 0, -5e-9],
    [0.5 + 3e-9, 0, 0.5 + 3e-9],
    [1e6, 1, 1e6],
  ]) {
    const position = coordinates as Vec3;
    const expected = projectPoint(surfaces, position, { maxVertical: 10 });
    assert.ok(expected);
    // Query at the extrapolated height itself. Y pruning must preserve a hit
    // just outside the vertex-height bounds even with zero vertical tolerance.
    const exact = expected.position;
    assert.deepEqual(
      projectPoint(verticalProjectionCandidates(surfaces, exact, 0), exact, { maxVertical: 0 }),
      projectPoint(surfaces, exact, { maxVertical: 0 }),
    );
  }
});
