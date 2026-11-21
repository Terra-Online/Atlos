import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld, type CollisionOptions } from '#@/src/collision.ts';
import type { Vec3 } from '#@/src/geometry.ts';
const profile = { radius: 0.35, height: 1.66 };
const world = (faces: Vec3[][]) =>
  createCollisionWorld({
    positions: faces.flat(2),
    indices: Array.from({ length: faces.length * 3 }, (_, i) => i),
  });
const wall: Vec3[][] = [
  [
    [0, -10, -10],
    [0, 10, -10],
    [0, 10, 10],
  ],
  [
    [0, -10, -10],
    [0, 10, 10],
    [0, -10, 10],
  ],
];

test('continuous sweep catches a thin wall between clear endpoints in either direction', () => {
  const query = world(wall);
  assert.equal(query.sweepCapsule([-20, 0, 0], [-20, 0, 0], profile), null);
  assert.equal(query.sweepCapsule([20, 0, 0], [20, 0, 0], profile), null);
  assert.ok(query.sweepCapsule([-20, 0, 0], [20, 0, 0], profile));
  assert.ok(query.sweepCapsule([20, 0, 0], [-20, 0, 0], profile));
  assert.equal(query.sweepCapsule([0.36, 0, -5], [0.36, 0, 5], profile), null);
  assert.ok(query.sweepCapsule([0.34, 0, -5], [0.34, 0, 5], profile));
});

test('vertical and oblique sweeps include body height, endpoints and degenerate faces', () => {
  const floor = world([
    [
      [-10, 0, -10],
      [10, 0, -10],
      [0, 0, 10],
    ],
  ]);
  assert.ok(floor.sweepCapsule([0, 5, 0], [0, -5, 0], profile));
  assert.ok(floor.sweepCapsule([0, -3, 0], [0, -1, 0], profile));
  assert.equal(floor.sweepCapsule([0, 2, 0], [0, 3, 0], profile), null);
  const point = world([
    [
      [0, 1, 0],
      [0, 1, 0],
      [0, 1, 0],
    ],
  ]);
  assert.ok(point.sweepCapsule([-1, 0, -1], [1, 0, 1], profile));
  assert.equal(point.sweepCapsule([-1, 0, 1], [1, 0, 2], profile), null);
  const line = world([
    [
      [0, 0, 0],
      [0, 2, 0],
      [0, 1, 0],
    ],
  ]);
  assert.ok(line.sweepCapsule([-1, 0, 0], [1, 0, 0], profile));
});

test('capsule rounding is retained and curve inflation bounds the full body', () => {
  const obstacle = world([
    [
      [0.3, 1.6, 0],
      [0.3, 1.6, 0],
      [0.3, 1.6, 0],
    ],
  ]);
  assert.equal(obstacle.sweepCapsule([0, 0, 0], [0, 0, 0], profile), null);
  assert.ok(obstacle.sweepCapsule([0, 0, 0], [0, 0, 0], { ...profile, inflation: 0.1 }));
  const above = world([
    [
      [-5, 2, -5],
      [5, 2, -5],
      [0, 2, 5],
    ],
  ]);
  assert.equal(above.sweepCapsule([-1, 0, 0], [1, 0, 0], profile), null);
  assert.ok(above.sweepCapsule([-1, 0, 0], [1, 0, 0], { ...profile, inflation: 0.4 }));
});

test('BVH retains distant thin faces, input snapshots and original triangle identity', () => {
  const faces = Array.from({ length: 80 }, (_, i) => [
    [i * 5, -2, -2],
    [i * 5, 3, -2],
    [i * 5, 3, 2],
  ]);
  const geometry = { positions: faces.flat(2), indices: Array.from({ length: 240 }, (_, i) => i) };
  const query = createCollisionWorld(geometry);
  geometry.positions.fill(999);
  geometry.indices.fill(0);
  assert.equal(query.sweepCapsule([394, 0, 0], [396, 0, 0], profile)!.triangle, 79);
  assert.equal(query.sweepCapsule([396, 0, 0], [399, 0, 0], profile), null);
});

