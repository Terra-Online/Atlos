import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Arrival, Edge, Node } from '#@/src/v1/route/routes.ts';
import { createLazyRoutePlanner } from '#@/src/v1/search/lazy-route.ts';
const nodes: Node[] = [
  { id: 'a', position: [0, 0, 0] },
  { id: 'b', position: [1, 0, 0] },
];
const edge = (cost: number, connection: string, state: Edge['state'] = 'unknown'): Edge => ({
  from: 'a',
  to: 'b',
  cost,
  connection,
  state,
  points: nodes.map((node) => node.position),
});
const starts: Arrival[] = [{ id: 'start', node: 'a', cost: 0, state: 'available' }];
test('replans parallel candidates after rejection and increased cost, preserving selected evidence', async () => {
  const planner = createLazyRoutePlanner({
    nodes,
    edges: [edge(1, 'blocked'), edge(2, 'slow'), edge(4, 'ready', 'open')],
  });
  const seen: (string | undefined)[] = [];
  const result = await planner.plan(starts, 'b', {
    validate: async (e) => {
      seen.push(e.connection);
      return e.connection === 'blocked' ? null : { ...e, cost: 5, state: 'open' };
    },
  });
  assert.deepEqual(seen, ['blocked', 'slow']);
  assert.equal(result.route!.cost, 4);
  assert.equal(result.route!.segments[0].connection, 'ready');
});
test('budget exhaustion has no executable route and resumes cached validation', async () => {
  const planner = createLazyRoutePlanner({ nodes, edges: [edge(1, 'first'), edge(2, 'second')] });
  const first = await planner.plan(starts, 'b', { maxValidations: 1, validate: async () => null });
  assert.equal(first.status, 'incomplete');
  assert.equal(first.route, undefined);
  assert.equal(first.validation.pending, 1);
  const next = await planner.plan(starts, 'b', {
    validate: async (e) => ({ ...e, state: 'open' }),
  });
  assert.ok(next.status === 'complete');
  assert.equal(next.validation.attempted, 1);
  assert.equal(next.route!.segments[0].connection, 'second');
});
test('validator errors and cancelled validation remain retryable', async () => {
  const planner = createLazyRoutePlanner({ nodes, edges: [edge(1, 'retry')] });
  await assert.rejects(
    planner.plan(starts, 'b', {
      validate: async () => {
        throw new Error('temporary');
      },
    }),
    /temporary/,
  );
  const controller = new AbortController();
  const cancelled = await planner.plan(starts, 'b', {
    signal: controller.signal,
    validate: async () => {
      controller.abort();
      return null;
    },
  });
  assert.equal(cancelled.reason, 'aborted');
  assert.equal(cancelled.validation.pending, 1);
  await assert.rejects(
    planner.plan(starts, 'b', { validate: async (e) => ({ ...e, state: 'open', cost: 0 }) }),
    /lower bound/,
  );
  const result = await planner.plan(starts, 'b', {
    validate: async (e) => ({ ...e, state: 'open' }),
  });
  assert.ok(result.status === 'complete');
});
test('rejects a validated trajectory disconnected from its graph endpoint and permits retry', async () => {
  const planner = createLazyRoutePlanner({ nodes, edges: [edge(1, 'physical')] });
  await assert.rejects(
    planner.plan(starts, 'b', {
      validate: async (e) => ({
        ...e,
        state: 'open',
        points: [
          [0, 1, 0],
          [1, 0, 0],
        ],
      }),
    }),
    /Invalid corridor/,
  );
  const result = await planner.plan(starts, 'b', {
    validate: async (e) => ({ ...e, state: 'open' }),
  });
  assert.deepEqual(result.route!.segments[0].points[0], nodes[0].position);
});
