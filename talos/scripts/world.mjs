import fs from 'node:fs/promises';
import path from 'node:path';
import { loadEnv } from 'vite';
import { execFileSync } from 'node:child_process';
import { createRunner, ROOT } from './task-runner.mjs';
import { hashFiles } from './release-snapshot.mjs';
import { verifyOutput } from './release-artifact.mjs';
import { prepare } from './noclip.mjs';
import { prepare as prepareGanglia } from './ganglia.mjs';

const command = process.argv[2];
if (!['build', 'deploy'].includes(command)) throw new Error('Use world.mjs build|deploy');
const output = path.join(ROOT, 'dist/world');
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
await prepareGanglia();
const { identity: pin, upstream } = await prepare();
const runner = createRunner();
const receipt = path.join(output, '.world-build.json');
if (command === 'build') {
    await verifyOutput(ROOT, output);
    const catalog = process.env.VITE_WORLD_CATALOG_URL || loadEnv('production', ROOT, 'VITE_').VITE_WORLD_CATALOG_URL;
    if (!catalog) throw new Error('Set VITE_WORLD_CATALOG_URL before building World');
    await fs.rm(receipt, { force: true });
    await runner.run('pnpm', ['--filter', '@atlos/world', 'exec', 'vite', 'build', '--outDir', output], { BUILD_TARGET: 'r2' });
    await fs.writeFile(receipt, JSON.stringify({ app: 'world', catalog, renderer: pin, upstream, source: git('rev-parse', 'HEAD'), files: await hashFiles(output) }, null, 2));
} else {
    const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
    const files = await hashFiles(output);
    delete files['.world-build.json'];
    if (typeof saved.catalog !== 'string' || new URL(saved.catalog).protocol !== 'https:')
        throw new Error('Local data artifacts cannot be deployed; build with the production HTTPS catalog');
    if (saved.app !== 'world' || saved.renderer !== pin || JSON.stringify(saved.files) !== JSON.stringify(files))
        throw new Error('World artifact changed or renderer pin differs; rebuild before deploying');
    await runner.run('pnpm', ['exec', 'wrangler', 'pages', 'deploy', output, '--project-name', 'oem-world'], {}, path.join(ROOT, 'apps/world'));
}
