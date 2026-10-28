import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { startupProbe } from './lib/startup-probe.mjs';
import { describeArtifact, acceptArtifacts, acceptClosure, summarizeClosure, startupStages } from './lib/closure-summary.mjs';

const artifact = (kind = 'production') => ({ kind, source: 'a'.repeat(40), sourceDirty: false, target: 'org', channel: 'prod', resources: { sha256: 'b'.repeat(64) }, inputs: { files: 3, sha256: 'c'.repeat(64) } });
const complete = () => ({ errors: [], artifacts: [artifact()], method: { apps: ['main'], profiles: ['desktop'], rounds: 1, cycles: 5, hasProbe: false }, stages: [],
    startup: ['cold-context', 'warm-http'].map((visit, i) => ({ app: 'main', profile: 'desktop', round: 0, visit, ready: 100, sampledAt: 2000,
        resources: [{ transfer: i ? 0 : 100 }], cacheStorageNames: [], cachePaths: i ? ['/assets/app.js'] : [], staticRequests: i ? ['/'] : ['/', '/assets/app.js'], downstream: [] })),
    heap: [{ app: 'main', profile: 'desktop', round: 0, prewarm: 3, checkpoints: [{ cycle: 0, heap: { usedSize: 1000 }, dom: { nodes: 10 } }, { cycle: 5, heap: { usedSize: 900 }, dom: { nodes: 10 } }] }] });

const withProbe = () => {
    const report = complete(); report.method.hasProbe = true; report.artifacts.push(artifact('probe-diagnostic'));
    report.stages = ['cold-context', 'warm-http'].map((visit) => ({ app: 'main', profile: 'desktop', round: 0, visit, diagnostic: true, ready: 100, sampledAt: 2000,
        spans: startupStages.map((name) => ({ name, start: 1, end: 2, duration: 1 })) }));
    return report;
};

test('artifact input identity permits diagnostic code changes but retains resources and private configuration in its digest', () => {
    const build = { root: '/frozen', info: { source: 'a'.repeat(40), sourceDirty: false, target: 'org', channel: 'prod', resources: { prefix: '/assets', bucket: 'private-bucket' } } };
    const files = { '.atlos-build.json': 'receipt', 'index.html': 'html', 'assets/main.js': 'js', 'assets/main.css': 'css', 'fonts/font.woff2': 'font', 'data/index.json': 'data' };
    const production = describeArtifact('production', build, files);
    const diagnostic = describeArtifact('probe-diagnostic', build, { ...files, '.atlos-build.json': 'new-receipt', 'index.html': 'new-html', 'assets/main.js': 'instrumented-js', 'assets/main.css': 'new-css' });
    assert.notEqual(production.sha256, diagnostic.sha256);
    assert.deepEqual(production.inputs, diagnostic.inputs);
    assert.equal(production.inputs.files, 2);
    assert.notEqual(describeArtifact('probe-diagnostic', build, { ...files, 'fonts/font.woff2': 'changed-font' }).inputs.sha256, production.inputs.sha256);
    const changed = structuredClone(build); changed.info.resources.bucket = 'another-bucket';
    assert.notEqual(describeArtifact('probe-diagnostic', changed, files).resources.sha256, production.resources.sha256);
    assert.equal(JSON.stringify(production).includes('private-bucket'), false);
});

test('artifact provenance refuses dirty, stale or differently configured probe inputs', () => {
    acceptArtifacts(complete()); acceptArtifacts(withProbe());
    const dirty = complete(); dirty.artifacts[0].sourceDirty = true;
    assert.throws(() => acceptArtifacts(dirty), /clean source/);
    for (const modify of [
        (row) => { row.sourceDirty = true; },
        (row) => { row.source = 'd'.repeat(40); },
        (row) => { row.target = 'cn'; },
        (row) => { row.channel = 'beta'; },
        (row) => { row.resources.sha256 = 'd'.repeat(64); },
        (row) => { row.inputs.sha256 = 'd'.repeat(64); },
        (row) => { row.inputs.files++; },
    ]) {
        const report = withProbe(); modify(report.artifacts[1]);
        assert.throws(() => acceptClosure(report), /provenance/);
    }
});

test('HTTP-cache acceptance requires native cache hits, reduced server work and reduced actual page transfer', () => {
    acceptClosure(complete());
    for (const modify of [
        (row) => { row.cachePaths = []; },
        (row) => { row.staticRequests.push('/assets/app.js'); },
        (row) => { row.resources[0].transfer = 100; },
        (row) => { row.cacheStorageNames = ['not-http-cache']; },
        (row) => { row.diagnostic = true; },
        (row) => { row.resources[0].transfer = NaN; },
    ]) {
        const report = complete(); modify(report.startup[1]);
        assert.throws(() => acceptClosure(report), /HTTP-cache|startup\/cache/);
    }
});

test('closure acceptance rejects interrupted heap/probe workloads and retains real negative heap deltas', () => {
    assert.equal(summarizeClosure(complete()).heap[0].warmedDelta.p50, -100);
    const heap = complete(); heap.heap[0].checkpoints.pop();
    assert.throws(() => acceptClosure(heap), /warmed heap/);
    const probe = withProbe();
    probe.stages.pop();
    assert.throws(() => acceptClosure(probe), /Incomplete closure/);
    probe.stages = withProbe().stages;
    acceptClosure(probe);
    for (const modify of [
        (row) => { row.visit = 'another-visit'; },
        (row) => { row.app = 'intel'; },
        (row) => { row.ready = NaN; },
        (row) => { row.sampledAt = 1999; },
        (row) => { row.ready = 2001; },
        (row) => { row.spans[0].end = 0; },
    ]) {
        const report = withProbe(); modify(report.stages[1]);
        assert.throws(() => acceptClosure(report), /diagnostic spans/);
    }
});

test('startup stage diagnostics are opt-in and reject drifted source anchors', async () => {
    const old = process.env.BENCH_STARTUP_PROBE;
    try {
        delete process.env.BENCH_STARTUP_PROBE;
        assert.equal(startupProbe(), null);
        process.env.BENCH_STARTUP_PROBE = '1';
        const plugin = startupProbe();
        const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
        const locale = await readFile(new URL('../src/locale/index.ts', import.meta.url), 'utf8');
        const output = plugin.transform(main, '/repo/talos/src/main.tsx');
        assert.match(output, /atlos:map-fonts:end/);
        assert.match(plugin.transform(locale, '/repo/talos/src/locale/index.ts'), /atlos:i18n:end/);
        assert.equal(plugin.transform(main, '/repo/talos/apps/intel/src/main.tsx'), null);
        for (const app of ['intel', 'user-hub']) {
            const appLocale = await readFile(new URL(`../apps/${app}/src/locale/index.ts`, import.meta.url), 'utf8');
            assert.equal(plugin.transform(appLocale, `/repo/talos/apps/${app}/src/locale/index.ts`), null);
        }
        assert.throws(() => plugin.transform(main.replace('await fontLoader();', 'await changedLoader();'), '/repo/talos/src/main.tsx'), /anchor is missing/);
    } finally {
        if (old === undefined) delete process.env.BENCH_STARTUP_PROBE; else process.env.BENCH_STARTUP_PROBE = old;
    }
});
