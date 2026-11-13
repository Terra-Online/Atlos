import assert from 'node:assert/strict';
import test from 'node:test';

import { createRustTransferQuery } from '#@/prototype/rust-kernel/binding.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundTopology } from '#@/src/v1/reach/connectivity.ts';
import { createTypeScriptTransferQuery } from '#@/src/v1/search/candidate-transfers.ts';

const check = (surfaces: Surface[], components: number[], radius: number, vertical: number) => {
  const topology: GroundTopology = {
    ids: new Map(surfaces.map((surface, i) => [surface.id, i])),
    components: Int32Array.from(components),
    count: Math.max(-1, ...components) + 1,
    forward: surfaces.map(() => []),
  };
  const js = createTypeScriptTransferQuery(surfaces, topology, radius, vertical),
    rust = createRustTransferQuery(surfaces, topology, radius, vertical);
  for (const component of new Set([...components, topology.count + 10])) {
    assert.deepEqual(rust(component), js(component), `component ${component}`);
    assert.deepEqual(rust(component), js(component), 'repeat query must preserve ordering');
  }
};

test('native transfer witnesses preserve duplicate ownership, retention and encounter ties', () => {
  check(
    [
      {
        id: 'a',
        vertices: [
          [-0, 0, 0],
          [0.0005, 0, 0],
          [1, 0, 1],
        ],
      },
      {
        id: 'b',
        vertices: [
          [2, 0, 0],
          [2, 0, 2],
          [1, 0, -1],
        ],
      },
      {
        id: 'repeat-a',
        vertices: [
          [0, 0, 0],
          [1, 0, 1],
        ],
      },
      {
        id: 'c',
        vertices: [
          [-2, 1, -2],
          [-1, 1, -1],
          [-2, 1, -1],
        ],
      },
      {
        id: 'd',
        vertices: [
          [0, 2, 0],
          [0, 2.000000000001, 1],
          [0, -2, 0],
        ],
      },
    ],
    [0, 1, 0, 2, 3],
    2,
    2,
  );
  check([], [], 1, 1);
});

test('seeded fractional, boundary and near-duplicate geometry matches TypeScript exactly', () => {
  let seed = 48271;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 35; trial++) {
    const radius = [0.5, 2, 7.5, 96][trial % 4];
    const surfaces: Surface[] = Array.from({ length: 20 }, (_, i) => ({
      id: `surface-${i}`,
      vertices: Array.from({ length: 8 }, () => {
        const x = Math.floor(random() * 6 - 3) * radius,
          y = random() * 8 - 4,
          z = Math.floor(random() * 6 - 3) * radius;
        return random() < 0.3 ? [x, 0, z] : [x + random() * 0.002, y, z + random() * radius];
      }),
    }));
    check(
      surfaces,
      surfaces.map((_, i) => i % 5),
      radius,
      4,
    );
  }
});

import { createRustCollisionWorld } from '#@/prototype/rust-kernel/collision-world.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';

test('native BVH queries preserve TypeScript hits and numeric results on seeded mixed geometry', () => {
  let state = 63827;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i < 100; i++) {
    const x = random() * 20 - 10,
      y = random() * 8 - 4,
      z = random() * 20 - 10;
    positions.push(x, y, z, x + random() * 4, y + random(), z, x, y, z + random() * 4);
    indices.push(i * 3, i * 3 + 2, i * 3 + 1);
  }
  const geometry = { positions, indices };
  for (const options of [
    undefined,
    { bounds: { min: [-20, -20] as [number, number], max: [20, 20] as [number, number] } },
  ]) {
    const js = createTypeScriptCollisionWorld(geometry, options),
      native = createRustCollisionWorld(geometry, options);
    for (let i = 0; i < 1000; i++) {
      const point = (): [number, number, number] => [
        random() * 20 - 10,
        random() * 10 - 5,
        random() * 20 - 10,
      ];
      const start = point(),
        end = point(),
        profile = { radius: random() * 0.8, height: 2, inflation: random() * 0.2 };
      assert.deepEqual(
        native.sweepCapsule(start, end, profile),
        js.sweepCapsule(start, end, profile),
      );
      const settings = {
        maxUp: random() * 3,
        maxDown: random() * 3,
        maxSlope: 45,
        radius: i % 2 ? 0 : random() * 0.5,
      };
      assert.deepEqual(native.groundAt(start, settings), js.groundAt(start, settings));
    }
    assert.deepEqual(
      native.trianglesInBounds?.({ min: [-2, -2], max: [2, 2] }),
      js.trianglesInBounds?.({ min: [-2, -2], max: [2, 2] }),
    );
  }
});

