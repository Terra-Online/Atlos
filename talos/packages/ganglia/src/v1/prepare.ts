import type { SolverInput, PreparedRouteSolver } from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import type { WindowJob } from '#@/src/solver/resources.ts';
import { prepareSurfaceActionSolver } from '#@/src/v1/solver/adapters/surface-action.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';
import { prepareSceneRouteSolver } from '#@/src/v1/solver/scene/prepared.ts';
export async function prepareGangliaV1<Source, Job extends WindowJob>(
  config: GangliaV1Config,
  input: SolverInput<Source, Job>,
): Promise<PreparedRouteSolver<GangliaV1Config>> {
  const fixed = snapshotGangliaV1Config(config);
  switch (input.kind) {
    case 'surfaces':
      return prepareSurfaceActionSolver(input.input, fixed);
    case 'physical':
      return preparePhysicalSolver(input.input, fixed);
    case 'scene':
      return prepareSceneRouteSolver(input.scene, input.resources, fixed, input.locomotion);
  }
}
/** Copy only supported fields so caller mutation cannot change a prepared policy. */
export function snapshotGangliaV1Config(config: GangliaV1Config): GangliaV1Config {
  const fixed: GangliaV1Config = {
    algorithm: config.algorithm,
    maxCandidates: config.maxCandidates,
    maxShortcutCandidates: config.maxShortcutCandidates,
    sampleSpacing: config.sampleSpacing,
    maxLinks: config.maxLinks,
    maxAttempts: config.maxAttempts,
    batchConcurrency: config.batchConcurrency,
    tileSpan: config.tileSpan,
    gridSpan: config.gridSpan,
    maxTiles: config.maxTiles,
    margin: config.margin,
    maxTargetError: config.maxTargetError,
  };
  if (fixed.algorithm !== 'ganglia-v1' && fixed.algorithm !== 'ganglia-v1-ts')
    throw new Error('Unsupported solver algorithm');
  for (const value of [fixed.maxCandidates, fixed.maxShortcutCandidates])
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('Invalid ganglia-v1 search budget');
  for (const value of [fixed.maxAttempts, fixed.batchConcurrency, fixed.maxTiles, fixed.maxLinks])
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid ganglia-v1 work limit');
  if (fixed.maxTiles > 512) throw new Error('Invalid ganglia-v1 tile limit');
  for (const value of [fixed.sampleSpacing, fixed.tileSpan, fixed.gridSpan, fixed.margin])
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid ganglia-v1 distance');
  if (!Number.isFinite(fixed.maxTargetError) || fixed.maxTargetError < 0)
    throw new Error('Invalid ganglia-v1 target tolerance');
  return Object.freeze(fixed);
}
