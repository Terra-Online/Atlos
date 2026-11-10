import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStageProfiler, phaseIntervals, summarizeCpuProfile } from './profile-route-stages.mjs';
import { transformSource, profilerKey } from './profile-route-stages-loader.mjs';

test('stopwatch self time excludes the union of concurrently awaited children', async () => {
    let now = 0;
    const profiler = createStageProfiler(() => now);
    let finishFirst, finishSecond;
    await profiler.invoke('parent', async () => {
        now = 2;
        const first = profiler.invoke('first', () => new Promise(resolve => { finishFirst = resolve; }));
        now = 4;
        const second = profiler.invoke('second', () => new Promise(resolve => { finishSecond = resolve; }));
        now = 7;
        finishFirst();
        await first;
        now = 10;
        finishSecond();
        await second;
        now = 12;
    });
    const rows = new Map(profiler.snapshot().stages.map(row => [row.label, row]));
    assert.equal(rows.get('parent').inclusiveMs, 12);
    assert.equal(rows.get('parent').selfMs, 4);
    assert.equal(rows.get('first').inclusiveMs, 5);
    assert.equal(rows.get('second').inclusiveMs, 6);
    assert.equal(profiler.snapshot().activeCalls, 0);
});

test('source instrumentation preserves return, exceptions, async values and lexical this/arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'route-stage-test-'));
    const profiler = createStageProfiler();
    globalThis[profilerKey] = profiler;
    const source = `
        export function outer(value) {
            const child = x => x + 1;
            if (value < 0) throw new Error('negative');
            return child(arguments[0]) + this.offset;
        }
        export const asynchronous = async x => { await Promise.resolve(); return x * 2; };
    `;
    const transformed = transformSource(source, join(directory, 'fixture.mjs'), {
        selection: { module: 'fixture', names: new Set(['outer', 'child', 'asynchronous']) },
    });
    try {
        const path = join(directory, 'fixture.mjs');
        await writeFile(path, transformed.source);
        const module = await import(pathToFileURL(path));
        assert.equal(module.outer.call({ offset: 3 }, 4), 8);
        assert.throws(() => module.outer.call({ offset: 3 }, -1), /negative/);
        assert.equal(await module.asynchronous(5), 10);
        const rows = new Map(profiler.snapshot().stages.map(row => [row.label, row]));
        assert.equal(rows.get('fixture::outer').calls, 2);
        assert.equal(rows.get('fixture::outer.child').calls, 1);
        assert.equal(rows.get('fixture::asynchronous').calls, 1);
        assert.equal(profiler.snapshot().activeCalls, 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('sampling attribution retains inclusive stacks and progress phase boundaries', () => {
    const profile = {
        startTime: 1000000,
        nodes: [
            { id: 1, callFrame: { functionName: 'root', url: '', lineNumber: -1 }, children: [2] },
            { id: 2, callFrame: { functionName: 'work', url: 'test.mjs', lineNumber: 3 } },
        ],
        samples: [2, 2], timeDeltas: [1000, 1000],
    };
    const intervals = phaseIntervals([{ phase: 'search', atMs: 1.5 }], 3);
    const report = summarizeCpuProfile(profile, intervals, -1000);
    assert.equal(report.functions.find(row => row.label.endsWith('::work')).sampledSelfWallMs, 2);
    assert.equal(report.functions.find(row => row.label.endsWith('::root')).sampledInclusiveWallMs, 2);
    assert.deepEqual(report.phases.map(row => [row.phase, row.sampledWallMs]), [['setup', 1.5], ['search', .5]]);
});

test('call instrumentation retains nested JSON calls, async I/O and receiver evaluation order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'route-stage-calls-'));
    const profiler = createStageProfiler();
    globalThis[profilerKey] = profiler;
    const source = `
        import { readFile, writeFile, rename } from 'node:fs/promises';
        export async function run(path) {
            const JSON = {
                tag: 'receiver',
                parse(value) { if (this.tag !== 'receiver') throw new Error('wrong receiver'); return globalThis.JSON.parse(value); },
                stringify(value) { if (this.tag !== 'receiver') throw new Error('wrong receiver'); return globalThis.JSON.stringify(value); },
            };
            const input = JSON.parse(await readFile(path, 'utf8'));
            const nested = JSON.parse(JSON.stringify(input));
            const original = JSON.stringify;
            await writeFile(path + '.tmp', JSON.stringify((() => { JSON.stringify = () => 'changed'; return nested; })()));
            JSON.stringify = original;
            await rename(path + '.tmp', path + '.out');
            return JSON.parse(await readFile(path + '.out', 'utf8'));
        }
    `;
    const transformed = transformSource(source, join(directory, 'fixture.mjs'), {
        selection: { module: 'fixture', names: new Set(['run']), calls: true },
    });
    try {
        const path = join(directory, 'fixture.mjs');
        const input = join(directory, 'input.json');
        await writeFile(path, transformed.source);
        await writeFile(input, '{"value":7}');
        const module = await import(pathToFileURL(path));
        assert.deepEqual(await module.run(input), { value: 7 });
        assert.equal(await readFile(input + '.out', 'utf8'), '{"value":7}');
        const rows = new Map(profiler.snapshot().stages.map(row => [row.label, row]));
        assert.equal(rows.get('fixture::readFile').calls, 2);
        assert.equal(rows.get('fixture::writeFile').calls, 1);
        assert.equal(rows.get('fixture::rename').calls, 1);
        assert.equal(rows.get('fixture::JSON.parse').calls, 3);
        assert.equal(rows.get('fixture::JSON.stringify').calls, 2);
        assert.equal(profiler.snapshot().activeCalls, 0);
    } finally { await rm(directory, { recursive: true, force: true }); }
});

test('sampling function totals exclude profiler setup and report serialization outside the trial', () => {
    const profile = {
        startTime: 1000000,
        nodes: [{ id: 1, callFrame: { functionName: 'work', url: 'test.mjs', lineNumber: 0 } }],
        samples: [1, 1, 1, 1], timeDeltas: [1000, 1000, 1000, 1000],
    };
    const report = summarizeCpuProfile(profile, [{ phase: 'trial', startMs: 0, endMs: 2 }], -1001);
    assert.equal(report.functions[0].sampledSelfWallMs, 2);
    assert.equal(report.excludedOutsideTrialWallMs, 2);
    assert.equal(report.phases[0].sampledWallMs, 2);
});