test('invalid data cannot yield a clear collision query', () => {
  assert.throws(
    () => createCollisionWorld({ positions: [NaN, 0, 0], indices: [0, 0, 0] }),
    /finite/,
  );
  assert.throws(() => createCollisionWorld({ positions: [0, 0, 0], indices: [0, 1, 0] }), /index/);
  const query = world(wall);
  assert.throws(() => query.sweepCapsule([0, NaN, 0], [0, 0, 0], profile), /sweep/);
  assert.throws(() => query.sweepCapsule([0, 0, 0], [0, 0, 0], { radius: 1, height: 1 }), /sweep/);
  assert.throws(
    () => query.sweepCapsule([0, 0, 0], [0, 0, 0], { ...profile, inflation: -1 }),
    /sweep/,
  );
});

test('small coplanar faces inside the swept axis sheet collide between capsule end spheres', () => {
  const query = world([
    [
      [0, 0.7, -0.05],
      [0, 0.9, -0.05],
      [0, 0.8, 0.05],
    ],
  ]);
  assert.ok(query.sweepCapsule([-2, 0, 0], [2, 0, 0], profile));
  const sphere = world([
    [
      [0, 0.3, 0],
      [0, 0.3, 0],
      [0, 0.3, 0],
    ],
  ]);
  assert.ok(sphere.sweepCapsule([-2, 0, 0], [2, 0, 0], { radius: 0.35, height: 0.7 }));
});

test('swept capsule agrees with analytic distance to an axis-aligned swept rectangle', () => {
  let seed = 7;
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let i = 0; i < 120; i++) {
    const p: Vec3 = [next() * 6 - 3, next() * 3 - 0.5, next() * 2 - 1];
    const dx = Math.max(0, -1 - p[0], p[0] - 1),
      dy = Math.max(0, 0.35 - p[1], p[1] - 1.31);
    const expected = dx * dx + dy * dy + p[2] * p[2] <= 0.35 ** 2;
    assert.equal(
      world([[p, p, p] as Vec3[]]).sweepCapsule([-1, 0, 0], [1, 0, 0], profile) !== null,
      expected,
    );
  }
});

const supportFloor = (height: number): Vec3[] => [
  [-5, height, -5],
  [0, height, 5],
  [5, height, -5],
];
const supportOptions = { maxUp: 0.5, maxDown: 0.5, maxSlope: 46 };

test('vertical support chooses the closest stacked floor within independent height limits', () => {
  const query = world([supportFloor(0), supportFloor(4)]);
  assert.deepEqual(query.groundAt([0, 0.1, 0], supportOptions), {
    position: [0, 0, 0],
    triangle: 0,
    normal: [0, 1, 0],
  });
  assert.equal(query.groundAt([0, 2, 0], { maxUp: 3, maxDown: 3, maxSlope: 46 })!.position[1], 4);
  assert.equal(query.groundAt([0, 2, 0], { maxUp: 1, maxDown: 3, maxSlope: 46 })!.position[1], 0);
  assert.equal(query.groundAt([0, 2, 0], { maxUp: 3, maxDown: 1, maxSlope: 46 })!.position[1], 4);
  assert.equal(query.groundAt([0, 2, 0], supportOptions), null);
  assert.equal(query.groundAt([0, 0, 0], { maxUp: 0, maxDown: 0, maxSlope: 46 })!.position[1], 0);
});

test('vertical support rejects gaps, downward faces, vertical faces and degenerate triangles', () => {
  const query = world([
    supportFloor(0),
    supportFloor(1).toReversed(),
    [
      [0, 0, 0],
      [0, 3, 0],
      [0, 0, 3],
    ],
    [
      [9, 0, 0],
      [9, 0, 0],
      [9, 0, 0],
    ],
  ]);
  assert.equal(query.groundAt([6, 0, 0], { maxUp: 10, maxDown: 10, maxSlope: 89 }), null);
  assert.equal(query.groundAt([0, 1, 0], supportOptions), null);
  assert.equal(query.groundAt([9, 0, 0], supportOptions), null);
});

test('vertical support retains exact sloping height and rejects slopes above the limit', () => {
  const query = world([
    [
      [-2, -2, -2],
      [0, 0, 2],
      [2, 2, -2],
    ],
  ]);
  const hit = query.groundAt([0.5, 1, 0], { maxUp: 0, maxDown: 1, maxSlope: 46 });
  assert.ok(hit);
  assert.deepEqual(hit.position, [0.5, 0.5, 0]);
  assert.ok(Math.abs(hit.normal[0] + Math.SQRT1_2) < 1e-12);
  assert.ok(Math.abs(hit.normal[1] - Math.SQRT1_2) < 1e-12);
  assert.equal(query.groundAt([0.5, 1, 0], { maxUp: 0, maxDown: 1, maxSlope: 44 }), null);
});

