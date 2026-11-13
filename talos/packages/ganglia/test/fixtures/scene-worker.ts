import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RouteResult } from '@opendfieldmap/ganglia';

import { createTimings } from '#@/bench/timings.ts';
import { workerMemory, type WorkerRequest, type WorkerReply } from '#@/bench/workers.ts';
import { actionCatalogStats, setActionCatalogPhase } from '#@/src/v1/route/action-catalog.ts';

if (!process.send) throw new Error('Fixture requires a child process');
const send = (message: WorkerReply) => process.send!(message);
process.once('message', async (message: WorkerRequest) => {
  if (message.type !== 'setup') throw new Error('Fixture requires setup');
  const setup = message.setup;
  setActionCatalogPhase(setup.catalogPhase ?? 'disabled');
  if (setup.dataRoot === 'slow-start') await new Promise((resolve) => setTimeout(resolve, 80));
  if (setup.dataRoot === 'startup-failure') throw new Error('fixture startup failure');
  const metadata = {
    scene: 'fixture',
    source: { buildGuid: 'fixture', contentHash: 'fixture' },
    hashes: { ground: setup.dataRoot === 'mismatch' ? String(setup.index) : 'ground' } as Record<
      string,
      string
    >,
    gameAdapterSha256: 'adapter',
    kernelSha256: 'kernel',
    resolvedKernel: 'fixture',
    rules: { maxVertical: 0.5 },
    inputBytes: 1,
    execution: {
      mode: 'inline',
      workers: 0,
      lanes: 1,
      memory: { processRssSampledPeakBytes: 0, mainHeapUsedSampledPeakBytes: 0 },
    },
  };
  const regionFile = join(setup.dataRoot, 'fixture-region');
  if (setup.preparation) {
    try {
      metadata.hashes.region = await readFile(regionFile, 'utf8');
      metadata.inputBytes++;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  process.on('message', async (message: WorkerRequest) => {
    if (message.type === 'close') {
      if (setup.dataRoot === 'close-failure') process.exit(2);
      send({ type: 'closed' });
      process.disconnect();
      return;
    }
    if (message.type === 'catalog-phase' || message.type === 'benchmark-phase') {
      if (message.type === 'catalog-phase') setActionCatalogPhase(message.phase);
      send({ type: 'control', id: message.id, catalog: actionCatalogStats() });
      return;
    }
    if (message.type !== 'solve') throw new Error('Unexpected fixture setup');
    const { id, query, events } = message;
    if (query.goal[1] === 1) process.exit(2);
    if (query.goal[1] === 2) {
      send({ type: 'error', id, error: 'fixture failure' });
      return;
    }
    if (query.goal[1] === 6) {
      metadata.hashes.region = 'new-region';
      metadata.inputBytes++;
      if (setup.preparation) await writeFile(regionFile, 'new-region');
      send({ type: 'region', files: { ground: regionFile, collision: `${regionFile}.collision` } });
    }
    if (query.goal[1] === 7) metadata.hashes.ground = 'changed';
    if (query.goal[1] === 5) {
      spawn(
        process.execPath,
        [
          '-e',
          'setTimeout(()=>require("node:fs").writeFileSync(process.argv[1], "orphan"), 250)',
          query.starts[0].id,
        ],
        { stdio: 'ignore' },
      );
    }
    if (events) send({ type: 'event', id, event: { type: 'progress', phase: 'search' } });
    if (query.goal[1] >= 3) {
      const end = performance.now() + query.goal[0];
      while (performance.now() < end) {}
    } else await new Promise((resolve) => setTimeout(resolve, query.goal[0]));
    const result: RouteResult = {
      route: {
        status: 'complete',
        start: query.starts[0].id,
        arrivalCost: 1,
        cost: 1,
        length: 1,
        points: [query.goal],
        segments: [],
      },
      connections: [],
      diagnostics: { truncated: false },
      reason: String(process.pid),
    };
    const timings = createTimings();
    timings.normalizationMs = 2;
    timings.localSolveMs = 3;
    timings.physical.calls = 1;
    timings.physical.stagesMs.ground = 3;
    timings.physical.preparation.ground = { hits: 1, misses: 0 };
    send({
      type: 'result',
      id,
      result,
      timings,
      memory: workerMemory(),
      metadata,
      catalog: actionCatalogStats(),
    });
  });
  send({
    type: 'ready',
    config: setup.config,
    inputLoadMs: 1,
    preparationMs: 2,
    memory: workerMemory(),
    catalog: actionCatalogStats(),
    metadata,
  });
});