import { createRustGroundTracer } from '#@/prototype/rust-kernel/ground-trace-binding.ts';
import {
  createGroundStraightener,
  installGroundTracePrototype,
} from '#@/src/v1/route/straighten.ts';

test('native ground traces preserve supported crossings and wall rejection across repeated queries', () => {
  let seed = 7653;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const slope of [0, 0.2]) {
    const point = (x: number, z: number): Vec3 => [x, slope * x + (slope / 2) * z, z];
    const surfaces: Surface[] = [];
    for (let x = 0; x < 6; x++)
      for (let z = 0; z < 6; z++) {
        if (x === 2 && z > 0 && z < 4) continue;
        surfaces.push({
          id: `${x}/${z}`,
          vertices: [point(x, z), point(x, z + 1), point(x + 1, z + 1), point(x + 1, z)],
        });
      }
    for (const walls of [
      [],
      [{ min: [3, -5, 0] as Vec3, max: [3.1, 10, 3] as Vec3, state: 'active' as const }],
    ]) {
      const options = { walls, profile: { radius: 0.3, height: 1.8 } };
      installGroundTracePrototype(undefined);
      const js = createGroundStraightener(surfaces, options);
      installGroundTracePrototype(createRustGroundTracer);
      const native = createGroundStraightener(surfaces, options);
      for (let i = 0; i < 1000; i++) {
        const a = point(random() * 8 - 1, random() * 8 - 1),
          b = point(random() * 8 - 1, random() * 8 - 1);
        const expected = js.trace(a, b),
          actual = native.trace(a, b);
        assert.deepEqual(actual, expected);
        if (actual) actual[0][0] += 100;
        assert.deepEqual(native.trace(a, b), expected);
        assert.deepEqual(native.trace(b, a), js.trace(b, a));
      }
      const path = [point(0.5, 0.5), point(1.5, 0.5), point(1.5, 4.5), point(4.5, 4.5)];
      assert.deepEqual(native(path), js(path));
    }
  }
});

import { createRustGoalGeometry } from '#@/prototype/rust-kernel/goal-binding.ts';
import { type GoalClip, closestOnSurface } from '#@/src/model/goals.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';

