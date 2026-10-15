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
} = {}) => {
    const run = async (command, args = [], overrides = {}, cwd = root) => {
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
        if (execute) return execute(command, args, { cwd, env: taskEnv });
        await new Promise((resolve, reject) => {
            const child = spawn(
                command === 'pnpm' && process.platform === 'win32'
                    ? 'pnpm.cmd'
                    : command,
                args,
                {
                    cwd,
                    env: taskEnv,
                    stdio: 'inherit',
                },
            );
            child.once('error', reject);
            child.once('exit', (code, signal) => {
                if (code === 0) resolve();
                else
                    reject(
                        new Error(
                            `${command} ${args.join(' ')} failed (${signal || code})`,
                        ),
                    );
            });
        });
    };
    const local = async (label, action) => {
        log(`[local] ${label}`);
        if (!dryRun) return action();
    };
    return { run, local, root, env, dryRun };
};
