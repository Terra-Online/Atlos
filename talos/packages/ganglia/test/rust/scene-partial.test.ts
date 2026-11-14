import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

test('Rust scene publishes a replayable terminal partial when its original prefix is unavailable', async () => {
  const floor: Surface = {
    id: 'approach',
    vertices: [
      [0, 0, -2],
      [4, 0, -2],
      [4, 0, 2],
      [0, 0, 2],
    ],
  };
  const v = floor.vertices;
  const input: PhysicalInput = {
    ground: {
      surfaces: [floor],
      options: { speed: 7, maxVertical: 0.5, walls: [], profile: { radius: 0.3, height: 1.7 } },
    },
    collision: {
      positions: [v[0], v[2], v[1], v[0], v[3], v[2]].flat(),
      indices: [0, 1, 2, 3, 4, 5],
    },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 10,
        maxJumpHeight: 2,
        maxFallingSpeed: 20,
        apexTime: 0.2,
        maxHorizontalSpeed: 6.5,
        startHorizontalSpeed: 6.5,
        airAcceleration: 10,
        airDeceleration: 10,
        airOverspeedDeceleration: 5,
      },
      maxSlope: 46,
      runAirSpeed: 6.5,
      stepUp: 0.5,
      stepDown: 0.5,
    },
    locomotion: { speed: 7, sprintSpeed: 7, sprintAcceleration: 10 },
  };
  const config = {
    ...gangliaV1Defaults,
    algorithm: 'ganglia-v1-rust' as const,
    maxCandidates: 64,
    maxShortcutCandidates: 0,
    maxAttempts: 1,
  };
  const approach: RouteQuery = {
    starts: [{ id: 'target-approach', position: [1, 0, 0], state: 'available', cost: 0 }],
    goal: [3, 1.9, 0],
    interaction: { airborne: true, radius: 0.7 },
  };
  // Generate the terminal with native physics, rather than hand-authoring a
  // trace that could accidentally bypass flight or goal certification.
  const physical = await prepareRouteSolver(config, { kind: 'physical', input });
  let terminal: RouteResult;
  try {
    terminal = await physical.solve(approach);
  } finally {
    await physical.close();
  }
  assert.ok(terminal.route.status === 'complete');
  const terminalRoute = terminal.route;
  assert.ok(terminalRoute.segments.some((segment) => segment.flight));
  const verify = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')]);
  const replay = verify(approach, terminal.route);
  assert.equal(replay.valid, true, replay.issues.join('; '));

  const original: RouteQuery = {
    ...approach,
    starts: [{ id: 'player', position: [-30, 0, 0], state: 'available', cost: 0 }],
  };
  const order: string[] = [];
  const published: RouteResult[] = [];
  // Coarse navigation proposes a prefix, but the complete physical snapshot
  // has no support at the player's start. Only the target approach is feasible.
  const coarse: Surface = {
    ...floor,
    id: 'coarse',
    vertices: [
      [-32, 0, -2],
      [4, 0, -2],
      [4, 0, 2],
      [-32, 0, 2],
    ],
  };
  const solver = await prepareRouteSolver(config, {
    kind: 'scene',
    scene: {
      scene: 'terminal-partial',
      source: null,
      walls: [],
      navigation: { surfaces: [coarse], options: { speed: 7, maxVertical: 0.5 } },
    },
    locomotion: input.locomotion,
    resources: {
      terminals: async () => [
        {
          id: 'native-terminal',
          route: terminalRoute,
        },
      ],
      query: async () => {
        order.push('window');
        return { status: 'ready' as const };
      },
      physical: async () => ({
        input,
        revision: 'terminal-partial/1',
        coverage: 'complete' as const,
      }),
      solve: async () => {
        throw new Error('TypeScript solving must not run');
      },
      ground: async () => {
        throw new Error('TypeScript ground preparation must not run');
      },
      key: () => 'terminal-partial/1',
      route: () => ({}),
      wait: async () => {},
    },
  });
  try {
    const result = await solver.solve(original, {
      onEvent: (event) => {
        if (event.type === 'candidate' && event.result.partial) {
          order.push('partial');
          published.push(event.result);
        }
      },
    });
    assert.equal(result.partial, true);
    assert.ok(result.route.status === 'complete', 'the partial must retain the terminal witness');
    assert.ok(
      order.includes('window'),
      'native search must attempt the unavailable original prefix',
    );
    assert.ok(
      order.indexOf('partial') < order.indexOf('window'),
      'publish the partial before prefix IO',
    );
    assert.ok(published.length > 0);
    for (const candidate of [...published, result]) {
      assert.equal(candidate.partial, true);
      const evaluation = verify(approach, candidate.route);
      assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
      assert.equal(
        verify(original, candidate.route).valid,
        false,
        'an approach is not a completed original query',
      );
    }

    const controller = new AbortController();
    const before = order.filter((item) => item === 'window').length;
    let sawPartial = false;
    await assert.rejects(
      solver.solve(original, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'candidate' && event.result.partial) {
            sawPartial = true;
            controller.abort();
          }
        },
      }),
      { name: 'AbortError' },
    );
    assert.equal(sawPartial, true);
    assert.equal(
      order.filter((item) => item === 'window').length,
      before,
      'cancellation follows publication and precedes further IO',
    );
  } finally {
    await solver.close();
  }
});