test('native goal geometry preserves seeded clipping witnesses and surface ties across scales', () => {
  let seed = 0x746ad1ff;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const scale of [1e-4, 0.1, 1, 100, 1e6]) {
    const surfaces: Surface[] = Array.from({ length: 8 }, (_, id) => {
      const x = id ? (random() - 0.5) * 8 * scale : 0;
      const z = id ? (random() - 0.5) * 8 * scale : 0;
      const y = id ? (random() - 0.5) * 2 * scale : 0;
      const radius = (2 + random() * 3) * scale;
      const count = 3 + Math.floor(random() * 5);
      const vertices = Array.from({ length: count }, (_, index): Vec3 => {
        const angle = (index * 2 * Math.PI) / count;
        const dx = Math.cos(angle) * radius,
          dz = Math.sin(angle) * radius;
        return [x + dx, y + dx * 0.2 - dz * 0.1, z + dz];
      });
      if (id === 2) vertices[1] = [...vertices[0]];
      return { id: `surface/${id}`, vertices };
    });
    surfaces.push({ id: 'tie', vertices: structuredClone(surfaces[0].vertices) });
    const native = createRustGoalGeometry(surfaces);
    const clips: GoalClip[] = [
      {},
      { maxVertical: 0 },
      { maxVertical: scale / 3 },
      { facing: { forwardX: 1, forwardZ: 0, sine: 1, cosine: 0 } },
      {
        maxVertical: scale,
        facing: {
          forwardX: 0.6,
          forwardZ: 0.8,
          sine: Math.sin(Math.PI / 6),
          cosine: Math.cos(Math.PI / 6),
        },
      },
    ];
    for (let query = 0; query < 8; query++) {
      const target: Vec3 = query
        ? [
            (random() - 0.5) * 10 * scale,
            (random() - 0.5) * 6 * scale,
            (random() - 0.5) * 10 * scale,
          ]
        : [-0, 0, -0];
      const candidates = surfaces.map((_, index) => index);
      if (query % 2) candidates.reverse();
      // These two TS geometry functions never dispatch through prototype hooks.
      const projected = projectPoint(
        candidates.map((id) => surfaces[id]),
        target,
        { maxVertical: 2 * scale },
      );
      assert.deepEqual(
        native.projectPoint(target, 2 * scale, candidates),
        projected ? { ...projected, distance: Math.abs(projected.position[1] - target[1]) } : null,
        `vertical scale=${scale} query=${query}`,
      );
      for (const clip of clips) {
        const planes: ((point: Vec3) => number)[] = [];
        if (clip.maxVertical !== undefined)
          planes.push(
            (point) => point[1] - target[1] + clip.maxVertical!,
            (point) => target[1] + clip.maxVertical! - point[1],
          );
        if (clip.facing) {
          const { forwardX, forwardZ, sine, cosine } = clip.facing;
          const forward = (point: Vec3) =>
            (point[0] - target[0]) * forwardX + (point[2] - target[2]) * forwardZ;
          const side = (point: Vec3) =>
            (point[0] - target[0]) * forwardZ - (point[2] - target[2]) * forwardX;
          planes.push(
            (point) => forward(point) * sine + side(point) * cosine,
            (point) => forward(point) * sine - side(point) * cosine,
          );
        }
        const expected = candidates.flatMap((index) => {
          const candidate = closestOnSurface(surfaces[index], target, planes);
          return candidate ? [{ ...candidate, index }] : [];
        });
        assert.deepEqual(
          native.closestSurfaces(target, candidates, clip),
          expected,
          `interaction scale=${scale} query=${query} clip=${JSON.stringify(clip)}`,
        );
      }
    }
  }
});

import { createRustScheduleChooser } from '#@/prototype/rust-kernel/locomotion-binding.ts';
import type { LocomotionOptions, Segment } from '#@/src/movement.ts';
import { chooseTypeScriptSchedule } from '#@/src/v1/resource/locomotion.ts';

