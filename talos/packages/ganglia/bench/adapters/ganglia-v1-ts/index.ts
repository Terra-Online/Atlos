import type { BenchmarkAdapter } from '#@/bench/adapter.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';

export const adapter: BenchmarkAdapter = {
  defaults: { ...gangliaV1Defaults, algorithm: 'ganglia-v1-ts' },
  entry: new URL('../ganglia-v1/worker.ts', import.meta.url),
  catalogTraining: true,
};
