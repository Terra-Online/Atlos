import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GroundConnection, Route, Surface, Vec3 } from '#@/src/index.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import type { SweptSupport } from '#@/src/solver/physical.ts';
import { createMovingRouteAnnotator } from '#@/src/v1/solver/physical/moving-route.ts';
import { sweepSupports } from '#@/src/v1/solver/physical/supports.ts';

const floor = (id: string, x0: number, x1: number, y: number): Surface => ({
  id,
  vertices: [
    [x0, y, -1],
    [x0, y, 1],
    [x1, y, 1],
    [x1, y, -1],
  ],
});
const box = (x: number, y: number): Vec3[] => [
  ...floor('top', x - 1, x + 1, y).vertices,
  ...floor('bottom', x - 1, x + 1, y - 1).vertices,
];
const support = (
  id: string,
  family: SweptSupport['family'],
  positions: [number, number][],
): SweptSupport => ({
  id,
  family,
  level: 'level',
  model: 'model',
  assumption: 'phase-free-swept-support',
  ...sweepSupports(
    id,
    positions.map(([x, y]) => [box(x, y)]),
    2,
  ),
});
const prepare = (supports: SweptSupport[], baseSurfaces: Surface[] = []) => {
  const surfaces: Surface[] = [];
  const sourceFaces = new Map<string, { support: number; surface: number }[]>();
  for (const [index, moving] of supports.entries()) {
    for (const [face, surface] of moving.surfaces.entries()) {
      const id = 'baked/' + index + '/' + face;
      surfaces.push({ ...surface, id });
      sourceFaces.set(id, [{ support: index, surface: face }]);
    }
  }
  return {
    supports,
    baseSurfaces,
    baseProject: createGoalProjector(baseSurfaces),
    surfaces,
    sourceFaces,
    tolerance: 0.05,
  };
};
const route = (segments: Extract<Route, { status: 'complete' }>['segments']): Route => ({
  status: 'complete',
  start: 'start',
  cost: 10,
  arrivalCost: 0,
  length: 10,
  points: segments.flatMap((segment) => segment.points),
  segments,
});
const movingRouteBoxes = (
  selected: Route,
  connections: GroundConnection[],
  options: Parameters<typeof createMovingRouteAnnotator>[0],
) => createMovingRouteAnnotator(options)(selected, connections);

test('a walk-only conveyor contact emits one interpolated midpath box', () => {
  const moving = support('conveyor', 'conveyor', [
    [0, 2],
    [4, 2],
    [4.1, 2],
    [4.2, 2],
    [10, 2],
  ]);
  const options = prepare([moving], [floor('left', 3, 4.5, 2), floor('right', 5.5, 7, 2)]);
  const selected = route([
    {
      mode: 'walk',
      points: [
        [4, 2, 0],
        [6, 2, 0],
      ],
      times: [0, 2],
    },
  ]);
  const { baseProject, ...data } = options;
  const before = structuredClone({ selected, moving, options: data });
  const boxes = movingRouteBoxes(selected, [], options);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].device, 'conveyor');
  assert.equal(boxes[0].role, 'use');
  const center = (boxes[0].min[0] + boxes[0].max[0]) / 2;
  assert.ok(center > 4.5 && center < 5.5);
  assert.ok(moving.poses!.every((pose) => Math.abs(pose.min[0] - boxes[0].min[0]) > 1e-3));
  assert.deepEqual({ selected, moving, options: data }, before);
  assert.equal(options.baseProject, baseProject);
});