test('native locomotion preserves clock-boundary and resource-dominance choices', () => {
  const blocks: Segment[][] = [];
  let start: Vec3 = [0, 0, 0];
  for (let index = 0; index < 18; index++) {
    const middle: Vec3 = [start[0] + 0.37, start[1], start[2] + (index % 3 ? 0 : 0.19)];
    const end: Vec3 = [start[0] + 2.8 + (index % 4) * 0.13, start[1], middle[2]];
    if (index % 5 === 4) {
      middle[1] += 1;
      blocks.push([{ mode: 'jump', points: [start, middle, end], times: [0, 0.3, 0.9] }]);
    } else {
      const boost = index % 4 === 2 ? { id: 'boost', multiplier: 1.4, duration: 20 } : undefined;
      blocks.push([
        { mode: 'walk', points: [start, middle], times: [0, 0.2], boost },
        { mode: 'walk', points: [middle, end], times: [0, 0.7], boost },
      ]);
    }
    start = end;
  }
  const speed = { speed: 5, sprintSpeed: 7, sprintAcceleration: 2 };
  const policies: LocomotionOptions[] = [
    speed,
    {
      ...speed,
      stamina: {
        capacity: 10,
        initial: 10,
        activationCost: 1,
        sprintDrain: 2,
        recoveryRate: 1,
        recoveryDelay: 0.9,
        reserve: 0,
      },
    },
    {
      ...speed,
      dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 1 },
      sprintThrough: ['jump'],
      stamina: {
        capacity: 8,
        initial: 8,
        activationCost: 8,
        sprintDrain: 0,
        recoveryRate: 1 / 1.7,
        recoveryDelay: 0.9,
        reserve: 0,
        recoveryDuringSprint: true,
        recoveryDuringNonWalk: true,
      },
    },
  ];
  for (const maxLabels of [8, 256]) {
    const choose = createRustScheduleChooser(maxLabels);
    for (const policy of policies) {
      assert.deepEqual(choose(blocks, policy), chooseTypeScriptSchedule(blocks, policy, maxLabels));
    }
  }
});

test('native locomotion retains the last emitted sprint sample at an epsilon tail', () => {
  for (const tail of [0, 2e-9, 6e-9, 8e-9]) {
    const length = 6 + tail;
    const options: LocomotionOptions = {
      speed: 5,
      sprintSpeed: 7,
      sprintAcceleration: 2,
      stamina: {
        capacity: 2,
        initial: 1 + (length - 6) / 7,
        sprintDrain: 1,
        recoveryRate: 0,
        recoveryDelay: 0,
        reserve: 0,
      },
    };
    const blocks: Segment[][] = [
      [
        {
          mode: 'walk',
          points: [
            [0, 0, 0],
            [length, 0, 0],
          ],
          times: [0, 2],
        },
      ],
      [
        {
          mode: 'jump',
          requiredGait: 'sprint',
          points: [
            [length, 0, 0],
            [length + 1, 0, 0],
          ],
          times: [0, 0.25],
        },
      ],
    ];
    // Acceleration reaches 6m at 1s. An omitted final sample leaves a >epsilon
    // span after stamina is exhausted, forcing running before the required jump.
    // At zero tail, or with a final sample, the jump retains its entry gait.
    const feasible = tail === 0 || tail === 8e-9;
    for (const maxLabels of [64, 256]) {
      const expected = chooseTypeScriptSchedule(blocks, options, maxLabels);
      assert.equal(expected !== null, feasible, `TypeScript tail=${tail}`);
      assert.deepEqual(
        createRustScheduleChooser(maxLabels)(blocks, options),
        expected,
        `tail=${tail} maxLabels=${maxLabels}`,
      );
    }
  }
});

import { createRustCandidateSearch } from '#@/prototype/rust-kernel/candidate-binding.ts';
import type { GroundArrival } from '#@/src/route.ts';
import { createCandidatePlanner } from '#@/src/v1/search/candidate-planner.ts';
import { installCandidateSearchPrototype } from '#@/src/v1/search/candidate-search.ts';
import type {
  CandidateSearchGraph,
  CandidateSearchRequest,
} from '#@/src/v1/search/candidate-search.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

