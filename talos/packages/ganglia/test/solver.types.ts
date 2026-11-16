import {
  type RouteQuery,
  type RouteResult,
  type SceneInput,
  prepareRouteSolver,
  gangliaV1Defaults,
} from '@opendfieldmap/ganglia';

async function checkSolverContract(input: SceneInput, query: RouteQuery) {
  const solver = await prepareRouteSolver(gangliaV1Defaults, { kind: 'surfaces', input });
  const single: RouteResult = await solver.solve(query);
  const batch: readonly RouteResult[] = await solver.solveBatch([query]);

  // @ts-expect-error Search policy is fixed when the solver is created.
  await solver.solve({ ...query, config: { maxCandidates: 512 } });
  // @ts-expect-error A batch accepts requests rather than bare target positions.
  await solver.solveBatch([query.goal]);
  await prepareRouteSolver(
    // @ts-expect-error Candidate budgets must be numeric.
    { ...gangliaV1Defaults, maxCandidates: '512' },
    { kind: 'surfaces', input },
  );
  // @ts-expect-error Algorithm policies are immutable on a prepared solver.
  solver.config.maxCandidates = 512;
  await prepareRouteSolver(
    // @ts-expect-error The factory accepts only implemented algorithm configurations.
    { ...gangliaV1Defaults, algorithm: 'other' },
    { kind: 'surfaces', input },
  );

  await solver.close();
  return { single, batch };
}

void checkSolverContract;
