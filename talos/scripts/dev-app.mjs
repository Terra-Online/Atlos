import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children = [];

const start = (label, args, env = {}) => {
    const child = spawn(pnpm, args, {
        cwd: root,
        env: { ...process.env, ...env },
        stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) =>
        process.stdout.write(`[${label}] ${chunk}`),
    );
    child.stderr.on('data', (chunk) =>
        process.stderr.write(`[${label}] ${chunk}`),
    );
    child.on('exit', (code, signal) => {
        if (code && !signal) process.exitCode = code;
    });
    children.push(child);
};

const name = process.argv[2];
const app = {
    world: { port: '5176', portKey: 'WORLD_DEV_PORT' },
    intel: { port: '5174', portKey: 'INTEL_DEV_PORT' },
    'user-hub': { port: '5175', portKey: 'USER_HUB_DEV_PORT' },
}[name];
if (!app) throw new Error('Expected world, intel or user-hub.');

start('map', ['dev', '--host', '0.0.0.0', '--port', '5173'], name === 'world' ? { VITE_WORLD_URL: 'http://127.0.0.1:5176/' } : {});
start(name, ['--filter', `@atlos/${name}`, 'dev'], { [app.portKey]: app.port });

const stop = () => {
    for (const child of children) {
        if (!child.killed) child.kill('SIGTERM');
    }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
