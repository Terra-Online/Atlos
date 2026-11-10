import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { installStageHooks } from './profile-route-stages-loader.mjs';

/** Wall-clock stopwatch accounting. Self time excludes the union of nested
 * selected calls, including concurrently awaited children. It includes I/O,
 * GC and uninstrumented work and must be read separately from CPU samples. */
export function createStageProfiler(clock = () => performance.now()) {
    const context = new AsyncLocalStorage();
    let started = clock(), rows = new Map(), edges = new Map(), progress = [], active = 0;
    function record(label, duration, self, parent) {
        const row = rows.get(label) ?? { label, calls: 0, inclusiveMs: 0, selfMs: 0, maxMs: 0 };
        row.calls++;
        row.inclusiveMs += duration;
        row.selfMs += self;
        row.maxMs = Math.max(row.maxMs, duration);
        rows.set(label, row);
        const key = JSON.stringify([parent?.label ?? null, label]);
        const edge = edges.get(key) ?? { parent: parent?.label ?? null, label, calls: 0, inclusiveMs: 0 };
        edge.calls++;
        edge.inclusiveMs += duration;
        edges.set(key, edge);
    }
    return {
        reset() {
            if (active) throw new Error('Cannot reset profiling while calls remain active');
            started = clock(); rows = new Map(); edges = new Map(); progress = [];
        },
        invoke(label, fn) {
            const at = clock();
            const inherited = context.getStore();
            const parent = inherited?.closed ? null : inherited;
            const token = { label, at, children: 0, busyAt: 0, childMs: 0, closed: false };
            if (parent && parent.children++ === 0) parent.busyAt = at;
            active++;
            const finish = () => {
                const end = clock();
                token.closed = true;
                const busy = token.childMs + (token.children ? end - token.busyAt : 0);
                record(label, end - at, Math.max(0, end - at - busy), parent);
                if (parent && !parent.closed && --parent.children === 0) parent.childMs += end - parent.busyAt;
                active--;
            };
            return context.run(token, () => {
                let result;
                try { result = fn(); }
                catch (error) { finish(); throw error; }
                if (result && typeof result.then === 'function') return result.then(
                    value => { finish(); return value; },
                    error => { finish(); throw error; },
                );
                finish();
                return result;
            });
        },
        progress(event) { progress.push({ ...event, atMs: clock() - started }); },
        snapshot() {
            return {
                elapsedMs: clock() - started, activeCalls: active,
                stages: [...rows.values()].sort((a, b) => b.selfMs - a.selfMs),
                edges: [...edges.values()].sort((a, b) => b.inclusiveMs - a.inclusiveMs),
                progress,
            };
        },
    };
}

export function phaseIntervals(progress, elapsedMs) {
    const transitions = [{ phase: 'setup', atMs: 0 }, ...progress.filter(row => typeof row.phase === 'string')];
    return transitions.map((row, index) => ({ phase: row.phase, startMs: row.atMs,
        endMs: transitions[index + 1]?.atMs ?? elapsedMs }));
}

/** CPU samples use inspector's monotonic microsecond clock. The caller records
 * the matching hrtime/performance offset around Profiler.start. */
export function summarizeCpuProfile(profile, intervals, offsetMs) {
    const nodes = new Map(profile.nodes.map(node => [node.id, node]));
    const parent = new Map();
    for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
    const functions = new Map(), phases = new Map();
    let timestamp = profile.startTime, excludedMs = 0, intervalIndex = 0;
    for (let sample = 0; sample < (profile.samples?.length ?? 0); sample++) {
        const delta = profile.timeDeltas[sample];
        const startMs = timestamp / 1000 + offsetMs;
        timestamp += delta;
        const endMs = timestamp / 1000 + offsetMs;
        while (intervalIndex < intervals.length && intervals[intervalIndex].endMs <= startMs) intervalIndex++;
        const weights = [];
        for (let index = intervalIndex; index < intervals.length && intervals[index].startMs < endMs; index++) {
            const interval = intervals[index];
            const ms = Math.max(0, Math.min(endMs, interval.endMs) - Math.max(startMs, interval.startMs));
            if (ms > 0) weights.push({ phase: interval.phase, ms });
        }
        const sampledMs = weights.reduce((sum, row) => sum + row.ms, 0);
        excludedMs += delta / 1000 - sampledMs;
        if (!sampledMs) continue;
        for (const weight of weights) {
            const row = phases.get(weight.phase) ?? { phase: weight.phase, sampledWallMs: 0, self: new Map() };
            row.sampledWallMs += weight.ms;
            phases.set(weight.phase, row);
        }
        const seen = new Set();
        for (let id = profile.samples[sample]; id !== undefined; id = parent.get(id)) {
            const frame = nodes.get(id)?.callFrame;
            if (!frame) continue;
            const label = `${frame.url || '(runtime)'}:${frame.lineNumber + 1}::${frame.functionName || '(anonymous)'}`;
            if (seen.has(label)) continue;
            const row = functions.get(label) ?? { label, sampledSelfWallMs: 0, sampledInclusiveWallMs: 0 };
            row.sampledInclusiveWallMs += sampledMs;
            if (id === profile.samples[sample]) {
                row.sampledSelfWallMs += sampledMs;
                for (const weight of weights) {
                    const phaseRow = phases.get(weight.phase);
                    phaseRow.self.set(label, (phaseRow.self.get(label) ?? 0) + weight.ms);
                }
            }
            seen.add(label);
            functions.set(label, row);
        }
    }
    return {
        samplingIntervalUs: 1000,
        semantics: 'V8 1 ms sampled wall-time estimates include idle/wait/scheduling; weights clipped to trial and split at progress boundaries; inclusive stacks overlap',
        excludedOutsideTrialWallMs: excludedMs,
        functions: [...functions.values()].sort((a, b) => b.sampledSelfWallMs - a.sampledSelfWallMs),
        phases: [...phases.values()].map(row => ({ ...row,
            self: [...row.self].map(([label, sampledSelfWallMs]) => ({ label, sampledSelfWallMs })).sort((a, b) => b.sampledSelfWallMs - a.sampledSelfWallMs) })),
    };
}

