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
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on('exit', (code, signal) => {
    if (code && !signal) process.exitCode = code;
  });
  children.push(child);
};

start('map', ['dev', '--host', '0.0.0.0', '--port', '5173']);
start('intel', ['--filter', '@atlos/intel', 'dev'], { INTEL_DEV_PORT: '5174' });

const stop = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
};

process.on('SIGINT', stop);
process.on('SIGTERM', stop);