const candidateSquare = (id: string, x: number, z: number): Surface => ({
  id,
  vertices: [
    [x, 0, z],
    [x + 2, 0, z],
    [x + 2, 0, z + 2],
    [x, 0, z + 2],
  ],
});
const candidatePair = () => {
  const data = {
    surfaces: [candidateSquare('a', 0, 0), candidateSquare('b', 4, 0), candidateSquare('c', 2, 4)],
    options: { speed: 5, maxVertical: 1 },
  };
  const previous = installCandidateSearchPrototype();
  try {
    const js = createCandidatePlanner(data, { radius: 5, endpointRadius: 1 });
    installCandidateSearchPrototype(createRustCandidateSearch);
    return { js, rust: createCandidatePlanner(data, { radius: 5, endpointRadius: 1 }) };
  } finally {
    installCandidateSearchPrototype(previous);
  }
};
test('native candidate search preserves lazy growth, stable keys, retries and arrival identity', () => {
  const { js, rust } = candidatePair();
  const arrivals: GroundArrival[] = [
    { id: 'locked', position: [1, 0, 1], state: 'locked', cost: 0 },
    { id: 'costly', position: [1, 0, 1], state: 'available', cost: 3 },
    { id: 'first-cheap', position: [1, 0, 1], state: 'available', cost: 0 },
    { id: 'equal-cheap', position: [1, 0, 1], state: 'available', cost: 0 },
  ];
  const compare = (goal: Vec3, options = {}) => {
    const expected = js.plan(arrivals, goal, options),
      actual = rust.plan(arrivals, goal, options);
    assert.deepEqual(actual, expected);
    if (actual.status === 'candidate') assert.strictEqual(actual.arrival, arrivals[2]);
    return expected;
  };
  const first = compare([5, 0, 1]);
  assert.equal(first.status, 'candidate');
  compare([3, 0, 5]);
  if (first.status !== 'candidate') return;
  compare([5, 0, 1], { excludedEdges: first.path.map((edge) => edge.key!) });
  compare([5, 0, 1], { excludedEdges: first.path.map((edge) => edge.index) });
  compare([5, 0, 1], { excludedEdges: [-1, 1.5, Number.NaN, 'unknown'] });
  compare([5, 0, 1], {
    excludedTransfers: [{ from: 'a', to: 'b', min: [-1, -1, -1], max: [8, 1, 3] }],
  });
  js.reject(first.unresolved.map((edge) => edge.key!));
  rust.reject(first.unresolved.map((edge) => edge.key!));
  compare([5, 0, 1]);
  compare([50, 0, 50]);
});

test('native candidate exclusions apply to stable keys before their lazy edges materialize', () => {
  const donor = candidatePair().js;
  const starts: GroundArrival[] = [
    { id: 'start', position: [1, 0, 1], state: 'available', cost: 0 },
  ];
  const plan = donor.plan(starts, [5, 0, 1]);
  assert.equal(plan.status, 'candidate');
  if (plan.status !== 'candidate') return;
  const keys = plan.unresolved.map((edge) => edge.key!);
  const { js, rust } = candidatePair();
  const query = { excludedEdges: keys };
  assert.deepEqual(rust.plan(starts, [5, 0, 1], query), js.plan(starts, [5, 0, 1], query));
  assert.deepEqual(rust.plan(starts, [3, 0, 5]), js.plan(starts, [3, 0, 5]));
});

