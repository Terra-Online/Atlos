import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, copyFile, readFile, writeFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ROOT } from './task-runner.mjs';

const exec = promisify(execFile);
const repo = path.dirname(ROOT);
const { values } = parseArgs({ options: { base: { type: 'string', default: 'e76e0819' }, previous: { type: 'string', default: '3703de8f' }, current: { type: 'string', default: 'HEAD' }, out: { type: 'string' }, only: { type: 'string' }, 'pre-standard': { type: 'string' } } });
if (!values.out) throw new Error('Provide --out DIR; isolated source snapshots are retained in the system temporary directory.');
const out = path.resolve(values.out); await mkdir(path.dirname(out), { recursive: true }); await mkdir(out);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = async (args) => (await exec('git', args, { cwd: repo, maxBuffer: 32 * 1024 * 1024 })).stdout;
const source = await mkdtemp(path.join(tmpdir(), 'atlos-compare-'));
const ignored = (await git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z', 'talos/src', 'talos/public', 'talos/config', 'talos/apps/intel/src/assets', 'talos/apps/user-hub/src/assets', 'talos/apps/intel/public', 'talos/apps/user-hub/public', 'talos/.cache/font-shards/v1'])).split('\0').filter((file) => file && !file.endsWith('.DS_Store'));
const inputs = {};
const frozen = path.join(source, 'frozen-inputs');
for (const file of ignored) {
    const bytes = await readFile(path.join(repo, file));
    const target = path.join(frozen, file); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes); inputs[file] = hash(bytes);
}
const manifest = { method: 'git archive source; ignored map/font/media/config inputs copied once into an immutable common snapshot, then verified before data generation for each variant; identical installed dependencies and fixed BUILD_ASSET_VERSION; diagnostic probe forced off; opt-in writeBundle report only. Direct Vite compile, no release receipt or deployment claim.', node: process.version, sourceDirectory: source,
    reporterSHA256: hash(await readFile(path.join(ROOT, 'scripts/lib/bundle-report.mjs'))),
    dependencies: { lockSHA256: hash(await readFile(path.join(ROOT, 'pnpm-lock.yaml'))), installedModulesSHA256: hash(await readFile(path.join(ROOT, 'node_modules/.modules.yaml'))) },
    frozenInputs: { files: ignored.length, sha256: hash(JSON.stringify(inputs)) }, assetVersion: 'baseline-comparison', variants: [] };
async function run(command, args, cwd, env, log) {
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, stdio: ['ignore', log, log] });
        child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
    });
}
const variants = [...(values['pre-standard'] ? [['pre-standard', values['pre-standard']]] : []), ['behavior-start', values.base], ['previous', values.previous], ['current', values.current]].filter(([name]) => !values.only || values.only === name);
if (!variants.length) throw new Error('Unknown --only variant.');
for (const [name, ref] of variants) {
    const revision = (await git(['rev-parse', `${ref}^{commit}`])).trim();
    const directory = path.join(source, name); await mkdir(directory);
    const archive = path.join(source, `${name}.tar`);
    const child = spawn('git', ['archive', revision, 'talos'], { cwd: repo, stdio: ['ignore', 'pipe', 'inherit'] });
    const archiveExit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`git archive exited ${code}`))); });
    await pipeline(child.stdout, createWriteStream(archive)); await archiveExit;
    await exec('tar', ['-xf', archive, '-C', directory]);
    // Only ignored inputs are copied. Historical tracked code/data remain historical.
    for (let start = 0; start < ignored.length; start += 32) await Promise.all(ignored.slice(start, start + 32).map(async (file) => {
        const target = path.join(directory, file); await mkdir(path.dirname(target), { recursive: true }); await copyFile(path.join(frozen, file), target);
        if (hash(await readFile(target)) !== inputs[file]) throw new Error(`Frozen input mismatch: ${file}`);
    }));
    const appRoot = path.join(directory, 'talos');
    await symlink(path.join(ROOT, 'node_modules'), path.join(appRoot, 'node_modules'), 'dir');
    const reporter = path.join(appRoot, 'scripts/lib/bundle-report.mjs'); await mkdir(path.dirname(reporter), { recursive: true });
    await copyFile(path.join(ROOT, 'scripts/lib/bundle-report.mjs'), reporter);
    for (const [config, app, relative] of [['vite.config.js', 'main', './scripts/lib/bundle-report.mjs'], ['apps/intel/vite.config.ts', 'intel', '../../scripts/lib/bundle-report.mjs'], ['apps/user-hub/vite.config.ts', 'user-hub', '../../scripts/lib/bundle-report.mjs']]) {
        const file = path.join(appRoot, config); let text = await readFile(file, 'utf8');
        if (!text.includes('bundleReport(')) text = `import { bundleReport } from '${relative}';\n` + text.replace('plugins: [', `plugins: [bundleReport('${app}'), `);
        await writeFile(file, text);
    }
    const reportDirectory = path.join(out, name); await mkdir(reportDirectory, { recursive: true });
    const logFile = path.join(reportDirectory, 'build.log');
    const log = createWriteStream(logFile); await new Promise((resolve) => log.once('open', resolve));
    const env = { ...process.env, BUILD_TARGET: 'r2', DEPLOY_CHANNEL: 'prod', VITE_AUTH_BASE: 'https://api.opendfieldmap.org', BUILD_ASSET_VERSION: manifest.assetVersion, NODE_ENV: 'production', BENCH_STARTUP_PROBE: '0', BUNDLE_REPORT_DIR: reportDirectory };
    try {
        // Derived data follows each revision's own generators; frozen binary inputs do not change.
        await run('pnpm', ['data', 'prepare'], appRoot, env, log.fd);
        await run('pnpm', ['data', 'intel'], appRoot, env, log.fd);
        await run('node', ['scripts/fonts/catalog.mjs'], appRoot, env, log.fd);
        for (const [app, relative] of [['main', ''], ['intel', 'apps/intel'], ['user-hub', 'apps/user-hub']])
            await run('pnpm', ['exec', 'vite', 'build', '--outDir', path.join(appRoot, 'dist/comparison', app)], path.join(appRoot, relative), env, log.fd);
    } finally { log.end(); }
    if (hash(await readFile(path.join(ROOT, 'pnpm-lock.yaml'))) !== manifest.dependencies.lockSHA256 || hash(await readFile(path.join(ROOT, 'node_modules/.modules.yaml'))) !== manifest.dependencies.installedModulesSHA256) throw new Error('Dependency installation changed during comparison.');
    const bundles = await Promise.all(['main', 'intel', 'user-hub'].map(async (app) => JSON.parse(await readFile(path.join(reportDirectory, `${app}.json`), 'utf8'))));
    for (const bundle of bundles) for (const file of bundle.files) {
        const bytes = await stat(path.join(appRoot, 'dist/comparison', bundle.app, file.file));
        if (bytes.size !== file.raw) throw new Error(`Size mismatch ${name}/${bundle.app}/${file.file}`);
    }
    manifest.variants.push({ name, source: revision, inputSHA256: manifest.frozenInputs.sha256, bundles: bundles.map((bundle) => ({ app: bundle.app, reportSHA256: hash(JSON.stringify(bundle)), files: bundle.files.length })), sourceDirectory: directory });
    await writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`${name} ${revision}: three bundles verified`);
}
