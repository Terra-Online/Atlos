/**
 * The common result is embedded as benchmarkRun in both runner reports. The
 * surrounding diagnostics have their own consumers. A run records selected
 * cases even before they resolve, and only records attempts that reached solve.
 * Strict reports compare input, request and training order because a Scenario
 * reuses its solver. Decoding persisted reports is independent of live recording.
 */
import { z } from 'zod';

import { routeQuerySchema } from '#@/bench/query-schema.ts';

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