async function startCpu(enabled) {
    if (!enabled) return null;
    const session = new Session();
    session.connect();
    const post = (method, params = {}) => new Promise((accept, reject) =>
        session.post(method, params, (error, value) => error ? reject(error) : accept(value)));
    await post('Profiler.enable');
    await post('Profiler.setSamplingInterval', { interval: 1000 });
    await post('Profiler.start');
    const offsetMs = performance.now() - Number(process.hrtime.bigint()) / 1e6;
    return { offsetMs, async stop() {
        const { profile } = await post('Profiler.stop');
        session.disconnect();
        return profile;
    } };
}

function replaceArgument(args, names, value) {
    const result = [...args];
    const found = [];
    for (let index = 0; index < result.length; index++) {
        if (names.includes(result[index])) {
            if (index + 1 >= result.length) throw new Error(`Missing value for ${result[index]}`);
            found.push(index);
        } else if (names.some(name => result[index].startsWith(`${name}=`))) {
            throw new Error('Use separate option/value arguments in profiling input JSON');
        }
    }
    if (found.length > 1) throw new Error(`Duplicate option ${names.join('/')}`);
    if (found.length) result[found[0] + 1] = value;
    else result.push(names[0], value);
    return result;
}

async function inputIdentity(args) {
    const files = [];
    const options = ['--ground', '--collision', '--movement-settings', '--request', '--devices', '--static-supports', '--config'];
    for (let index = 0; index < args.length; index++) {
        if (!options.includes(args[index])) continue;
        const path = resolve(args[index + 1]);
        const bytes = await readFile(path);
        files.push({ option: args[index], path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    return files;
}

function table(report) {
    return ['| Stage | Calls | Inclusive ms | Self ms | Max ms |', '|---|---:|---:|---:|---:|',
        ...report.stages.map(row => `| ${row.label} | ${row.calls} | ${row.inclusiveMs.toFixed(3)} | ${row.selfMs.toFixed(3)} | ${row.maxMs.toFixed(3)} |`)].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
    const { values } = parseArgs({ args: argv, options: {
        command: { type: 'string' }, extractor: { type: 'string' }, args: { type: 'string' },
        output: { type: 'string' }, cpu: { type: 'boolean', default: false },
        baseline: { type: 'boolean', default: false },
    } });
    if (!['player-route', 'player-ground', 'candidate-worker'].includes(values.command) ||
        !values.args || !values.output || (values.command !== 'candidate-worker' && !values.extractor)) {
        throw new Error('Usage: profile-route-stages.mjs --command <player-route|player-ground|candidate-worker> --args <JSON file> --output <new directory> [--extractor <root>] [--cpu] [--baseline]');
    }
    const input = JSON.parse(await readFile(resolve(values.args), 'utf8'));
    if (values.command !== 'candidate-worker' && (!Array.isArray(input) || input.some(arg => typeof arg !== 'string'))) {
        throw new Error('Extractor arguments must be a JSON array of strings');
    }
    const directory = resolve(values.output);
    // A fresh directory makes every trial output and every writable cache local
    // to this experiment and prevents accidental reuse of prior evidence.
    await mkdir(directory);
    const profiler = createStageProfiler();
    const candidatePath = values.command === 'candidate-worker' ? resolve(import.meta.dirname, '../apps/world/candidate-worker.ts') : undefined;
    const hooks = installStageHooks(profiler, { candidatePath, instrument: !values.baseline });
    const setupStart = performance.now();
    let run, cache;
    if (candidatePath) {
        ({ profileCandidatePlan: run } = await import(pathToFileURL(candidatePath)));
    } else {
        ({ run } = await import(pathToFileURL(resolve(values.extractor, `packages/extractor/src/commands/${values.command}.ts`))));
        if (values.command === 'player-route') {
            const { createRouteCache } = await import(pathToFileURL(resolve(values.extractor, 'packages/extractor/src/route-cache.ts')));
            cache = createRouteCache();
        }
    }
    const setupMs = performance.now() - setupStart;
    const sdkModule = hooks.modules.find(module => module.path.includes('/@opendfieldmap/ganglia/src/'));
    const sdkPath = sdkModule?.path.slice(0, sdkModule.path.lastIndexOf('/src/'));
    const sdk = sdkPath ? { path: sdkPath, ...JSON.parse(await readFile(resolve(sdkPath, 'package.json'), 'utf8')) } : null;
    const runtime = { node: process.version, execPath: process.execPath, execArgv: process.execArgv,
        platform: process.platform, arch: process.arch, sdkVersion: sdk?.version, sdkPath };
    const identities = values.command === 'candidate-worker' ? await inputIdentity(['--ground', input.navigation]) : await inputIdentity(input);
    const reports = [];
    const originalLog = console.log;
    try {
        for (const kind of ['cold', 'warm']) {
            const trial = resolve(directory, kind);
            await mkdir(trial);
            const output = resolve(trial, 'result.json');
            let args = input;
            if (values.command !== 'candidate-worker') {
                args = replaceArgument(input, ['-o', '--output'], output);
                if (values.command === 'player-ground') {
                    args = replaceArgument(args, ['--collision-output'], resolve(trial, 'collision.json'));
                    args = replaceArgument(args, ['--input-cache'], resolve(directory, 'input-cache'));
                    args = replaceArgument(args, ['--tile-cache'], resolve(directory, 'tile-cache'));
                }
            }
            const commandOutput = [];
            console.log = (...parts) => {
                commandOutput.push(parts.map(String).join(' '));
                if (typeof parts[0] !== 'string') return;
                try {
                    const event = JSON.parse(parts[0]);
                    if (event && typeof event === 'object') profiler.progress(event);
                } catch { /* Plain output remains available in command.log. */ }
            };
            const cpu = await startCpu(values.cpu);
            profiler.reset();
            const started = performance.now();
            const cpuBefore = process.cpuUsage();
            let error;
            try {
                if (values.command === 'candidate-worker') {
                    const result = await run(input);
                    await writeFile(output, JSON.stringify(result));
                } else {
                    await run(args, cache ? { cache, progress: event => profiler.progress(event) } : undefined);
                }
            } catch (cause) { error = { message: cause.message, stack: cause.stack }; }
            const elapsedMs = performance.now() - started;
            const cpuUsage = process.cpuUsage(cpuBefore);
            const snapshot = profiler.snapshot();
            const profile = await cpu?.stop();
            console.log = originalLog;
            const intervals = phaseIntervals(snapshot.progress, elapsedMs);
            const report = { kind, command: values.command, args, setupMs, cpuUsage, runtime,
                memory: process.memoryUsage(), instrumentation: !values.baseline,
                cachePolicy: values.command === 'player-route' ? 'application-cold then shared RouteCache; existing physical inputs; fresh result paths; input identity hashing has warmed OS file pages' :
                    values.command === 'player-ground' ? 'fresh local input/tile caches for cold; same caches and process for warm; OS file cache uncontrolled' :
                        'application-cold candidate plan then prepared navigation reuse in same process; input identity hashing has warmed OS file pages',
                inputFiles: identities, ...snapshot, elapsedMs, intervals, error,
                intervalSemantics: 'time after each progress event until the next; completion events are not stage start markers',
                stopwatchSemantics: 'inclusive/self are wall time; self excludes union of nested selected calls within each parent; concurrently awaited sibling self times can overlap; totals across stages are not elapsed wall time',
                setupSemantics: 'module import/parse/transform time is reported separately from cold/warm trial time' };
            if (profile) {
                await writeFile(resolve(trial, 'cpu.cpuprofile'), JSON.stringify(profile));
                report.cpuSamples = summarizeCpuProfile(profile, intervals, cpu.offsetMs - started);
            }
            try {
                const result = JSON.parse(await readFile(output, 'utf8'));
                report.result = { status: result.status, reason: result.reason, diagnostics: result.diagnostics,
                    surfaces: result.surfaces?.length, portals: result.portals?.length, tiles: result.tiles };
            } catch (cause) { report.resultReadError = cause.message; }
            reports.push(report);
            await writeFile(resolve(trial, 'command.log'), commandOutput.join('\n') + '\n');
            await writeFile(resolve(trial, 'stages.json'), JSON.stringify(report, null, 2) + '\n');
            await writeFile(resolve(trial, 'stages.md'), table(report) + '\n');
            await writeFile(resolve(directory, 'summary.json'), JSON.stringify({ modules: hooks.modules, reports }, null, 2) + '\n');
            originalLog(JSON.stringify({ kind, elapsedMs, stages: snapshot.stages.length, error }));
            if (error) throw new Error(`${kind} trial failed: ${error.message}`);
        }
    } finally {
        console.log = originalLog;
        hooks.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