test('vertical support reuses distant BVH leaves and owns its geometry snapshot', () => {
  const faces = Array.from({ length: 80 }, (_, i) => [
    [i * 10 - 2, 0, -2],
    [i * 10, 0, 2],
    [i * 10 + 2, 0, -2],
  ]);
  const geometry = {
    positions: faces.flat(2),
    indices: Array.from({ length: faces.length * 3 }, (_, i) => i),
  };
  const query = createCollisionWorld(geometry);
  geometry.positions.fill(0);
  geometry.indices.fill(0);
  assert.equal(query.groundAt([790, 0.2, 0], supportOptions)!.triangle, 79);
  assert.deepEqual(query.groundAt([790, 0.2, 0], supportOptions)!.position, [790, 0, 0]);
  assert.equal(query.groundAt([795, 0.2, 0], supportOptions), null);
});

test('vertical support validates finite query bounds and slope units', () => {
  const query = world([supportFloor(0)]);
  assert.throws(() => query.groundAt([0, NaN, 0], supportOptions), /support query/);
  for (const options of [
    { ...supportOptions, maxUp: -1 },
    { ...supportOptions, maxDown: Infinity },
    { ...supportOptions, maxSlope: 0 },
    { ...supportOptions, maxSlope: 90 },
    { ...supportOptions, maxSlope: NaN },
  ]) {
    assert.throws(() => query.groundAt([0, 0, 0], options), /support query/);
  }
  assert.throws(
    () => query.groundAt([0, 1.7e308, 0], { ...supportOptions, maxUp: 1.7e308 }),
    /support bounds/,
  );
  assert.equal(world([]).groundAt([0, 0, 0], supportOptions), null);
});

test('bounded indexing retains crossing floors and headroom with original source triangle IDs', () => {
  const faces = [
    [
      [100, 0, -2],
      [100, 2, -2],
      [100, 2, 2],
    ],
    supportFloor(0),
    supportFloor(1.5),
  ];
  const geometry = {
    positions: faces.flat(2),
    indices: Array.from({ length: 9 }, (_, index) => index),
  };
  const requested: CollisionOptions | undefined = { bounds: { min: [-1, -1], max: [1, 1] } };
  const query = createCollisionWorld(geometry, requested);
  // Every floor vertex is outside the rectangle, while its interior crosses it.
  assert.equal(query.groundAt([0, 0.1, 0], supportOptions)!.triangle, 1);
  assert.equal(query.sweepCapsule([-0.5, 0.01, 0], [0.5, 0.01, 0], profile)!.triangle, 2);
  requested.bounds!.min.fill(500);
  requested.bounds!.max.fill(600);
  geometry.positions.fill(999);
  geometry.indices.fill(0);
  assert.equal(query.groundAt([0, 0.1, 0], supportOptions)!.triangle, 1);
  assert.equal(query.sweepCapsule([-0.5, 0.01, 0], [0.5, 0.01, 0], profile)!.triangle, 2);
});

test('bottom-sphere support covers ledges and corners without bridging a gap', () => {
  const triangles = [
    [
      [0, 5, -3],
      [4, 5, 3],
      [4, 5, -3],
    ],
    [
      [0, 5, -3],
      [0, 5, 3],
      [4, 5, 3],
    ],
  ];
  const query = createCollisionWorld({ positions: triangles.flat(2), indices: [0, 1, 2, 3, 4, 5] });
  for (const [x, z, distance] of [
    [2, 0, 0],
    [4.2, 0, 0.2],
    [4.2, 3.2, Math.sqrt(0.08)],
  ]) {
    const support = query.groundAt([x, 5, z], { ...supportOptions, radius: profile.radius });
    assert.ok(support);
    assert.ok(
      Math.abs(
        support.position[1] - (5 - profile.radius + Math.sqrt(profile.radius ** 2 - distance ** 2)),
      ) < 1e-10,
    );
    const clear: Vec3 = [x, support.position[1] + 0.005, z];
    assert.equal(query.sweepCapsule(clear, clear, profile), null);
  }
  assert.equal(query.groundAt([4.2, 5, 0], supportOptions), null);
  assert.equal(query.groundAt([4.4, 5, 0], { ...supportOptions, radius: profile.radius }), null);
  assert.throws(
    () => query.groundAt([0, 5, 0], { ...supportOptions, radius: -1 }),
    /support query/,
  );
});

