import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { renderBenchmarkReport } from '#@/bench/reporting/query.ts';

async function readReport(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read report ${path}: ${error instanceof Error ? error.message : error}`,
      {
        cause: error,
      },
    );
  }
}

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      sql: { type: 'string' },
      'sql-file': { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'Usage: pnpm benchmark:report <baseline.json> <candidate.json> [--sql <query> | --sql-file <path>]\n' +
        'Strict comparison is the default. Custom SQL queries an in-memory SQLite database with\n' +
        'runs, scenarios, cases and attempts. The run_id values are baseline and candidate.\n' +
        'Output is a Markdown table.',
    );
  } else {
    if (positionals.length !== 2) throw new Error('Provide baseline and candidate report paths');
    if (values.sql !== undefined && values['sql-file'] !== undefined)
      throw new Error('Choose --sql or --sql-file');
    const [baseline, candidate, sql] = await Promise.all([
      readReport(positionals[0]),
      readReport(positionals[1]),
      values['sql-file'] === undefined ? values.sql : readFile(values['sql-file'], 'utf8'),
    ]);
    console.log(renderBenchmarkReport(baseline, candidate, sql));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
