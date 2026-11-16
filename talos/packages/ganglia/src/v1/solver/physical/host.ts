import type { RouteQuery, RouteResult } from '#@/src/solver/contract.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { snapshotGangliaV1Config } from '#@/src/v1/prepare.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';
import { releaseSupportCaches } from '#@/src/v1/solver/physical/support-cache.ts';
import { physicalWorkPlan, type PhysicalWork } from '#@/src/v1/solver/physical/work.ts';

export {
  physicalWork,
  physicalWorkPlan,
  readPhysicalWork,
} from '#@/src/v1/solver/physical/work.ts';
export type { PhysicalWork } from '#@/src/v1/solver/physical/work.ts';

/** Resource hosts retain this preparation with their immutable input region.
 * Cache slots and dependent invalidation stay private to the solver. */
export function createPhysicalPreparation() {
  const cache = createPhysicalCache();
  let surfaces: PhysicalInput['ground']['surfaces'] | undefined;
  const clear = () => {
    cache.clear();
    if (surfaces) releaseSupportCaches(surfaces);
    surfaces = undefined;
  };
  return {
    clear,
    async solve(
      input: PhysicalInput,
      query: RouteQuery,
      options: {
        binding: string;
        config: SolverConfig;
        work?: PhysicalWork;
        signal?: AbortSignal;
        onProgress?: (progress: { phase: string; completed?: number; total?: number }) => void;
        onResult?: (
          result: RouteResult,
          optimizing: boolean,
          diagnostics: unknown,
        ) => void | Promise<void>;
      },
    ): Promise<RouteResult> {
      physicalWorkPlan(options.work);
      if (surfaces !== input.ground.surfaces) {
        clear();
        surfaces = input.ground.surfaces;
      }
      const solver = await preparePhysicalSolver(input, snapshotGangliaV1Config(options.config), {
        cache,
        generation: options.binding,
        effort: options.work?.step === 0 ? 'walking' : options.work?.step === 1 ? 'devices' : 'all',
        progress(progress) {
          if (typeof progress.phase === 'string')
            options.onProgress?.({ ...progress, phase: progress.phase });
        },
        observe: options.onResult,
      });
      try {
        return await solver.solve(query, { signal: options.signal });
      } finally {
        await solver.close();
      }
    },
  };
}

export {
  physicalTileSpan,
  physicalMargin,
  physicalCoverage,
} from '#@/src/v1/solver/physical/coverage.ts';

export { validateWaypoints } from '#@/src/v1/route/jump-planner.ts';
