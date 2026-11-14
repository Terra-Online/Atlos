import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const lines = (bytes) => bytes.trim().split('\n').filter(Boolean).map(JSON.parse);
const sum = (values) => values.reduce((a, b) => a + b, 0);
const percentile = (values, fraction) => values.slice().sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? 0;

/** Busy wall time counts overlapping workers once; cumulative job time counts
 * each worker. Neither includes unindexed manual extractor experiments. */
export function busyTime(intervals) {
    const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
    let end = -Infinity, total = 0;
    for (const [start, stop] of sorted) {
        total += Math.max(0, stop - Math.max(start, end));
        end = Math.max(end, stop);
    }
    return total;
}

/** Each log may contain several runs. Result files can be overwritten by a
 * later run, so historical attribution uses timestamped log transitions. */
export function summarizeRun(job, entries) {
    const events = entries.filter(row => row.run === job.run);
    const finish = events.findLast(row => row.event === 'finished');
    const start = events.find(row => row.event === 'started');
    const child = events.find(row => row.event === 'solver-started');
    const end = events.findLast(row => row.event === 'solver-finished') ?? finish;
    const phases = {};
    const transitions = events.filter(row => row.event === 'progress' && row.phase && row.phase !== 'worker-memory');
    if (end) {
        for (let i = 0; i < transitions.length; i++) {
            const row = transitions[i];
            const stop = transitions[i + 1]?.elapsedMs ?? end.elapsedMs;
            phases[row.phase] = (phases[row.phase] ?? 0) + Math.max(0, stop - row.elapsedMs);
        }
    }
    const rss = events.map(row => row.memory?.rss).filter(Number.isFinite);
    return {
        run: job.run, time: job.time, stage: job.stage, from: job.from, target: job.target, log: job.log,
        complete: Boolean(finish), status: finish?.status,
        elapsedMs: finish?.elapsedMs ?? events.at(-1)?.elapsedMs ?? 0,
        queueMs: start?.elapsedMs ?? 0,
        processMs: child && end ? end.elapsedMs - child.elapsedMs : null,
        reusedProcess: child?.reusedProcess ?? false,
        peakRss: rss.length ? Math.max(...rss) : null,
        phases,
        interval: child && end ? [Date.parse(child.time), Date.parse(end.time)] : null,
    };
}

async function main() {
    const { values } = parseArgs({ options: {
        directory: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, output: { type: 'string' },
    } });
    if (!values.directory) throw new Error('Usage: profile-world-routes.mjs --directory <research> [--from <ISO>] [--to <ISO>] [--output <json>]');
    const from = values.from ? Date.parse(values.from) : -Infinity;
    const to = values.to ? Date.parse(values.to) : Infinity;
    if (Number.isNaN(from) || Number.isNaN(to) || from >= to) throw new Error('Invalid time interval');
    const directory = resolve(values.directory);
    const index = lines(await readFile(resolve(directory, 'route-jobs.jsonl'), 'utf8'));
    const selected = index.filter(row => Date.parse(row.time) >= from && Date.parse(row.time) < to);
    const logs = new Map(), jobs = [], missing = [];
    for (const job of selected) {
        if (job.event === 'cache-hit') continue;
        try {
            if (!logs.has(job.log)) logs.set(job.log, lines(await readFile(resolve(directory, job.log), 'utf8')));
            jobs.push(summarizeRun(job, logs.get(job.log)));
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            missing.push(job.log);
        }
    }
    const completed = jobs.filter(job => job.complete);
    const stages = {};
    const phases = {};
    for (const stage of new Set(completed.map(job => job.stage))) {
        const group = completed.filter(job => job.stage === stage);
        const times = group.map(job => job.elapsedMs);
        stages[stage] = { count: group.length, elapsedMs: sum(times), p50Ms: percentile(times, 0.5),
            p95Ms: percentile(times, 0.95), maxMs: Math.max(...times),
            jobFailures: group.filter(job => job.status !== 'ready').length };
    }
    for (const job of completed) for (const [name, duration] of Object.entries(job.phases)) phases[name] = (phases[name] ?? 0) + duration;
    const intervals = completed.map(job => job.interval).filter(Boolean);
    const report = {
        scope: { from: values.from, to: values.to, indexedOnly: true },
        count: jobs.length, cacheHits: selected.filter(row => row.event === 'cache-hit').length,
        unfinished: jobs.filter(job => !job.complete).length, missing,
        cumulativeMs: sum(completed.map(job => job.elapsedMs)),
        busyMs: busyTime(intervals),
        spanMs: intervals.length ? Math.max(...intervals.map(p => p[1])) - Math.min(...intervals.map(p => p[0])) : 0,
        peakWorkerRss: Math.max(0, ...completed.map(job => job.peakRss ?? 0)),
        stages, phases, jobs,
    };
    if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
    const summary = Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'jobs'));
    console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
