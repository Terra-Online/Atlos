/**
 * A report owns a fresh in-memory SQLite database. The left and right files
 * become the baseline and candidate rows. Scenario, case and round keys are
 * scoped to a run. Strict comparison checks the recorded workload and how
 * it was measured. Solver settings, revision and observed outcomes are data
 * for the comparison. A caller-supplied SELECT defines its own pairing.
 */
import { constants, DatabaseSync, type SQLOutputValue } from 'node:sqlite';

import { parseBenchmarkRun } from '#@/bench/benchmark-run.ts';

const schema = `
  CREATE TABLE runs (
    run_id TEXT PRIMARY KEY,
    benchmark_id TEXT NOT NULL,
    suite_id TEXT NOT NULL,
    git_revision TEXT NOT NULL,
    solver_id TEXT NOT NULL,
    solver_settings_json TEXT NOT NULL,
    state TEXT NOT NULL,
    failure_reason TEXT,
    cutoff_ms INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    scenario_workers INTEGER NOT NULL,
    solver_workers INTEGER NOT NULL,
    query_concurrency INTEGER NOT NULL,
    dispatch TEXT NOT NULL,
    timing TEXT NOT NULL,
    warmup_queries_json TEXT NOT NULL
  ) STRICT;

  CREATE TABLE scenarios (
    run_id TEXT REFERENCES runs(run_id),
    scenario_id TEXT,
    position INTEGER NOT NULL,
    setup_json TEXT NOT NULL,
    initial_input_json TEXT,
    input_changed INTEGER NOT NULL,
    training_json TEXT NOT NULL,
    PRIMARY KEY (run_id, scenario_id)
  ) STRICT;

  CREATE TABLE cases (
    run_id TEXT,
    scenario_id TEXT,
    case_id TEXT,
    position INTEGER NOT NULL,
    query_json TEXT,
    requirements_json TEXT,
    expectation_json TEXT,
    preparation_error TEXT,
    PRIMARY KEY (run_id, scenario_id, case_id),
    FOREIGN KEY (run_id, scenario_id) REFERENCES scenarios(run_id, scenario_id)
  ) STRICT;

  CREATE TABLE attempts (
    run_id TEXT,
    scenario_id TEXT,
    case_id TEXT,
    round INTEGER,
    status TEXT NOT NULL,
    solve_ms REAL NOT NULL,
    route_cost_seconds REAL,
    verification TEXT NOT NULL,
    matches_expectation INTEGER,
    reason TEXT,
    PRIMARY KEY (run_id, scenario_id, case_id, round),
    FOREIGN KEY (run_id, scenario_id, case_id) REFERENCES cases(run_id, scenario_id, case_id)
  ) STRICT;
`;

// JSON object key order does not identify an input. Array order does.
const json = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );

