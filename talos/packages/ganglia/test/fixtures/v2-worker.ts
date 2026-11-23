import { serveWorker } from '#@/bench/adapters/ganglia-v1/worker-host.ts';
import { createTimings } from '#@/bench/timings.ts';
import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import {
  gangliaV2LibraryPath,
  prepareGangliaV2,
  type V2PreparedSolver,
} from '#@/src/solver/ganglia-v2-rust.ts';
import type { GangliaV2Config } from '#@/src/solver/ganglia-v2.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

serveWorker(async (setup) => {
  let solver: V2PreparedSolver | undefined;
  return {
    input: { kind: 'physical', input: physical },
    inputLoadMs: 0,
    timings: createTimings(),
    nativeLibrary: gangliaV2LibraryPath(),
    async prepareSolver() {
      solver = await prepareGangliaV2(setup.config as GangliaV2Config, physical, []);
      return solver;
    },
    preparationStats: () => solver!.preparationStats(),
    verifyInputs() {},
    verify: async (query, route) =>
      createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(query, route),
    metadata: {
      scene: 'flat-v2',
      source: {},
      hashes: {},
      gameAdapterSha256: 'test',
      kernelSha256: 'test',
      resolvedKernel: import.meta.url,
      inputBytes: 0,
      rules: { maxVertical: physical.ground.options.maxVertical },
      execution: { mode: 'inline', workers: 0, lanes: 1 },
    },
  };
});
