import type { RouteResult } from '@opendfieldmap/ganglia';

export interface CoveragePass {
  pass: number;
  newRegions: number;
  generatedRegions: number;
}

export async function prepareCoverage(
  solveBatch: () => Promise<readonly RouteResult[]>,
  generatedRegionCount: () => number,
  onPass: (pass: CoveragePass) => void,
) {
  let pass = 0;
  for (;;) {
    const before = generatedRegionCount();
    const reports = await solveBatch();
    const generatedRegions = generatedRegionCount();
    const newRegions = generatedRegions - before;
    onPass({ pass: ++pass, newRegions, generatedRegions });
    // A later query can add an overlapping region preferred by an earlier one.
    // Only a fresh whole batch with unchanged inputs closes that coverage gap.
    if (newRegions === 0) return reports;
  }
}