test('consecutive vertical rides retain distinct boarding and terminal use poses', () => {
  const moving = support('lift', 'platform', [
    [0, 0],
    [0, 4],
    [0, 8],
  ]);
  const options = prepare([moving]);
  const connections: GroundConnection[] = moving.transfers.map((transfer, index) => ({
    id: 'moving-ride/lift/' + index,
    mode: 'rope',
    state: 'open',
    points: [transfer.from, transfer.to],
    times: [0, 2],
    fromSurface: 'baked/0/' + index,
    toSurface: 'baked/0/' + (index + 1),
  }));
  const selected = route(
    connections.map((connection) => ({
      mode: connection.mode,
      connection: connection.id,
      points: connection.points,
      times: connection.times,
    })),
  );
  const boxes = movingRouteBoxes(selected, connections, options);
  assert.deepEqual(
    boxes.map(({ role, min, max }) => ({ role, min, max })),
    [
      { role: 'board', min: [-1, -1, -1], max: [1, 0, 1] },
      { role: 'use', min: [-1, 7, -1], max: [1, 8, 1] },
    ],
  );
});

test('a terminal moving support remains in use until a subsequent action actually leaves it', () => {
  const moving = support('leaf', 'platform', [
    [0, 2],
    [10, 2],
  ]);
  const options = prepare([moving], [floor('static', 11, 13, 2)]);
  const walk = {
    mode: 'walk' as const,
    points: [
      [4, 2, 0],
      [6, 2, 0],
    ] as Vec3[],
    times: [0, 2],
  };
  const terminal = movingRouteBoxes(route([walk]), [], options);
  assert.deepEqual(
    terminal.map((entry) => entry.role),
    ['board', 'use'],
  );
  assert.ok(terminal[1].min[0] <= 6 && terminal[1].max[0] >= 6);
  const leave: GroundConnection = {
    id: 'leave',
    mode: 'jump',
    state: 'open',
    points: [
      [6, 2, 0],
      [12, 2, 0],
    ],
    times: [0, 1],
    fromSurface: 'baked/0/2',
    toSurface: 'static',
  };
  const departed = movingRouteBoxes(
    route([walk, { mode: 'jump', points: leave.points, times: leave.times, connection: leave.id }]),
    [leave],
    options,
  );
  assert.deepEqual(
    departed.map((entry) => entry.role),
    ['board', 'leave'],
  );
  assert.deepEqual(
    departed.map((entry) => entry.min),
    terminal.map((entry) => entry.min),
  );
  assert.deepEqual(
    departed.map((entry) => entry.max),
    terminal.map((entry) => entry.max),
  );
});

test('jump contacts use the selected connection support faces and deduplicate a repeated pose', () => {
  const moving = support('stone', 'platform', [
    [0, 2],
    [10, 2],
  ]);
  const options = prepare([moving], [floor('static', 3, 7, 2)]);
  const connections: GroundConnection[] = [
    {
      id: 'land',
      mode: 'jump',
      state: 'open',
      fromSurface: 'static',
      toSurface: 'baked/0/2',
      points: [
        [5, 3, 0],
        [5, 2, 0],
      ],
      times: [0, 1],
    },
    {
      id: 'leave',
      mode: 'jump',
      state: 'open',
      fromSurface: 'baked/0/2',
      toSurface: 'static',
      points: [
        [5, 2, 0],
        [5, 3, 0],
      ],
      times: [0, 1],
    },
  ];
  const selected = route(
    connections.map((connection) => ({
      mode: connection.mode,
      connection: connection.id,
      points: connection.points,
      times: connection.times,
    })),
  );
  const boxes = movingRouteBoxes(selected, connections, options);
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].role, 'board');
  assert.deepEqual(boxes[0].min, [4, 1, -1]);
  const staticOnly = structuredClone(connections);
  for (const connection of staticOnly) {
    connection.fromSurface = 'static';
    connection.toSurface = 'static';
  }
  assert.deepEqual(movingRouteBoxes(selected, staticOnly, options), []);
});