test('bounded worlds guard the full capsule footprint and keep inclusive query boundaries', () => {
  const query = createCollisionWorld(
    { positions: [], indices: [] },
    { bounds: { min: [-1, -2], max: [1, 2] } },
  );
  assert.equal(query.groundAt([-1, 0, -2], supportOptions), null);
  assert.throws(() => query.groundAt([-1 - 1e-12, 0, -2], supportOptions), /indexed XZ bounds/);
  assert.throws(() => query.groundAt([0, 0, 2 + 1e-12], supportOptions), /indexed XZ bounds/);
  assert.equal(query.sweepCapsule([0.5, 0, 1.5], [0.5, 0, 1.5], { radius: 0.5, height: 1 }), null);
  assert.throws(
    () =>
      query.sweepCapsule([0.5, 0, 1.5], [0.5, 0, 1.5], {
        radius: 0.5,
        height: 1,
        inflation: 1e-12,
      }),
    /indexed XZ bounds/,
  );
  assert.throws(() => query.sweepCapsule([0, 0, 0], [0.9, 0, 0], profile), /indexed XZ bounds/);
  assert.equal(query.sweepCapsule([1, 0, 2], [1, 0, 2], { radius: 0, height: 1 }), null);
});

test('bounded worlds retain thin faces exactly on the indexed boundary', () => {
  const geometry = { positions: [1, -1, -1, 1, 2, -1, 1, 0.5, 1], indices: [0, 1, 2] };
  const query = createCollisionWorld(geometry, { bounds: { min: [-1, -1], max: [1, 1] } });
  assert.ok(query.sweepCapsule([0.5, 0, 0], [0.5, 0, 0], { radius: 0.5, height: 1 }));
});

test('crop bounds are finite and malformed excluded source geometry still fails', () => {
  for (const bounds of [
    { min: [0], max: [1, 1] },
    { min: [0, 0], max: [1, Infinity] },
    { min: [2, 0], max: [1, 1] },
    { min: [0, Number.NaN], max: [1, 1] },
  ])
    assert.throws(
      () =>
        createCollisionWorld({ positions: [], indices: [] }, { bounds } as unknown as Parameters<
          typeof createCollisionWorld
        >[1]),
      /collision XZ bounds/,
    );
  const bounds = { min: [-1, -1], max: [1, 1] };
  assert.throws(
    () =>
      createCollisionWorld({ positions: [100, NaN, 100], indices: [0, 0, 0] }, {
        bounds,
      } as unknown as Parameters<typeof createCollisionWorld>[1]),
    /finite/,
  );
  assert.throws(
    () =>
      createCollisionWorld({ positions: [100, 0, 100], indices: [0, 1, 0] }, {
        bounds,
      } as unknown as Parameters<typeof createCollisionWorld>[1]),
    /index/,
  );
});

test('indexed sweeps retain every collision across mixed faces and source permutations', () => {
  const faces: Vec3[][] = Array.from({ length: 67 }, (_, i) => {
    const x = ((i * 17) % 11) - 5,
      y = (i % 4) - 2,
      z = ((i * 7) % 13) - 6;
    return i % 5 === 0
      ? [
          [x, y - 2, z - 2],
          [x, y + 2, z - 2],
          [x, y, z + 2],
        ]
      : [
          [x - 2, y, z - 2],
          [x, y, z + 2],
          [x + 2, y, z - 2],
        ];
  });
  for (const ordered of [faces, faces.toReversed()]) {
    const indexed = world(ordered),
      singles = ordered.map((face) => world([face]));
    for (let i = 0; i < 40; i++) {
      const start: Vec3 = [(i % 9) - 4, (i % 5) - 2, (i % 7) - 3];
      const end: Vec3 = [3 - (i % 7), 2 - (i % 5), 4 - (i % 9)];
      const hit = indexed.sweepCapsule(start, end, profile);
      assert.equal(
        hit !== null,
        singles.some((single) => single.sweepCapsule(start, end, profile) !== null),
      );
      if (hit) assert.ok(singles[hit.triangle].sweepCapsule(start, end, profile));
    }
  }
});

