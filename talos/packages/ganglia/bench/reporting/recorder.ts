/**
 * Both runners record through this module. Selection is known before loading a
 * Scenario, so unprepared Cases remain visible without a measured attempt.
 * Capture the initial snapshot before training can grow dynamic inputs, then
 * check it again after the Scenario finishes. An interrupted Run stays
 * interrupted while its runner drains Workers and writes its final report.
 */
import { isAbsolute, relative, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { z } from 'zod';

import { QUERY_CUTOFF_MS } from '#@/bench/cutoff.ts';
import { classify, type Verification } from '#@/bench/outcome.ts';
import type { BenchmarkRun } from '#@/bench/reporting/run.ts';
import type { Scenario } from '#@/bench/scenario.ts';
import type { RouteResult, SolverSettings } from '#@/src/solver/contract.ts';

type ScenarioResult = BenchmarkRun['scenarios'][number];
type CaseResult = ScenarioResult['cases'][number];
type Selection = Pick<ScenarioResult, 'scenarioId' | 'setup'> & {
  cases: readonly Pick<CaseResult, 'caseId' | 'requirements' | 'expectation'>[];
};
type Options = Pick<BenchmarkRun, 'benchmarkId' | 'suiteId' | 'gitRevision'> & {
  solverSettings: SolverSettings;
  measurement: Omit<BenchmarkRun['measurement'], 'cutoffMs' | 'timing' | 'warmupQueries'>;
  scenarios: readonly Selection[];
};

// Relative snapshot names identify input roles and region order across local copies.
const inputDigests = (scenario: Scenario, dataRoot: string) =>
  Object.fromEntries(
    Object.entries(scenario.input.metadata.hashes).map(([path, hash]) => [
      (isAbsolute(path) ? relative(dataRoot, path) : path).split(sep).join('/'),
      hash,
    ]),
  );

function measuredAttempt(
  result: RouteResult,
  verification: Verification['verification'],
  matchesExpectation?: boolean,
): CaseResult['attempts'][number] {
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

export function recordRun({ solverSettings, measurement, scenarios, ...identity }: Options) {
  const run: BenchmarkRun = {
    ...identity,
    solverId: solverSettings.algorithm,
    solverSettings: z.record(z.string(), z.json()).parse(solverSettings),
    state: { kind: 'running' },
    measurement: {
      cutoffMs: QUERY_CUTOFF_MS,
      ...measurement,
      timing: 'worker-dispatch-to-result',
      warmupQueries: [],
    },
    scenarios: scenarios.map(({ scenarioId, setup, cases }) => ({
      scenarioId,
      setup,
      initialInput: null,
      inputChanged: false,
      training: [],
      cases: cases.map(({ caseId, requirements, expectation }) => ({
        caseId,
        query: null,
        attempts: [],
        requirements,
        expectation,
      })),
    })),
  };
  const byId = new Map(
    run.scenarios.map((scenario) => [
      scenario.scenarioId,
      { scenario, cases: new Map(scenario.cases.map((item) => [item.caseId, item])) },
    ]),
  );
  const report: Readonly<BenchmarkRun> = run;
  return {
    report,
    preparationError(scenarioId: string, caseId: string, reason: string) {
      byId.get(scenarioId)!.cases.get(caseId)!.preparationError = reason;
    },
    startScenario(scenario: Scenario, dataRoot: string) {
      const { scenario: target, cases } = byId.get(scenario.id)!;
      const { source, gameAdapterSha256, rules } = scenario.input.metadata;
      // The game adapter describes the inputs. Solver revisions remain comparable.
      const fileDigests = inputDigests(scenario, dataRoot);
      target.initialInput = {
        source: z.json().parse(source ?? null),
        fileDigests,
        gameAdapterDigest: gameAdapterSha256,
        rules: { maxVertical: rules.maxVertical },
      };
      target.training = scenario.training.map(({ id, query }) => ({ caseId: id, query }));
      for (const item of scenario.cases) cases.get(item.id)!.query = item.query;
      return {
        attempt(
          item: { id: string },
          result: RouteResult,
          verification: Verification,
          matchesExpectation?: boolean,
        ) {
          cases
            .get(item.id)!
            .attempts.push(measuredAttempt(result, verification.verification, matchesExpectation));
        },
        finish() {
          target.inputChanged = !isDeepStrictEqual(fileDigests, inputDigests(scenario, dataRoot));
        },
      };
    },
    interrupt() {
      run.state = { kind: 'interrupted' };
    },
    finish(failure?: string) {
      if (run.state.kind !== 'interrupted')
        run.state =
          failure === undefined ? { kind: 'finished' } : { kind: 'failed', reason: failure };
    },
  };
}
