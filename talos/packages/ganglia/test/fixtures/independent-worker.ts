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
