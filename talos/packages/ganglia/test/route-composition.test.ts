import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Route } from '#@/src/route.ts';
import { composeRoutes } from '#@/src/v1/solver/route-result.ts';

test('composition preserves the selected arrival and retimes continuous ground motion', () => {
  const prefix: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'teleport',
    arrivalCost: 7,
    cost: 8,
    length: 1,
    points: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        times: [0, 1],
      },
    ],
  };
  const tail: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'intermediate',
    arrivalCost: 0,
    cost: 1,
    length: 1,
    points: [
      [1, 0, 0],
      [2, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [1, 0, 0],
          [2, 0, 0],
        ],
        times: [0, 1],
      },
    ],
    goalHit: { segment: 0, time: 1, position: [2, 0, 0] },
  };
  const result = composeRoutes([prefix, tail], { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 });
  assert.equal(result.status, 'complete');
  if (result.status !== 'complete') return;
  assert.equal(result.start, 'teleport');
  assert.equal(result.arrivalCost, 7);
  assert.equal(result.cost, 9);
  assert.deepEqual(result.points, [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
  ]);
  assert.deepEqual(result.goalHit, { segment: 1, time: 1, position: [2, 0, 0] });
  assert.equal(
    composeRoutes(
      [
        prefix,
        {
          ...tail,
          points: [
            [1, 1, 0],
            [2, 0, 0],
          ],
        },
      ],
      { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 },
    ).status,
    'no-verified-route',
  );
});

test('independently feasible pieces cannot restart the same timed boost at a join', () => {
  const piece = (x: number): Extract<Route, { status: 'complete' }> => ({
    status: 'complete',
    start: 'entry',
    arrivalCost: 0,
    cost: 0.75,
    length: 1,
    points: [
      [x, 0, 0],
      [x + 1, 0, 0],
    ],
    segments: [
      {
        mode: 'rope',
        points: [
          [x, 0, 0],
          [x + 1, 0, 0],
        ],
        times: [0, 0.75],
        boost: { id: 'speedup', multiplier: 2, duration: 1 },
      },
    ],
  });
  const movement = { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 };
  assert.equal(composeRoutes([piece(0)], movement).status, 'complete');
  assert.equal(composeRoutes([piece(1)], movement).status, 'complete');
  assert.equal(composeRoutes([piece(0), piece(1)], movement).status, 'no-verified-route');
});

test('composition remaps a walking goal event to the rescheduled time', () => {
  const piece = (x: number): Extract<Route, { status: 'complete' }> => ({
    status: 'complete',
    start: 'entry',
    arrivalCost: 0,
    cost: 1,
    length: 1,
    points: [
      [x, 0, 0],
      [x + 1, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [x, 0, 0],
          [x + 1, 0, 0],
        ],
        times: [0, 1],
      },
    ],
  });
  const tail = piece(1);
  tail.goalHit = { segment: 0, time: 1, position: [2, 0, 0] };
  const route = composeRoutes([piece(0), tail], {
    speed: 2,
    sprintSpeed: 2,
    sprintAcceleration: 1,
  });
  assert.equal(route.status, 'complete');
  if (route.status === 'complete') {
    assert.equal(route.cost, 1);
    assert.deepEqual(route.goalHit, { segment: 1, time: 0.5, position: [2, 0, 0] });
  }
});

test('composition retains bounded-search uncertainty from any constituent', () => {
  const piece: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'entry',
    arrivalCost: 0,
    cost: 1,
    length: 1,
    points: [
      [0, 0, 0],
      [1, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        times: [0, 1],
      },
    ],
    search: { truncated: true, expanded: 3, maxLabels: 4, maxExpanded: 3 },
  };
  const route = composeRoutes([piece], { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 });
  assert.equal(route.status, 'complete');
  if (route.status === 'complete') assert.deepEqual(route.search, piece.search);
});

test('walking goal evidence follows a stamina-induced gait split', () => {
  const input: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'entry',
    arrivalCost: 0,
    cost: 20,
    length: 20,
    points: [
      [0, 0, 0],
      [20, 0, 0],
    ],
    segments: [
      {
        mode: 'walk',
        points: [
          [0, 0, 0],
          [20, 0, 0],
        ],
        times: [0, 20],
      },
    ],
    goalHit: { segment: 0, time: 20, position: [20, 0, 0] },
  };
  const result = composeRoutes([input], {
    speed: 1,
    sprintSpeed: 2,
    sprintAcceleration: 1,
    stamina: {
      capacity: 1,
      initial: 1,
      sprintDrain: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  });
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') {
    assert.equal(result.segments.length, 2);
    assert.equal(result.cost, 19.5);
    assert.deepEqual(result.goalHit, { segment: 1, time: 18.5, position: [20, 0, 0] });
  }
});

const placedPiece = (
  x: number,
  placements?: Extract<Route, { status: 'complete' }>['placements'],
): Extract<Route, { status: 'complete' }> => ({
  status: 'complete',
  start: 'entry',
  arrivalCost: 0,
  cost: 1,
  length: 1,
  points: [
    [x, 0, 0],
    [x + 1, 0, 0],
  ],
  segments: [
    {
      mode: 'walk',
      points: [
        [x, 0, 0],
        [x + 1, 0, 0],
      ],
      times: [0, 1],
    },
  ],
  placements,
});
const compositionMovement = { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 };

test('composition deduplicates identical complete layouts independently of declaration order', () => {
  const a = { device: 'a', position: [4, 0, 0] as [number, number, number] };
  const b = { device: 'b', position: [6, 0, 0] as [number, number, number] };
  const pieces = [placedPiece(0, [a, b, a]), placedPiece(1, [b, a])];
  const before = structuredClone(pieces);
  const result = composeRoutes(pieces, compositionMovement);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.deepEqual(result.placements, [a, b]);
  assert.deepEqual(pieces, before);
});

test('composition rejects conflicting bindings within a piece and across pieces', () => {
  const a = { device: 'box', position: [4, 0, 0] as [number, number, number] };
  const b = { device: 'box', position: [6, 0, 0] as [number, number, number] };
  assert.equal(
    composeRoutes([placedPiece(0, [a, b])], compositionMovement).status,
    'no-verified-route',
  );
  assert.equal(
    composeRoutes([placedPiece(0, [a]), placedPiece(1, [b])], compositionMovement).status,
    'no-verified-route',
  );
});

test('a later box placement cannot invalidate the prefix by being silently merged', () => {
  // The tail's box occupies the prefix corridor. Composition has no geometry
  // evidence that the prefix remains valid under this new placement.
  const box = { device: 'box', position: [0.5, 0, 0] as [number, number, number] };
  const prefix = placedPiece(0);
  const tail = placedPiece(1, [box]);
  assert.equal(composeRoutes([prefix], compositionMovement).status, 'complete');
  assert.equal(composeRoutes([tail], compositionMovement).status, 'complete');
  assert.equal(composeRoutes([prefix, tail], compositionMovement).status, 'no-verified-route');
  assert.equal(
    composeRoutes([placedPiece(0, [box]), placedPiece(1)], compositionMovement).status,
    'no-verified-route',
  );
});
