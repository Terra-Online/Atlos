import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { access } from 'node:fs/promises';

/** One serial solver lane. Completed result files remain owned by the caller. */
export function createRouteWorker(options: {
    extractor: string;
    node: string;
    idleMs?: number;
}) {
    const entry = resolve(
        options.extractor,
        'packages/extractor/src/route-worker.ts',
    );
    let available: Promise<boolean> | undefined;
    let child: ChildProcess | undefined;
    let fallback: ChildProcess | undefined;
    let active: { id: string; task: Task } | undefined;
    let serial = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const clearIdle = () => {
        clearTimeout(idle);
        idle = undefined;
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        const current = active;
        active = undefined;
        if (!current) return;
        current.task.stdout.end();
        current.task.stderr.end();
        current.task.emit('close', code, signal);
    };
    const startChild = () => {
        const process = spawn(options.node, [entry], {
            cwd: options.extractor,
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        child = process;
        process.stdout?.on('data', (bytes) => {
            if (child === process) active?.task.stdout.write(bytes);
        });
        process.stderr?.on('data', (bytes) => {
            if (child === process) active?.task.stderr.write(bytes);
        });
        process.on('message', (message) => {
            if (child !== process) return;
            if (
                message &&
                typeof message === 'object' &&
                'type' in message &&
                message.type === 'ready'
            ) {
                if (!('version' in message) || message.version !== 1) {
                    active?.task.stderr.write(
                        'Error: Unsupported route worker protocol\n',
                    );
                    finish(1, null);
                    process.kill('SIGTERM');
                }
                return;
            }
            if (
                !message ||
                typeof message !== 'object' ||
                !('id' in message) ||
                message.id !== active?.id ||
                !('type' in message)
            )
                return;
            if (message.type === 'progress' && 'progress' in message) {
                active?.task.stdout.write(
                    JSON.stringify(message.progress) + '\n',
                );
                return;
            }
            if (message.type !== 'done' && message.type !== 'error') return;
            if (message.type === 'error' && 'error' in message) {
                active?.task.stderr.write(`Error: ${String(message.error)}\n`);
            }
            if (message.type === 'done' && 'memory' in message) {
                active?.task.stdout.write(
                    JSON.stringify({
                        phase: 'worker-memory',
                        memory: message.memory,
                    }) + '\n',
                );
            }
            finish(message.type === 'done' ? 0 : 1, null);
            if (!closed) {
                idle = setTimeout(
                    () => process.kill('SIGTERM'),
                    options.idleMs ?? 60_000,
                );
                idle.unref();
            }
        });
        process.on('error', (error) => {
            if (child !== process) return;
            active?.task.stderr.write(`${error.name}: ${error.message}\n`);
            finish(1, null);
        });
        process.on('close', (code, signal) => {
            if (child !== process) return;
            child = undefined;
            clearIdle();
            finish(code ?? 1, signal);
        });
        return process;
    };
    return {
        async start(args: string[]): Promise<Task | ChildProcess> {
            if (closed) throw new Error('Route worker is closed');
            available ??= access(entry).then(
                () => true,
                () => false,
            );
            const supported = await available;
            if (closed) throw new Error('Route worker is closed');
            // Older configured extractors expose only the one-shot CLI.
            if (!supported) {
                if (fallback)
                    throw new Error('Route worker lane is already busy');
                const process = spawn(
                    options.node,
                    [
                        resolve(
                            options.extractor,
                            'packages/extractor/src/cli.ts',
                        ),
                        ...args,
                    ],
                    {
                        cwd: options.extractor,
                        stdio: ['ignore', 'pipe', 'pipe'],
                    },
                );
                fallback = process;
                process.once('close', () => {
                    if (fallback === process) fallback = undefined;
                });
                return process;
            }
            if (active) throw new Error('Route worker lane is already busy');
            clearIdle();
            const reused = Boolean(child && !child.killed);
            const process = child && !child.killed ? child : startChild();
            const id = String(++serial);
            const task = new Task(
                () => process.kill('SIGTERM'),
                process.pid,
                reused,
            );
            active = { id, task };
            process.send({ id, args: args.slice(1) }, (error) => {
                if (error && active?.id === id) {
                    task.stderr.write(`${error.name}: ${error.message}\n`);
                    finish(1, null);
                    process.kill('SIGTERM');
                }
            });
            return task;
        },
        discard() {
            if (active || fallback)
                throw new Error('Cannot discard a busy route worker');
            clearIdle();
            const previous = child;
            child = undefined;
            previous?.kill('SIGTERM');
        },
        close() {
            closed = true;
            clearIdle();
            child?.kill('SIGTERM');
            fallback?.kill('SIGTERM');
        },
    };
}

class Task extends EventEmitter {
    stdout = new PassThrough();
    stderr = new PassThrough();
    kill: () => boolean;
    pid: number | undefined;
    reused: boolean;
    constructor(kill: () => boolean, pid: number | undefined, reused: boolean) {
        super();
        this.kill = kill;
        this.pid = pid;
        this.reused = reused;
    }
}
