import { createHash } from 'node:crypto';
import { distribution } from '../report-production.mjs';

export const startupStages = ['i18n', 'region', 'i18n-wait', 'url-state', 'navigation', 'font-registration', 'region-wait', 'map-fonts'];
const finite = (value) => Number.isFinite(value) && value >= 0;
const validSample = (row) => finite(row.ready) && finite(row.sampledAt) && row.sampledAt >= 2000 && row.ready <= row.sampledAt;
const transfer = (row) => row.resources.reduce((n, entry) => n + entry.transfer, 0);

export function describeArtifact(kind, artifact, files) {
    const inputs = Object.fromEntries(Object.entries(files).filter(([file]) => file !== '.atlos-build.json' && !/\.(?:m?js|cjs|css|html?)$/i.test(file)));
    const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const resources = Object.fromEntries(Object.entries(artifact.info.resources).sort(([a], [b]) => a.localeCompare(b)));
    return { kind, source: artifact.info.source, sourceDirty: artifact.info.sourceDirty, target: artifact.info.target, channel: artifact.info.channel,
        root: artifact.root, sha256: digest(files), resources: { sha256: digest(resources), method: 'SHA256 of key-sorted full build-receipt resources object; private values omitted' },
        inputs: { files: Object.keys(inputs).length, sha256: digest(inputs), method: 'SHA256 of JSON.stringify(hashFiles), excluding .atlos-build.json and JS/CSS/HTML files' } };
}

/** Probe code may differ, but source/configuration and every other frozen input must match. */
export function acceptArtifacts(report) {
    const artifacts = report.artifacts || [];
    const expectedKinds = report.method.hasProbe ? ['production', 'probe-diagnostic'] : ['production'];
    if (artifacts.length !== expectedKinds.length || expectedKinds.some((kind) => artifacts.filter((a) => a.kind === kind).length !== 1)) throw new Error('Incomplete artifact provenance.');
    const production = artifacts.find((a) => a.kind === 'production');
    for (const artifact of artifacts) {
        if (artifact.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(artifact.source || '') || !artifact.target || !artifact.channel || !/^[a-f0-9]{64}$/.test(artifact.resources?.sha256 || '') || !/^[a-f0-9]{64}$/.test(artifact.inputs?.sha256 || '') || !Number.isInteger(artifact.inputs.files) || artifact.inputs.files <= 0) throw new Error('Artifact provenance must use clean source and complete input hashes.');
        if (['source', 'target', 'channel'].some((key) => artifact[key] !== production[key]) || artifact.resources.sha256 !== production.resources.sha256 || artifact.inputs.sha256 !== production.inputs.sha256 || artifact.inputs.files !== production.inputs.files) throw new Error('Probe artifact provenance does not match production source/configuration/resource inputs.');
    }
}

/** A cache label alone is not evidence; require native hits and fewer server bytes/requests. */
export function acceptClosure(report) {
    if (report.errors.length) throw new Error('Runtime errors prevent closure acceptance.');
    acceptArtifacts(report);
    const { rounds, cycles, apps, profiles, hasProbe } = report.method;
    const expected = rounds * profiles.length * apps.length;
    if (report.startup.length !== expected * 2 || report.heap.length !== expected || report.stages.length !== (hasProbe && apps.includes('main') ? rounds * profiles.length * 2 : 0)) throw new Error('Incomplete closure workload.');
    for (const app of apps) for (const profile of profiles) for (let round = 0; round < rounds; round++) {
        const rows = report.startup.filter((row) => row.app === app && row.profile === profile && row.round === round);
        const cold = rows.find((row) => row.visit === 'cold-context'), warm = rows.find((row) => row.visit === 'warm-http');
        if (rows.length !== 2 || !cold || !warm || rows.some((row) => row.diagnostic || !validSample(row) || row.cacheStorageNames.length || row.resources.some((entry) => !finite(entry.transfer)))) throw new Error('Invalid or duplicate startup/cache workload.');
        if (!warm.cachePaths.length || warm.staticRequests.length >= cold.staticRequests.length || transfer(warm) >= transfer(cold)) throw new Error('No demonstrated native HTTP-cache effect.');
        const heaps = report.heap.filter((row) => row.app === app && row.profile === profile && row.round === round);
        const checkpoints = [0]; for (let n = 1; n <= cycles; n++) if (n % 5 === 0 || n === cycles) checkpoints.push(n);
        if (heaps.length !== 1 || heaps[0].prewarm !== 3 || JSON.stringify(heaps[0].checkpoints.map((p) => p.cycle)) !== JSON.stringify(checkpoints) || heaps[0].checkpoints.some((p) => !finite(p.heap.usedSize) || !finite(p.dom.nodes))) throw new Error('Incomplete warmed heap workload.');
        if (hasProbe && app === 'main') {
            const stages = report.stages.filter((row) => row.app === 'main' && row.profile === profile && row.round === round);
            if (stages.length !== 2 || ['cold-context', 'warm-http'].some((visit) => stages.filter((row) => row.visit === visit).length !== 1) || stages.some((row) => !row.diagnostic || !validSample(row) || startupStages.some((name) => {
                const span = row.spans.find((s) => s.name === name);
                return !span || !finite(span.start) || !finite(span.end) || span.end < span.start || span.duration !== span.end - span.start;
            }))) throw new Error('Incomplete startup diagnostic spans.');
        }
    }
}
export function summarizeClosure(report) {
    acceptClosure(report);
    const summary = { startup: [], stages: [], heap: [] };
    for (const app of report.method.apps) for (const profile of report.method.profiles) {
        for (const visit of ['cold-context', 'warm-http']) {
            const rows = report.startup.filter((r) => r.app === app && r.profile === profile && r.visit === visit);
            summary.startup.push({ app, profile, visit, ready: distribution(rows.map((r) => r.ready)), downstreamTransfer: distribution(rows.map((r) => r.downstream.reduce((n, e) => n + e.transfer, 0))), staticServerRequests: distribution(rows.map((r) => r.staticRequests.length)), pageResourceTransfer: distribution(rows.map(transfer)), cdpHttpCache: distribution(rows.map((r) => r.cachePaths.length)) });
            for (const name of startupStages) {
                const rows = report.stages.filter((r) => r.profile === profile && r.visit === visit).map((r) => r.spans.find((s) => s.name === name).duration);
                if (app === 'main' && rows.length) summary.stages.push({ profile, visit, name, duration: distribution(rows) });
            }
        }
        const rows = report.heap.filter((r) => r.app === app && r.profile === profile);
        summary.heap.push({ app, profile, warmedDelta: distribution(rows.map((r) => r.checkpoints.at(-1).heap.usedSize - r.checkpoints[0].heap.usedSize)), checkpoints: rows.map((r) => r.checkpoints.map((p) => ({ cycle: p.cycle, heap: p.heap.usedSize, nodes: p.dom.nodes }))) });
    }
    return summary;
}