function importRun(db: DatabaseSync, runId: 'baseline' | 'candidate', report: unknown) {
  try {
    const run = parseBenchmarkRun(report);
    const settings = run.measurement;
    db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      runId,
      run.benchmarkId,
      run.suiteId,
      run.gitRevision,
      run.solverId,
      json(run.solverSettings),
      run.state.kind,
      run.state.kind === 'failed' ? run.state.reason : null,
      settings.cutoffMs,
      settings.rounds,
      settings.scenarioWorkers,
      settings.solverWorkers,
      settings.queryConcurrency,
      settings.dispatch,
      settings.timing,
      json(settings.warmupQueries),
    );
    const scenarioRow = db.prepare('INSERT INTO scenarios VALUES (?, ?, ?, ?, ?, ?, ?)');
    const caseRow = db.prepare('INSERT INTO cases VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const attemptRow = db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [position, scenario] of run.scenarios.entries()) {
      const { scenarioId } = scenario;
      scenarioRow.run(
        runId,
        scenarioId,
        position + 1,
        json(scenario.setup),
        scenario.initialInput === null ? null : json(scenario.initialInput),
        Number(scenario.inputChanged),
        json(scenario.training),
      );
      for (const [position, test] of scenario.cases.entries()) {
        const { caseId } = test;
        caseRow.run(
          runId,
          scenarioId,
          caseId,
          position + 1,
          test.query === null ? null : json(test.query),
          test.requirements === undefined ? null : json(test.requirements),
          test.expectation === undefined ? null : json(test.expectation),
          test.preparationError ?? null,
        );
        for (const [round, attempt] of test.attempts.entries())
          attemptRow.run(
            runId,
            scenarioId,
            caseId,
            round + 1,
            attempt.status,
            attempt.solveMs,
            attempt.status === 'success' ? attempt.routeCostSeconds : null,
            attempt.verification,
            attempt.matchesExpectation === undefined ? null : Number(attempt.matchesExpectation),
            attempt.status === 'success' ? null : (attempt.reason ?? null),
          );
      }
    }
  } catch (error) {
    throw new Error(`Invalid ${runId} report: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
}

const strictProblems = `
  SELECT run_id || ' run is ' || state AS problem FROM runs WHERE state <> 'finished'
  UNION ALL
  SELECT 'benchmark or suite differs' FROM runs b, runs c
  WHERE b.run_id = 'baseline' AND c.run_id = 'candidate'
    AND (b.benchmark_id, b.suite_id) IS NOT (c.benchmark_id, c.suite_id)
  UNION ALL
  SELECT 'measurement settings differ' FROM runs b, runs c
  WHERE b.run_id = 'baseline' AND c.run_id = 'candidate'
    AND (b.cutoff_ms, b.rounds, b.scenario_workers, b.solver_workers, b.query_concurrency,
         b.dispatch, b.timing, b.warmup_queries_json)
      IS NOT
        (c.cutoff_ms, c.rounds, c.scenario_workers, c.solver_workers, c.query_concurrency,
         c.dispatch, c.timing, c.warmup_queries_json)
  UNION ALL
  SELECT run_id || ' scenario ' || scenario_id || ' has no input snapshot'
  FROM scenarios
  WHERE initial_input_json IS NULL
    OR NOT EXISTS (SELECT 1 FROM json_each(initial_input_json, '$.fileDigests'))
  UNION ALL
  SELECT run_id || ' scenario ' || scenario_id || ' changed inputs during the run'
  FROM scenarios WHERE input_changed = 1
  UNION ALL
  SELECT 'scenario ' || coalesce(b.scenario_id, c.scenario_id) || ' differs in setup or order'
  FROM (SELECT * FROM scenarios WHERE run_id = 'baseline') b
  FULL OUTER JOIN (SELECT * FROM scenarios WHERE run_id = 'candidate') c USING (scenario_id)
  WHERE (b.position, b.setup_json, b.initial_input_json, b.training_json)
    IS NOT (c.position, c.setup_json, c.initial_input_json, c.training_json)
  UNION ALL
  SELECT t.run_id || ' case ' || t.scenario_id || '/' || t.case_id || ' has incomplete measurement'
  FROM cases t JOIN runs r USING (run_id)
  LEFT JOIN attempts a USING (run_id, scenario_id, case_id)
  GROUP BY t.run_id, t.scenario_id, t.case_id
  HAVING t.query_json IS NULL OR t.preparation_error IS NOT NULL OR count(a.round) <> r.rounds
  UNION ALL
  SELECT 'case ' || coalesce(b.scenario_id, c.scenario_id) || '/' ||
    coalesce(b.case_id, c.case_id) || ' differs in definition or order'
  FROM (SELECT * FROM cases WHERE run_id = 'baseline') b
  FULL OUTER JOIN (SELECT * FROM cases WHERE run_id = 'candidate') c USING (scenario_id, case_id)
  WHERE (b.position, b.query_json, b.requirements_json, b.expectation_json)
    IS NOT (c.position, c.query_json, c.requirements_json, c.expectation_json)
  ORDER BY problem
`;

const strictQuery = `
  SELECT b.scenario_id || ' / ' || b.case_id AS "Case",
    b.round AS "Round",
    (CASE WHEN b.status = c.status THEN b.status ELSE b.status || ' → ' || c.status END) ||
    (CASE WHEN b.verification IN ('invalid', 'error') OR c.verification IN ('invalid', 'error')
        OR (b.status = 'success' AND c.status = 'success' AND b.verification <> c.verification)
      THEN ' · verification: ' ||
        CASE WHEN b.verification = c.verification THEN b.verification
          ELSE b.verification || ' → ' || c.verification END
      ELSE '' END) ||
    (CASE WHEN b.matches_expectation = 0 OR c.matches_expectation = 0
      THEN ' · expectation missed (' ||
        CASE WHEN b.matches_expectation = 0 AND c.matches_expectation = 0 THEN 'both'
          WHEN b.matches_expectation = 0 THEN 'baseline' ELSE 'candidate' END || ')'
      ELSE '' END) AS "Result",
    printf('%.12g → %.12g', round(b.solve_ms, 3), round(c.solve_ms, 3)) AS "Solve (ms)",
    CASE WHEN b.status = 'success' AND c.status = 'success'
      THEN round(b.solve_ms / nullif(c.solve_ms, 0), 3) || '×' END AS "Speedup",
    CASE WHEN b.route_cost_seconds IS c.route_cost_seconds THEN b.route_cost_seconds
      ELSE coalesce(CAST(b.route_cost_seconds AS TEXT), 'n/a') || ' → ' ||
        coalesce(CAST(c.route_cost_seconds AS TEXT), 'n/a') END AS "Route cost (s)"
  FROM attempts b JOIN attempts c USING (scenario_id, case_id, round)
  JOIN scenarios s ON s.run_id = b.run_id AND s.scenario_id = b.scenario_id
  JOIN cases t ON t.run_id = b.run_id AND t.scenario_id = b.scenario_id AND t.case_id = b.case_id
  WHERE b.run_id = 'baseline' AND c.run_id = 'candidate'
  ORDER BY s.position, t.position, b.round
`;

function cell(value: SQLOutputValue) {
  const text =
    value instanceof Uint8Array ? Buffer.from(value).toString('hex') : String(value ?? '');
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '&#92;')
    .replaceAll('|', '&#124;')
    .replaceAll('`', '&#96;')
    .replaceAll(/\r\n|\r|\n/g, '<br>');
}

export function renderBenchmarkReport(baseline: unknown, candidate: unknown, sql?: string) {
  using db = new DatabaseSync(':memory:');
  db.exec(schema);
  importRun(db, 'baseline', baseline);
  importRun(db, 'candidate', candidate);
  if (sql === undefined) {
    const problems = db.prepare(strictProblems).all();
    if (problems.length)
      throw new Error(
        'Reports are incompatible in strict mode:\n' + problems.map((r) => r.problem).join('\n'),
      );
  }

  db.setAuthorizer((action) =>
    action === constants.SQLITE_SELECT ||
    action === constants.SQLITE_READ ||
    action === constants.SQLITE_FUNCTION ||
    action === constants.SQLITE_RECURSIVE
      ? constants.SQLITE_OK
      : constants.SQLITE_DENY,
  );
  const query = sql ?? strictQuery;
  const statement = db.prepare(query);
  const tail = query.slice(statement.sourceSQL.length).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
  const columns = statement.columns().map(({ name }) => name);
  if (tail.trim() || !columns.length) throw new Error('Provide exactly one read-only SQL query');
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  const row = (values: SQLOutputValue[]) => `| ${values.map(cell).join(' | ')} |`;
  return [
    row(columns),
    row(columns.map(() => '---')),
    ...statement.all().map((values) => row(Object.values(values))),
  ].join('\n');
}
