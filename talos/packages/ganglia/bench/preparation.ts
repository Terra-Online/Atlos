import type { BenchmarkAdapter } from '#@/bench/adapter.ts';
import type { Case } from '#@/bench/run.ts';
import type { SolverSettings } from '#@/src/solver/contract.ts';
import { validateServicePreparation } from '#@/src/solver/ganglia-v1.ts';

/** Bind algorithm startup policy to dataset-owned requests without changing the
 * scored population. Omitted CLI options cannot disable service preparation. */
export function benchmarkPreparation(
  config: SolverSettings,
  adapter: BenchmarkAdapter,
  scene: string,
): { training: readonly Case[]; warmup: readonly Case[] } {
  const v1 = ['ganglia-v1', 'ganglia-v1-ts', 'ganglia-v1-rust'].includes(config.algorithm);
  if (!v1 && !config.preparation) return { training: [], warmup: [] };
  validateServicePreparation(config.preparation);
  const policy = config.preparation!;
  const requests = adapter.preparation;
  if (!adapter.catalogTraining || !requests || requests.scene !== scene)
    throw new Error('Benchmark adapter must supply service preparation requests for this scene');
  if (
    requests.training.length < policy.trainingQueries ||
    requests.warmup.length < policy.warmupQueries
  )
    throw new Error('Benchmark preparation does not supply the configured request counts');
  return {
    training: requests.training.slice(0, policy.trainingQueries),
    warmup: requests.warmup.slice(0, policy.warmupQueries),
  };
}

export interface TrainedCatalog {
  ids: readonly string[];
  perWorker: readonly { stats: { phase: string } }[];
}

export function requirePreparedCatalog(
  config: SolverSettings,
  catalog: TrainedCatalog | undefined,
  warmup: readonly Case[],
) {
  const v1 = ['ganglia-v1', 'ganglia-v1-ts', 'ganglia-v1-rust'].includes(config.algorithm);
  if (!v1 && !config.preparation) return;
  validateServicePreparation(config.preparation);
  const policy = config.preparation!;
  if (
    catalog?.ids.length !== policy.trainingQueries ||
    !catalog.perWorker.length ||
    catalog.perWorker.some((worker) => worker.stats.phase !== 'frozen') ||
    warmup.length !== policy.warmupQueries
  )
    throw new Error('Benchmark requires trained, frozen catalogs and configured warmup requests');
}
