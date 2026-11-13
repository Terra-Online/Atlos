import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildGroundSurfaces } from '#@/src/build.ts';
import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/index.ts';
import { createPhysicalPreparation } from '#@/src/solver/host.ts';
import { type PhysicalInput, gangliaV1Defaults } from '#@/src/solver/index.ts';
import { createGoalProjector } from '#@/src/v1/motion/goals.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { refineGoalGround } from '#@/src/v1/solver/ground-refinement.ts';

const floor = (id: string, left: number, right: number, height: number): Surface => ({
  id,
  vertices: [
    [left, height, -2],
    [left, height, 2],
    [right, height, 2],
    [right, height, -2],
  ],
});
const options = {
  profile: { radius: 0.35, height: 1.66 },
  maxSlope: 46,
  stepUp: 0.4,
  stepDown: 0.6,
  cellSize: 0.15,
  cellHeight: 0.05,
  bounds: { min: [-5, -3] as [number, number], max: [3, 3] as [number, number] },
};
const model = {
  gravity: 40,
  fallingGravity: 38,
  maxJumpHeight: 2.1,
  maxFallingSpeed: 80,
  apexTime: 0.1,
  maxHorizontalSpeed: 6.5,
};

test('recovers a body-width landing omitted by coarse erosion while preserving low headroom', async () => {
  for (const ceiling of [false, true]) {
    const faces = [floor('ground', -4, -1, 0), floor('narrow', 0, 0.8, 1.5)];
    if (ceiling) {
      faces.push({
        ...floor('ceiling', -0.5, 1.4, 2.8),
        vertices: floor('ceiling', -0.5, 1.4, 2.8).vertices.toReversed(),
      });
    }
    const triangles = faces.flatMap((surface) => [
      [surface.vertices[0], surface.vertices[1], surface.vertices[2]],
      [surface.vertices[0], surface.vertices[2], surface.vertices[3]],
    ]);
    const positions = triangles.flat(2);
    const geometry = {
      positions,
      indices: Array.from({ length: positions.length / 3 }, (_, index) => index),
    };
    const coarse = await buildGroundSurfaces(geometry, options);
    const before = structuredClone(coarse);
    const goal: Vec3 = [0.4, 1.5, 0];
    assert.equal(createGoalProjector(coarse)(goal, { maxVertical: 0.15 }).length, 0);
    const refined = await refineGoalGround(geometry, coarse, {
      build: options,
      goal,
      model,
    });
    const planner = createGroundPlanner(coarse, {
      ...options,
      walls: [],
      speed: 5,
      maxVertical: 0.5,
    });
    const prepared = await refineGoalGround(geometry, coarse, {
      build: options,
      goal,
      model,
      project: planner.project,
    });
    assert.deepEqual(prepared, refined);
    const world = createCollisionWorld(geometry, { bounds: options.bounds });
    const indexed = await refineGoalGround(geometry, coarse, {
      build: options,
      goal,
      model,
      queryTriangles: world.trianglesInBounds?.bind(world),
    });
    assert.deepEqual(indexed, refined);
    const accessible = createGoalProjector([...coarse, ...refined.surfaces])(goal, {
      maxVertical: 0.15,
    });
    assert.equal(accessible.length > 0, !ceiling);
    assert.deepEqual(coarse, before);
  }
});