test('native candidate heap ties, pending entries and floating additions match the JavaScript loop', () => {
  // The endpoint's logical component differs from its expansion component. It
  // must not materialize component 9 before the first actual surface is popped.
  const fixture = () => {
    const edges = [
      { to: 1, penalty: 0, length: 1 },
      { to: 2, penalty: 0, length: 1 },
      { to: 3, penalty: 0, length: 1 },
      { to: 4, penalty: 0, length: 1 },
      { to: 5, penalty: 10000, length: 0.000000000000001 },
    ];
    const rows = [[0, 1], [2], [3], [4], [], []];
    const expanded: number[] = [],
      dirty = new Set<number>();
    const graph: CandidateSearchGraph = {
      nodeCount: () => 6,
      node: (node) => ({
        expand: node === 0 ? undefined : node === 1 ? 1 : node === 2 ? 2 : undefined,
        logical: node === 0 ? 9 : node,
      }),
      edgeCount: () => edges.length,
      edge: (index) => edges[index],
      adjacency: (node) => rows[node],
      expand: (component) => {
        expanded.push(component);
        if (component === 2) {
          edges.push({ to: 5, penalty: 10000, length: 0.000000000000001 });
          rows[4].push(5);
          dirty.add(4);
        }
      },
      flush: () => {
        const rows = [...dirty];
        dirty.clear();
        return rows;
      },
    };
    return { graph, expanded };
  };
  const query: CandidateSearchRequest = {
    end: 5,
    starts: [{ node: 0, cost: 0.1, origin: 0 }],
    excluded: new Set(),
    regions: [],
  };
  const left = fixture(),
    right = fixture();
  const scores = new Float64Array(6).fill(Infinity),
    prev = new Int32Array(6).fill(-1),
    parent = new Int32Array(6).fill(-1),
    heap = createMinHeap<{ node: number; cost: number }>(),
    expanded = new Set<number>();
  scores[0] = 0.1;
  heap.push({ node: 0, cost: 0.1 });
  while (heap.size) {
    const current = heap.pop()!;
    if (current.cost !== scores[current.node]) continue;
    if (current.node === query.end) break;
    const component = left.graph.node(current.node).expand;
    if (component !== undefined && !expanded.has(component)) {
      expanded.add(component);
      left.graph.expand(component);
      left.graph.flush();
    }
    for (const index of left.graph.adjacency(current.node)) {
      const edge = left.graph.edge(index),
        score = current.cost + edge.penalty + edge.length;
      if (score >= scores[edge.to]) continue;
      scores[edge.to] = score;
      prev[edge.to] = index;
      parent[edge.to] = current.node;
      heap.push({ node: edge.to, cost: score });
    }
  }
  const path: number[] = [];
  for (let node = query.end; prev[node] !== -1; node = parent[node]) path.push(prev[node]);
  path.reverse();
  const actual = createRustCandidateSearch(right.graph).plan(query);
  assert.deepEqual(actual, { score: scores[query.end], origin: 0, path });
  assert.deepEqual(right.expanded, left.expanded);
  assert.ok(!right.expanded.includes(9));
});

test('native candidate exclusions retain implicit ground keys without eagerly indexing them', () => {
  const data = {
    surfaces: [candidateSquare('left', 0, 0), candidateSquare('right', 2, 0)],
    options: { speed: 5, maxVertical: 1 },
  };
  const previous = installCandidateSearchPrototype();
  try {
    const js = createCandidatePlanner(data, { endpointRadius: 0.2 });
    installCandidateSearchPrototype(createRustCandidateSearch);
    const rust = createCandidatePlanner(data, { endpointRadius: 0.2 });
    const starts: GroundArrival[] = [
      { id: 'walk', position: [1, 0, 1], state: 'available', cost: 0 },
    ];
    const expected = js.plan(starts, [3, 0, 1]);
    assert.equal(expected.status, 'candidate');
    assert.deepEqual(rust.plan(starts, [3, 0, 1]), expected);
    if (expected.status !== 'candidate') return;
    const ground = expected.path.find((edge) => edge.key?.startsWith('["ground",'));
    assert.ok(ground);
    const query = { excludedEdges: [ground.key!] };
    assert.deepEqual(rust.plan(starts, [3, 0, 1], query), js.plan(starts, [3, 0, 1], query));
  } finally {
    installCandidateSearchPrototype(previous);
  }
});

test('native candidate scores retain left-associated floating additions', () => {
  const graph: CandidateSearchGraph = {
    nodeCount: () => 2,
    node: () => ({}),
    edgeCount: () => 1,
    edge: () => ({ to: 1, penalty: 1, length: 1 }),
    adjacency: (node) => (node === 0 ? [0] : []),
    expand: () => {},
    flush: () => [],
  };
  const cost = 2 ** 53;
  assert.notEqual(cost + 1 + 1, cost + (1 + 1));
  const result = createRustCandidateSearch(graph).plan({
    end: 1,
    starts: [{ node: 0, cost, origin: 7 }],
    excluded: new Set(),
    regions: [],
  });
  assert.deepEqual(result, { score: cost + 1 + 1, origin: 7, path: [0] });
});
