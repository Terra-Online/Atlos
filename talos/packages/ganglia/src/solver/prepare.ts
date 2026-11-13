import type { SolverInput, SolverConfig, PreparedRouteSolver } from '#@/src/solver/contract.ts';
import type { WindowJob } from '#@/src/solver/resources.ts';
import { prepareGangliaV1 } from '#@/src/v1/prepare.ts';
export async function prepareRouteSolver<Source, Job extends WindowJob>(
  config: SolverConfig,
  input: SolverInput<Source, Job>,
): Promise<PreparedRouteSolver> {
  switch (config.algorithm) {
    case 'ganglia-v1':
      return prepareGangliaV1(config, input);
    default:
      throw new Error('Unsupported solver algorithm');
  }
}