test('parallelogram and degenerate capsule sweeps match reference distance across oblique faces', () => {
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const mix = (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
  const sq = (a: Vec3, b: Vec3) => dot(sub(a, b), sub(a, b));
  const ptSeg = (p: Vec3, a: Vec3, b: Vec3) => {
    const d = sub(b, a),
      l = dot(d, d);
    return sq(p, mix(a, b, l ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l)) : 0));
  };
  const segSeg = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => {
    let best = Math.min(ptSeg(a, c, d), ptSeg(b, c, d), ptSeg(c, a, b), ptSeg(d, a, b));
    const u = sub(b, a),
      v = sub(d, c),
      w = sub(c, a),
      n = cross(u, v),
      denom = dot(n, n);
    if (denom > 0) {
      const s = dot(cross(w, v), n) / denom,
        t = dot(cross(w, u), n) / denom;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
        best = Math.min(best, sq(mix(a, b, s), mix(c, d, t)));
    }
    return best;
  };
  const inside = (p: Vec3, tri: Vec3[], n: Vec3) =>
    [0, 1, 2].every((i) => dot(cross(sub(tri[(i + 1) % 3], tri[i]), sub(p, tri[i])), n) >= 0);
  const ptTri = (p: Vec3, tri: Vec3[], n: Vec3) => {
    const area = dot(n, n);
    if (area > 0) {
      const dist = dot(sub(p, tri[0]), n) / area;
      const q: Vec3 = [p[0] - n[0] * dist, p[1] - n[1] * dist, p[2] - n[2] * dist];
      if (inside(q, tri, n)) return sq(p, q);
    }
    return Math.min(ptSeg(p, tri[0], tri[1]), ptSeg(p, tri[1], tri[2]), ptSeg(p, tri[2], tri[0]));
  };
  const segTri = (a: Vec3, b: Vec3, tri: Vec3[]) => {
    const n = cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]));
    const da = dot(sub(a, tri[0]), n),
      db = dot(sub(b, tri[0]), n);
    if (da !== db) {
      const t = da / (da - db);
      if (t >= 0 && t <= 1 && inside(mix(a, b, t), tri, n)) return 0;
    }
    return Math.min(
      ptTri(a, tri, n),
      ptTri(b, tri, n),
      segSeg(a, b, tri[0], tri[1]),
      segSeg(a, b, tri[1], tri[2]),
      segSeg(a, b, tri[2], tri[0]),
    );
  };
  const triTri = (a: Vec3[], b: Vec3[]) =>
    Math.min(
      segTri(a[0], a[1], b),
      segTri(a[1], a[2], b),
      segTri(a[2], a[0], b),
      segTri(b[0], b[1], a),
      segTri(b[1], b[2], a),
      segTri(b[2], b[0], a),
    );
  let seed = 1337;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const p = (): Vec3 => [(rand() - 0.5) * 4, (rand() - 0.5) * 4, (rand() - 0.5) * 4];
  for (let i = 0; i < 200; i++) {
    const face: Vec3[] = [p(), p(), p()];
    const w = world([face]);
    const s = p();
    const e: Vec3 =
      i % 5 === 0 ? [...s] : i % 5 === 1 ? [s[0], s[1] + (rand() - 0.5) * 3, s[2]] : p();
    const cap = i % 5 === 2 ? { radius: 0.35, height: 0.7 } : profile;
    const a: Vec3 = [s[0], s[1] + cap.radius, s[2]];
    const b: Vec3 = [s[0], s[1] + cap.height - cap.radius, s[2]];
    const c: Vec3 = [e[0], e[1] + cap.radius, e[2]];
    const d: Vec3 = [e[0], e[1] + cap.height - cap.radius, e[2]];
    const refSq = Math.min(triTri([a, b, d], face), triTri([a, d, c], face));
    const hit = w.sweepCapsule(s, e, cap);
    const refDist = Math.sqrt(refSq);
    if (Math.abs(refDist - cap.radius) > 1e-11) {
      assert.equal(hit !== null, refSq <= cap.radius * cap.radius);
      if (hit) assert.ok(Math.abs(hit.distance - refDist) < 1e-11);
    }
  }
});
