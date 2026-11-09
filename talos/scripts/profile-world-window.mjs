import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Run with the extractor's Node version and --cpu-prof. The native profiler
// samples both trials without counting inspector start/stop work as solver CPU.
const { values } = parseArgs({ options: {
    log: { type: 'string' }, extractor: { type: 'string' }, output: { type: 'string' }, run: { type: 'string' },
} });
if (!values.log || !values.extractor || !values.output) {
    throw new Error('Usage: profile-world-window.mjs --log <progress.jsonl> --extractor <root> --output <directory> [--run <id>]');
}
const events = (await readFile(values.log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
const queued = events.findLast(event => event.command && (!values.run || event.run === values.run));
if (!queued || queued.command[0] !== 'player-route') throw new Error('Expected a recorded player-route command');
const { run } = await import(pathToFileURL(resolve(values.extractor, 'packages/extractor/src/commands/player-route.ts')));
const { createRouteCache } = await import(pathToFileURL(resolve(values.extractor, 'packages/extractor/src/route-cache.ts')));
const directory = resolve(values.output);
await mkdir(directory, { recursive: true });
const cache = createRouteCache();
const summaries = [];
for (const kind of ['cold', 'warm']) {
    const output = resolve(directory, `${kind}-route.json`);
    const args = queued.command.slice(1);
    const outputIndex = args.findIndex(arg => arg === '-o' || arg === '--output');
    if (outputIndex < 0 || outputIndex + 1 >= args.length) throw new Error('Recorded command has no output argument');
    if (args.some((arg, index) => index !== outputIndex + 1 && resolve(arg) === output)) throw new Error('Profile output would overwrite an input');
    args[outputIndex + 1] = output;
    const progress = [];
    const start = performance.now();
    const cpu = process.cpuUsage();
    await run(args, { cache, progress: value => progress.push({ ...value, atMs: performance.now() - start, memory: process.memoryUsage() }) });
    const elapsedMs = performance.now() - start;
    const cpuUsage = process.cpuUsage(cpu);
    const result = JSON.parse(await readFile(output, 'utf8'));
    const summary = { kind, elapsedMs, cpu: cpuUsage, memory: process.memoryUsage(),
        sourceRun: queued.run, sourceLog: resolve(values.log), diagnostics: result.diagnostics,
        status: result.status, reason: result.reason, progress };
    summaries.push(summary);
    await writeFile(resolve(directory, 'summary.json'), JSON.stringify(summaries, null, 2) + '\n');
    console.log(JSON.stringify({ kind, elapsedMs, timing: result.diagnostics?.timingMs,
        reused: result.diagnostics?.prepareReuse, status: result.reason ?? result.status }));
}
