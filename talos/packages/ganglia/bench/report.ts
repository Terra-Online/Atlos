import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { benchmarkMarkdown, type MarkdownReport } from '#@/bench/markdown.ts';

const { values } = parseArgs({ options: { report: { type: 'string' } } });
if (!values.report) throw new Error('Usage: pnpm benchmark:markdown --report <benchmark.json>');
const report: MarkdownReport = JSON.parse(await readFile(values.report, 'utf8'));
if (
  !Array.isArray(report?.batch?.results) ||
  !Array.isArray(report.warmup?.ids) ||
  typeof report.queryCutoffMs !== 'number'
)
  throw new Error('Markdown rendering requires a full benchmark report');
console.log(benchmarkMarkdown(report));
