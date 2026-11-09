import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyTime, summarizeRun } from './profile-world-routes.mjs';

test('parallel workers do not double count busy wall time', () => {
    assert.equal(busyTime([[10, 20], [12, 15], [18, 25], [30, 40]]), 25);
    assert.equal(busyTime([]), 0);
});

test('phase durations and repeated log runs are attributed to their own run', () => {
    const job = { run: 'current', stage: 'all' };
    const event = (elapsedMs, detail) => ({ run: 'current', elapsedMs, time: new Date(elapsedMs).toISOString(), ...detail });
    const result = summarizeRun(job, [
        { run: 'old', event: 'progress', phase: 'wrong', elapsedMs: 10000 },
        event(0, { event: 'queued' }), event(5, { event: 'started' }),
        event(8, { event: 'solver-started', reusedProcess: true }),
        event(10, { event: 'progress', phase: 'ground-search' }),
        event(30, { event: 'progress', phase: 'jump-discovery', memory: { rss: 123 } }),
        event(80, { event: 'progress', phase: 'worker-memory' }),
        event(82, { event: 'solver-finished' }), event(85, { event: 'finished', status: 'ready' }),
    ]);
    assert.deepEqual(result.phases, { 'ground-search': 20, 'jump-discovery': 52 });
    assert.equal(result.processMs, 74);
    assert.equal(result.queueMs, 5);
    assert.equal(result.peakRss, 123);
    assert.equal(result.elapsedMs, 85);
    assert.equal(result.reusedProcess, true);
});

test('interrupted work remains incomplete rather than appearing as a cheap finished job', () => {
    const result = summarizeRun({ run: 'x' }, [{ run: 'x', event: 'progress', phase: 'jump-discovery', elapsedMs: 900 }]);
    assert.equal(result.complete, false);
    assert.equal(result.elapsedMs, 900);
    assert.deepEqual(result.phases, {});
    assert.equal(result.processMs, null);
});

test('ground build logs without solver-finished still contribute their busy interval', () => {
    const result = summarizeRun({ run: 'ground' }, [
        { run: 'ground', event: 'solver-started', elapsedMs: 10, time: new Date(10).toISOString() },
        { run: 'ground', event: 'progress', phase: 'ground-tile', elapsedMs: 20 },
        { run: 'ground', event: 'finished', elapsedMs: 100, time: new Date(100).toISOString(), status: 'ready' },
    ]);
    assert.deepEqual(result.interval, [10, 100]);
    assert.equal(result.processMs, 90);
    assert.deepEqual(result.phases, { 'ground-tile': 80 });
});
