import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { Vec3, GroundArrival } from '@opendfieldmap/ganglia';

type Edge = {
    index: number;
    key?: string;
    points: Vec3[];
    unresolved: boolean;
};
type Result = {
    path?: Edge[];
    status: string;
    points?: Vec3[];
    arrival?: GroundArrival;
    reason?: string;
    diagnostics?: unknown;
};
export type CandidateJob = {
    status: 'pending' | 'ready' | 'failed';
    result?: Result;
    error?: string;
};
type Input = {
    scene: string;
    source: { buildGuid: string; contentHash: string };
    arrivals: GroundArrival[];
    target: Vec3;
    excludedEdges?: (number | string)[];
};

/** A single serial child retains scene topology while route polling stays responsive. */
export function candidateJobs(
    directory: string | undefined,
    node = process.execPath,
    worker = resolve(import.meta.dirname, 'candidate-worker.ts'),
) {
    let child: ChildProcess | undefined;
    let serial = 0;
    let closed = false;
    const pending = new Map<number, CandidateJob>();
    const fail = (message: string) => {
        for (const job of pending.values()) {
            job.status = 'failed';
            job.error = message;
        }
        pending.clear();
    };
    const ensureChild = () => {
        if (child) return child;
        const launched = fork(worker, [], {
            execPath: node,
            execArgv: ['--max-old-space-size=4096'],
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        });
        child = launched;
        let errorOutput = '';
        launched.stderr?.on('data', (bytes) => {
            errorOutput = (errorOutput + String(bytes)).slice(-4096);
        });
        launched.on(
            'message',
            (message: { id?: number; result?: Result; error?: string }) => {
                if (typeof message.id !== 'number') return;
                const job = pending.get(message.id);
                if (!job) return;
                pending.delete(message.id);
                if (message.result) {
                    job.result = message.result;
                    job.status = 'ready';
                } else {
                    job.status = 'failed';
                    job.error = message.error ?? 'Invalid candidate response';
                }
            },
        );
        launched.on('error', (error) => fail(error.message));
        launched.on('exit', (code, signal) => {
            if (child === launched) child = undefined;
            fail(errorOutput || `Candidate worker stopped (${signal ?? code})`);
        });
        return launched;
    };
    return {
        close() {
            closed = true;
            fail('Candidate planner closed');
            child?.kill();
            child = undefined;
        },
        start(input: Input): CandidateJob {
            if (closed || !directory)
                return {
                    status: 'failed',
                    error: closed
                        ? 'Candidate planner closed'
                        : 'Route data is not configured',
                };
            const job: CandidateJob = { status: 'pending' };
            const id = ++serial;
            pending.set(id, job);
            ensureChild().send(
                {
                    id,
                    input: {
                        ...input,
                        navigation: resolve(
                            directory,
                            `${input.scene}-ground-all.json`,
                        ),
                    },
                },
                (error) => {
                    if (!error) return;
                    pending.delete(id);
                    job.status = 'failed';
                    job.error = error.message;
                },
            );
            return job;
        },
    };
}
