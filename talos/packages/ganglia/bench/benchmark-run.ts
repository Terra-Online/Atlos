/**
 * The common result is embedded as benchmarkRun in both runner reports. The
 * surrounding diagnostics have their own consumers. A run records selected
 * cases even before they resolve, and only records attempts that reached solve.
 * Request and training order carry meaning because a scenario reuses its solver.
 */
import { isAbsolute, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { classify, type Verification } from '#@/bench/outcome.ts';
import { routeQuerySchema } from '#@/bench/query-schema.ts';
import type { Scenario } from '#@/bench/scenario.ts';
import type { Case } from '#@/bench/suite.ts';
import type { RouteResult } from '#@/src/solver/contract.ts';

const id = z.string().min(1);
const reason = z.string().min(1);
const count = z.int().positive();
const duration = z.number().nonnegative();
const attempt = {
  solveMs: duration,
  verification: z.enum(['valid', 'invalid', 'error', 'not-run']),
  matchesExpectation: z.boolean().optional(),
};
const attemptSchema = z.discriminatedUnion('status', [
  z.strictObject({ ...attempt, status: z.literal('success'), routeCostSeconds: duration }),
  z.strictObject({
    ...attempt,
    status: z.enum(['no-route', 'timeout', 'error']),
    reason: z.string().optional(),
  }),
]);
const caseSchema = z.strictObject({
  caseId: id,
  query: routeQuerySchema.nullable(),
  requirements: z.json().optional(),
  expectation: z
    .strictObject({ kind: z.enum(['complete', 'reject', 'constraint']), assertions: z.array(id) })
    .optional(),
  preparationError: reason.optional(),
  attempts: z.array(attemptSchema),
});
const scenarioSchema = z.strictObject({
  scenarioId: id,
  setup: z.record(z.string(), z.json()),
  initialInput: z
    .strictObject({
      source: z.json(),
      fileDigests: z.record(id, id),
      gameAdapterDigest: id,
      rules: z.strictObject({ maxVertical: z.number() }),
    })
    .nullable(),
  inputChanged: z.boolean(),
  training: z.array(z.strictObject({ caseId: id, query: routeQuerySchema })),
  cases: z.array(caseSchema).min(1),
});

const runSchema = z.strictObject({
  benchmarkId: id,
  suiteId: id,
  gitRevision: id,
  solverId: id,
  solverSettings: z.record(z.string(), z.json()),
  state: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.enum(['running', 'finished', 'interrupted']) }),
    z.strictObject({ kind: z.literal('failed'), reason }),
  ]),
  measurement: z.strictObject({
    cutoffMs: count,
    rounds: count,
    scenarioWorkers: count,
    solverWorkers: count,
    queryConcurrency: count,
    dispatch: z.enum(['serial', 'batch']),
    timing: z.literal('worker-dispatch-to-result'),
    warmupQueries: z.array(routeQuerySchema),
  }),
  scenarios: z.array(scenarioSchema).min(1),
});

export type BenchmarkRun = z.infer<typeof runSchema>;
export type ScenarioResult = z.infer<typeof scenarioSchema>;

export function parseBenchmarkRun(report: unknown): BenchmarkRun {
  const parsed = z.object({ benchmarkRun: runSchema }).safeParse(report);
  if (!parsed.success) throw new Error('\n' + z.prettifyError(parsed.error));
  const { benchmarkRun: run } = parsed.data;
  for (const scenario of run.scenarios) {
    for (const test of scenario.cases) {
      if (
        test.attempts.length > run.measurement.rounds ||
        (test.attempts.length &&
          (scenario.initialInput === null || test.query === null || test.preparationError))
      )
        throw new Error(`Invalid attempts for ${scenario.scenarioId}/${test.caseId}`);
    }
  }
  return run;
}

export function selectedCase(item: Case): ScenarioResult['cases'][number] {
  return { caseId: item.id, query: null, attempts: [] };
}

export function captureScenario(target: ScenarioResult, scenario: Scenario, dataRoot: string) {
  const { source, gameAdapterSha256, rules } = scenario.input.metadata;
  // Paths identify local copies. The initial inputs are sampled before training
  // can append dynamic windows. Keep solver build identity out of this snapshot.
  target.initialInput = {
    source: z.json().parse(source ?? null),
    fileDigests: inputDigests(scenario, dataRoot),
    gameAdapterDigest: gameAdapterSha256,
    rules: { maxVertical: rules.maxVertical },
  };
  target.training = scenario.training.map(({ id, query }) => ({ caseId: id, query }));
  const cases = new Map(target.cases.map((item) => [item.caseId, item]));
  for (const item of scenario.cases) cases.get(item.id)!.query = item.query;
  return cases;
}

// Snapshot names identify input roles and region order across local copies.
const inputDigests = (scenario: Scenario, dataRoot: string) =>
  Object.fromEntries(
    Object.entries(scenario.input.metadata.hashes).map(([path, hash]) => [
      (isAbsolute(path) ? relative(dataRoot, path) : path).split(sep).join('/'),
      hash,
    ]),
  );

export function finishScenario(target: ScenarioResult, scenario: Scenario, dataRoot: string) {
  target.inputChanged = !isDeepStrictEqual(
    target.initialInput?.fileDigests,
    inputDigests(scenario, dataRoot),
  );
}

export function measuredAttempt(
  result: RouteResult,
  verification: Verification['verification'],
  matchesExpectation?: boolean,
): z.infer<typeof attemptSchema> {
  const solveMs = 'solveWallMs' in result.diagnostics ? result.diagnostics.solveWallMs : undefined;
  if (typeof solveMs !== 'number' || !Number.isFinite(solveMs) || solveMs < 0)
    throw new Error('Worker result is missing a valid solve time');
  const status = classify(result);
  const evidence = { solveMs, verification, matchesExpectation };
  if (status === 'success' && result.route.status === 'complete')
    return { ...evidence, status, routeCostSeconds: result.route.cost };
  if (status === 'success') throw new Error('Successful attempt is missing its complete route');
  return { ...evidence, status, reason: result.reason };
}