test('refined physical queries remain independent across goals, walls and collision bindings', async () => {
  const faces = [floor('ground', -4, -1, 0), floor('narrow', 0, 0.8, 1.5)];
  const geometry = (surfaces: Surface[]) => ({
    positions: surfaces.flatMap((surface) => surface.vertices.flat()),
    indices: surfaces.flatMap((_, index) => [
      index * 4,
      index * 4 + 1,
      index * 4 + 2,
      index * 4,
      index * 4 + 2,
      index * 4 + 3,
    ]),
  });
  const collision = geometry(faces);
  const coarse = await buildGroundSurfaces(collision, options);
  const input: PhysicalInput = {
    ground: {
      surfaces: coarse,
      options: { ...options, walls: [], speed: 5, maxVertical: 0.5 },
      build: options,
    },
    collision,
    movement: {
      model: {
        ...model,
        startHorizontalSpeed: 6.5,
        airOverspeedDeceleration: 5,
        airAcceleration: 60,
        airDeceleration: 10,
      },
      maxSlope: options.maxSlope,
      stepUp: options.stepUp,
      stepDown: options.stepDown,
      runAirSpeed: 5,
    },
    locomotion: { speed: 5, sprintSpeed: 6.5, sprintAcceleration: 20 },
  };
  const preparation = createPhysicalPreparation();
  const config = { ...gangliaV1Defaults, maxCandidates: 128, maxShortcutCandidates: 16 };
  let addedSurfaces = 0;
  let refinementReused: boolean | undefined;
  const solve = (snapshot: PhysicalInput, binding: string, goal: Vec3) => {
    refinementReused = undefined;
    return preparation.solve(
      snapshot,
      {
        starts: [{ id: 'start', position: [-2, 0, 0], state: 'available', cost: 0 }],
        goal,
        interaction: { radius: 0.15, airborne: true },
      },
      {
        binding,
        config,
        onResult(_result, _optimizing, diagnostics) {
          if (diagnostics && typeof diagnostics === 'object' && 'prepareReuse' in diagnostics) {
            const reuse = diagnostics.prepareReuse;
            if (reuse && typeof reuse === 'object' && 'refinement' in reuse)
              refinementReused = reuse.refinement === true;
          }
          if (diagnostics && typeof diagnostics === 'object' && 'refinement' in diagnostics) {
            const refinement = diagnostics.refinement;
            if (
              refinement &&
              typeof refinement === 'object' &&
              'addedSurfaces' in refinement &&
              typeof refinement.addedSurfaces === 'number'
            )
              addedSurfaces = Math.max(addedSurfaces, refinement.addedSurfaces);
          }
        },
      },
    );
  };
  const goal: Vec3 = [0.4, 1.5, 0];
  try {
    const first = await solve(input, 'open', goal);
    assert.equal(first.route.status, 'complete');
    assert.ok(addedSurfaces > 0);
    assert.equal(refinementReused, false);
    const otherGoal: Vec3 = [0.4, 1.5, 1];
    const other = await solve(input, 'open', otherGoal);
    assert.equal(other.route.status, 'complete');
    assert.equal(refinementReused, false);
    if (other.route.status === 'complete') {
      const hit = other.route.goalHit;
      assert.ok(hit);
      assert.ok(
        Math.hypot(...hit.position.map((value, axis) => value - otherGoal[axis])) <= 0.15 + 1e-8,
      );
    }
    assert.deepEqual(await solve(input, 'open', goal), first);
    assert.equal(refinementReused, true);
    assert.equal((await solve(input, 'open', [0.4, 1.5, -1])).route.status, 'complete');
    assert.equal(refinementReused, false);
    // A hit does not refresh FIFO order. Admitting the third target evicts the
    // first graph while preserving the result when that graph is rebuilt.
    assert.deepEqual(await solve(input, 'open', goal), first);
    assert.equal(refinementReused, false);
    const blocked: PhysicalInput = {
      ...input,
      ground: {
        ...input.ground,
        options: {
          ...input.ground.options,
          walls: [{ min: [-0.9, -1, -20], max: [-0.8, 10, 20], state: 'active' }],
        },
      },
    };
    assert.notEqual((await solve(blocked, 'blocked-wall', goal)).route.status, 'complete');
    assert.equal(refinementReused, false);
    const ceiling = floor('ceiling', -0.5, 1.4, 2.8);
    const covered = {
      ...input,
      collision: geometry([...faces, { ...ceiling, vertices: ceiling.vertices.toReversed() }]),
    };
    assert.notEqual((await solve(covered, 'low-ceiling', goal)).route.status, 'complete');
    assert.equal(refinementReused, false);
    assert.deepEqual(await solve(input, 'open-again', goal), first);
    assert.equal(refinementReused, false);
    preparation.clear();
    assert.deepEqual(await solve(input, 'open-again', goal), first);
    assert.equal(refinementReused, false);
  } finally {
    preparation.clear();
  }
});
