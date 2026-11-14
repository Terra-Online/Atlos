import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { benchmarkMarkdown, type MarkdownReport } from '#@/bench/markdown.ts';

const { values } = parseArgs({ options: { report: { type: 'string' } } });
if (!values.report) throw new Error('Usage: pnpm benchmark:markdown --report <benchmark.json>');
const report: MarkdownReport & { schemaVersion: number } = JSON.parse(
  await readFile(values.report, 'utf8'),
);
if (report.schemaVersion !== 8)
  throw new Error(
    'Markdown rendering requires benchmark schema 8; older reports remain usable as quality references',
  );
console.log(benchmarkMarkdown(report));
