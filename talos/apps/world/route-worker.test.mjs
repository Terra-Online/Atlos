import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout } from 'node:timers/promises';
import { createRouteWorker } from './route-worker.ts';

const fixture = async () => {
    const directory = await mkdtemp(join(tmpdir(), 'route-worker-'));
    const src = join(directory, 'packages/extractor/src');
    await mkdir(src, { recursive: true });
    await writeFile(
        join(src, 'route-worker.ts'),
        `
let count = 0;
process.on('message', async ({ id, args }) => {
    count++;
    if (args[0] === 'crash') process.exit(7);
    if (args[0] === 'delayed-exit') process.on('SIGTERM', () => setTimeout(() => {
        console.log('late retired worker output');
        process.send({type:'ready',version:999});
        setTimeout(() => process.exit(0), 30);
    }, 80));
    if (args[0] === 'wait') await new Promise(resolve => setTimeout(resolve, 300));
    process.send({ type: 'progress', id, progress: { pid: process.pid, count, arg: args[0] } });
    process.send(args[0] === 'fail' ? {type:'error',id,error:'fixture failure'} : {type:'done',id});
});
process.send({type:'ready',version:1});
`,
    );
    return directory;
};
const completed = (task) =>
    new Promise((resolve) => {
        let stdout = '',
            stderr = '';
        task.stdout.on('data', (bytes) => (stdout += bytes));
        task.stderr.on('data', (bytes) => (stderr += bytes));
        task.once('close', (code, signal) =>
            resolve({ code, signal, stdout, stderr }),
        );
    });

test('reuses a serial lane, preserves progress ordering and recovers from job and process failures', async () => {
    const directory = await fixture();
    const worker = createRouteWorker({
        extractor: directory,
        node: process.execPath,
    });
    try {
        const first = await completed(
            await worker.start(['player-route', 'first']),
        );
        const second = await completed(
            await worker.start(['player-route', 'second']),
        );
        assert.equal(first.code, 0);
        assert.equal(second.code, 0);
        const a = JSON.parse(first.stdout),
            b = JSON.parse(second.stdout);
        assert.equal(a.pid, b.pid);
        assert.equal(b.count, 2);
        assert.equal(b.arg, 'second');
        const failure = await completed(
            await worker.start(['player-route', 'fail']),
        );
        assert.equal(failure.code, 1);
        assert.match(failure.stderr, /fixture failure/);
        const recovered = await completed(
            await worker.start(['player-route', 'recovered']),
        );
        assert.equal(JSON.parse(recovered.stdout).pid, a.pid);
        assert.equal(recovered.code, 0);
        const crashed = await completed(
            await worker.start(['player-route', 'crash']),
        );
        assert.equal(crashed.code, 7);
        const restarted = await completed(
            await worker.start(['player-route', 'restarted']),
        );
        assert.equal(restarted.code, 0);
        assert.notEqual(JSON.parse(restarted.stdout).pid, a.pid);
        const active = completed(await worker.start(['player-route', 'wait']));
        await assert.rejects(
            worker.start(['player-route', 'overlap']),
            /already busy/,
        );
        worker.close();
        assert.notEqual((await active).code, 0);
        await assert.rejects(
            worker.start(['player-route', 'closed']),
            /closed/,
        );
    } finally {
        worker.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('releases idle process memory and starts a fresh lane on demand', async () => {
    const directory = await fixture();
    const worker = createRouteWorker({
        extractor: directory,
        node: process.execPath,
        idleMs: 20,
    });
    try {
        const a = await completed(
            await worker.start(['player-route', 'first']),
        );
        await setTimeout(100);
        const b = await completed(
            await worker.start(['player-route', 'second']),
        );
        assert.equal(b.code, 0);
        assert.notEqual(JSON.parse(a.stdout).pid, JSON.parse(b.stdout).pid);
        assert.equal(JSON.parse(b.stdout).count, 1);
    } finally {
        worker.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('closing during entry detection or an active legacy command cannot leak a child', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'route-worker-legacy-'));
    const src = join(directory, 'packages/extractor/src');
    await mkdir(src, { recursive: true });
    await writeFile(join(src, 'cli.ts'), 'setTimeout(() => {}, 30000);');
    try {
        const pendingWorker = createRouteWorker({
            extractor: directory,
            node: process.execPath,
        });
        const pending = pendingWorker.start(['player-route']);
        pendingWorker.close();
        await assert.rejects(pending, /closed/);
        const activeWorker = createRouteWorker({
            extractor: directory,
            node: process.execPath,
        });
        try {
            const task = await activeWorker.start(['player-route']);
            const exit = completed(task);
            await assert.rejects(
                activeWorker.start(['player-route']),
                /already busy/,
            );
            activeWorker.close();
            assert.equal(task.killed, true);
            assert.notEqual((await exit).code, 0);
        } finally {
            activeWorker.close();
        }
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test('late messages from a retiring worker cannot affect its replacement', async () => {
    const directory = await fixture();
    const worker = createRouteWorker({
        extractor: directory,
        node: process.execPath,
        idleMs: 20,
    });
    try {
        await completed(await worker.start(['player-route', 'delayed-exit']));
        await setTimeout(50);
        const next = await completed(
            await worker.start(['player-route', 'wait']),
        );
        assert.equal(next.code, 0);
        assert.doesNotMatch(
            next.stdout + next.stderr,
            /late retired|Unsupported/,
        );
        assert.equal(JSON.parse(next.stdout).arg, 'wait');
    } finally {
        worker.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('discarding an idle region releases its heap without closing the lane', async () => {
    const directory = await fixture();
    const worker = createRouteWorker({
        extractor: directory,
        node: process.execPath,
    });
    try {
        const a = await completed(
            await worker.start(['player-route', 'first']),
        );
        worker.discard();
        const b = await completed(
            await worker.start(['player-route', 'second']),
        );
        assert.equal(b.code, 0);
        assert.notEqual(JSON.parse(a.stdout).pid, JSON.parse(b.stdout).pid);
        const task = await worker.start(['player-route', 'wait']);
        const done = completed(task);
        assert.throws(() => worker.discard(), /busy/);
        worker.close();
        await done;
    } finally {
        worker.close();
        await rm(directory, { recursive: true, force: true });
    }
});