test('a conveyor jump-walk-jump borrow emits one box while a later borrow stays distinct', () => {
  const moving = support('conveyor', 'conveyor', [
    [0, 2],
    [10, 2],
  ]);
  const options = prepare([moving], [floor('static', 20, 21, 0)]);
  const connections: GroundConnection[] = [
    {
      id: 'land',
      mode: 'jump',
      state: 'open',
      fromSurface: 'static',
      toSurface: 'baked/0/2',
      points: [
        [3, 3, 0],
        [4.5, 2, 0],
      ],
      times: [0, 1],
    },
    {
      id: 'leave',
      mode: 'jump',
      state: 'open',
      fromSurface: 'baked/0/2',
      toSurface: 'static',
      points: [
        [5, 2, 0],
        [7, 3, 0],
      ],
      times: [0, 1],
    },
    {
      id: 'land-again',
      mode: 'jump',
      state: 'open',
      fromSurface: 'static',
      toSurface: 'baked/0/2',
      points: [
        [7, 3, 0],
        [8.5, 2, 0],
      ],
      times: [0, 1],
    },
    {
      id: 'leave-again',
      mode: 'jump',
      state: 'open',
      fromSurface: 'baked/0/2',
      toSurface: 'static',
      points: [
        [8.5, 2, 0],
        [12, 3, 0],
      ],
      times: [0, 1],
    },
  ];
  const segment = (
    connection: GroundConnection,
  ): Extract<Route, { status: 'complete' }>['segments'][number] => ({
    mode: connection.mode,
    connection: connection.id,
    points: connection.points,
    times: connection.times,
  });
  const first = [
    segment(connections[0]),
    {
      mode: 'walk' as const,
      points: [
        [4.5, 2, 0],
        [5, 2, 0],
      ] as Vec3[],
      times: [0, 1],
    },
    segment(connections[1]),
  ];
  const annotate = createMovingRouteAnnotator(options);
  assert.equal(annotate(route(first), connections).length, 1);
  const boxes = annotate(
    route([...first, segment(connections[2]), segment(connections[3])]),
    connections,
  );
  assert.equal(boxes.length, 2);
  assert.deepEqual(
    boxes.map((entry) => entry.role),
    ['use', 'use'],
  );
  assert.ok(boxes[1].min[0] - boxes[0].min[0] > 3);
});

test('unused and legacy endpoint-only catalogues emit no boxes', () => {
  const moving = support('unused', 'conveyor', [
    [0, 2],
    [10, 2],
  ]);
  const selected = route([
    {
      mode: 'walk',
      points: [
        [4, 2, 0],
        [6, 2, 0],
      ],
      times: [0, 2],
    },
  ]);
  assert.deepEqual(
    movingRouteBoxes(selected, [], prepare([moving], [floor('static', 0, 10, 2)])),
    [],
  );
  const legacy = {
    ...moving,
    endpoints: { initial: moving.poses![0], terminal: moving.poses!.at(-1)! },
  };
  delete legacy.poses;
  delete legacy.surfacePoses;
  assert.deepEqual(movingRouteBoxes(selected, [], prepare([legacy])), []);
});

test('a seesaw contact retains the discrete winning pose without translation', () => {
  const moving: SweptSupport = {
    id: 'seesaw',
    family: 'seesaw',
    level: 'level',
    model: 'model',
    assumption: 'phase-free-swept-support',
    surfaces: [
      {
        id: 'winner',
        vertices: [
          [-1, 0, -1],
          [-1, 1, 0],
          [1, 1, 0],
          [1, 0, -1],
        ],
      },
      {
        id: 'same-pose-piece',
        vertices: [
          [-1, 1, 0],
          [-1, 2, 1],
          [1, 2, 1],
          [1, 1, 0],
        ],
      },
    ],
    poses: [{ min: [-1, -0.4, -1.5], max: [1, 2, 1.5] }],
    surfacePoses: [[{ body: 0, fromPose: 0, toPose: 0 }], [{ body: 0, fromPose: 0, toPose: 0 }]],
    transfers: [],
  };
  const boxes = movingRouteBoxes(
    route([
      {
        mode: 'walk',
        points: [
          [0, 0.5, -0.5],
          [0, 0.75, -0.25],
        ],
        times: [0, 1],
      },
    ]),
    [],
    prepare([moving]),
  );
  assert.equal(boxes.length, 1);
  assert.deepEqual(boxes[0].min, moving.poses![0].min);
  assert.deepEqual(boxes[0].max, moving.poses![0].max);
});
