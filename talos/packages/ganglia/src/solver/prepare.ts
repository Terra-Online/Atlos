import type { SolverInput, PreparedRouteSolver } from '#@/src/solver/contract.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import type { WindowJob } from '#@/src/solver/resources.ts';
import { prepareGangliaV1 } from '#@/src/v1/prepare.ts';
export async function prepareRouteSolver<Source, Job extends WindowJob>(
  config: SolverConfig,
  input: SolverInput<Source, Job>,
): Promise<PreparedRouteSolver<SolverConfig>> {
  switch (config.algorithm) {
    case 'ganglia-v1':
    case 'ganglia-v1-ts':
      return prepareGangliaV1(config, input);
    case 'ganglia-v1-rust': {
      const { prepareGangliaV1Rust } = await import('#@/src/solver/ganglia-v1-rust.ts');
      return prepareGangliaV1Rust(config, input);
    }
    default:
      throw new Error('Unsupported solver algorithm');
  }
}
