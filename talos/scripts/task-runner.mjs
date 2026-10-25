import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
);

export const createRunner = ({
    root = ROOT,
    env = process.env,
    dryRun = false,
    execute,
    log = console.log,
    signal,
} = {}) => {
    const run = async (command, args = [], overrides = {}, cwd = root) => {
        signal?.throwIfAborted();
        const taskEnv = { ...env, ...overrides };
        log(`> ${command} ${args.join(' ')}`);
        if (dryRun) {
            log(
                `  cwd=${cwd}; ${Object.entries(overrides)
                    .map(([key, value]) => `${key}=${value}`)
                    .join(' ')}`,
            );
            return;
        }
        if (execute) {
            const result = await execute(command, args, { cwd, env: taskEnv });
            signal?.throwIfAborted();
            return result;
        }
        await new Promise((resolve, reject) => {
            const grouped = Boolean(signal) && process.platform !== 'win32';
            const child = spawn(
                command === 'pnpm' && process.platform === 'win32'
                    ? 'pnpm.cmd'
                    : command,
                args,
                {
                    cwd,
                    env: taskEnv,
                    stdio: 'inherit',
                    // pnpm, shells and Python can spawn their own workers. A
                    // dedicated group lets cancellation stop the whole command.
                    detached: grouped,
                },
            );
            let timer;
            const stop = (force = false) => {
                if (!child.pid) return;
                try {
                    if (grouped)
                        process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
                    else if (!force) {
                        const killer = spawn(
                            'taskkill',
                            ['/pid', String(child.pid), '/t', '/f'],
                            { stdio: 'ignore' },
                        );
                        killer.once('error', (error) => {
                            log(
                                `[cancel] Cannot terminate command tree: ${error.message}`,
                            );
                            child.kill();
                        });
                    }
                } catch (error) {
                    if (error.code !== 'ESRCH')
                        log(`[cancel] ${error.message}`);
                }
            };
            const abort = () => {
                stop();
                timer = setTimeout(() => stop(true), 5000);
                timer.unref();
            };
            signal?.addEventListener('abort', abort, { once: true });
            child.once('error', reject);
            child.once('close', (code, exitSignal) => {
                signal?.removeEventListener('abort', abort);
                clearTimeout(timer);
                // A shell may exit before a worker that ignored SIGTERM.
                if (signal?.aborted) {
                    stop(true);
                    reject(signal.reason);
                } else if (code === 0) resolve();
                else
                    reject(
                        new Error(
                            `${command} ${args.join(' ')} failed (${exitSignal || code})`,
                        ),
                    );
            });
            if (signal?.aborted) abort();
        });
    };
    const local = async (label, action) => {
        signal?.throwIfAborted();
        log(`[local] ${label}`);
        if (!dryRun) return action();
    };
    return { run, local, root, env, dryRun, signal };
};

export const runCli = async (action) => {
    const controller = new AbortController();
    let timer;
    const handlers = new Map(
        ['SIGINT', 'SIGTERM'].map((name) => [
            name,
            () => {
                if (controller.signal.aborted) return;
                process.exitCode = name === 'SIGINT' ? 130 : 143;
                controller.abort(new Error(`Interrupted (${name})`));
                console.error(controller.signal.reason.message);
                // Network SDK calls may not support cancellation. Do not let those hold
                // the terminal indefinitely after command trees have been stopped.
                timer = setTimeout(() => process.exit(process.exitCode), 6000);
                timer.unref();
            },
        ]),
    );
    for (const [name, handler] of handlers) process.on(name, handler);
    try {
        await action(controller.signal);
    } catch (error) {
        if (!controller.signal.aborted) {
            console.error(error.message);
            process.exitCode = 1;
        }
    } finally {
        clearTimeout(timer);
        for (const [name, handler] of handlers)
            process.removeListener(name, handler);
    }
};
