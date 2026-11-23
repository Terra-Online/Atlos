import type { PhysicalInput } from '#@/src/solver/physical.ts';

export const physical: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [-5, 0, -5],
          [5, 0, -5],
          [5, 0, 5],
          [-5, 0, 5],
        ],
      },
    ],
    options: { speed: 5, maxVertical: 0.3, profile: { radius: 0.3, height: 1.7 }, walls: [] },
  },
  collision: {
    positions: new Float64Array([-5, 0, -5, 5, 0, -5, 5, 0, 5, -5, 0, 5]),
    indices: new Uint32Array([0, 2, 1, 0, 3, 2]),
  },
  movement: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 2,
      maxFallingSpeed: 20,
      apexTime: 0.2,
      maxHorizontalSpeed: 5,
      startHorizontalSpeed: 5,
      airAcceleration: 10,
      airDeceleration: 10,
      airOverspeedDeceleration: 5,
    },
    maxSlope: 46,
    runAirSpeed: 5,
    stepUp: 0.3,
    stepDown: 0.3,
  },
  locomotion: { speed: 5, sprintSpeed: 7, sprintAcceleration: 10 },
};
