import { createPhysicalWorld, createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
const input: PhysicalInput = {
  ground: {
    surfaces: [],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
  },
  collision: {
    positions: [-10, 0, -10, -10, 0, 10, 10, 0, 10, 10, 0, -10],
    indices: [0, 1, 2, 0, 2, 3],
  },
  movement: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 1,
      maxFallingSpeed: 10,
      apexTime: 0,
      maxHorizontalSpeed: 2,
      startHorizontalSpeed: 2,
      airOverspeedDeceleration: 10,
      airAcceleration: 10,
      airDeceleration: 10,
    },
    maxSlope: 45,
    runAirSpeed: 1,
    stepUp: 0.4,
    stepDown: 0.5,
  },
  locomotion: { speed: 1, sprintSpeed: 1, sprintAcceleration: 1 },
};
const world = createPhysicalWorld(input, 'complete');
const verify = createPhysicalVerifier(() => [world]);
import type { WorkerRequest, WorkerReply } from '#@/bench/workers.ts';
const send = (message: WorkerReply) => process.send!(message);
process.on('message', (message: WorkerRequest) => {
  if (message.type === 'setup')
    send({
      type: 'ready',
      config: message.setup.config,
      metadata: {
        scene: 'test',
        source: {},
        hashes: {},
        gameAdapterSha256: 'adapter',
        kernelSha256: 'independent',
        resolvedKernel: import.meta.url,
        rules: { maxVertical: 0.5 },
        inputBytes: 0,
        execution: { mode: 'inline', workers: 0, lanes: 1 },
      },
      inputLoadMs: 0,
      preparationMs: 0,
      memory: { rssBytes: 0, heapUsedBytes: 0 },
    });
  else if (message.type === 'verify')
    send({ type: 'verified', id: message.id, evaluation: verify(message.query, message.route) });
  else if (message.type === 'solve')
    send({
      type: 'result',
      id: message.id,
      result: {
        route: {
          status: 'complete',
          start: 'start',
          arrivalCost: 0,
          cost: 1,
          length: 1,
          points: [
            [0, 0.005, 0],
            [1, 0.005, 0],
          ],
          schedule: [
            {
              allowSprint: false,
              allowDash: false,
              segments: [
                {
                  mode: 'walk',
                  points: [
                    [0, 0.005, 0],
                    [1, 0.005, 0],
                  ],
                  times: [0, 1],
                },
              ],
            },
          ],
          segments: [
            {
              mode: 'walk',
              gait: 'run',
              points: [
                [0, 0.005, 0],
                [1, 0.005, 0],
              ],
              times: [0, 1],
            },
          ],
        },
        connections: [],
        diagnostics: { truncated: false },
      },
      timings: {
        preparationMs: 0,
        workerStartupMs: 0,
        normalizationMs: 0,
        localSolveMs: 0,
        physical: { calls: 0, stagesMs: {}, preparation: {} },
      },
      memory: { rssBytes: 0, heapUsedBytes: 0 },
    });
  else if (message.type === 'benchmark-phase') send({ type: 'control', id: message.id });
  else if (message.type === 'close') {
    send({ type: 'closed' });
    process.disconnect();
  }
});
