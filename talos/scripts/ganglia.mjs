import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.cache/ganglia');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function sourceDigest(base) {
    const hash = createHash('sha256');
    for (const name of (await fs.readdir(base, { recursive: true })).sort()) {
        if (
            name.split(path.sep).includes('node_modules') ||
            name === '.generated.json'
        )
            continue;
        if ((await fs.lstat(path.join(base, name))).isFile())
            hash.update(name + '\0').update(
                await fs.readFile(path.join(base, name)),
            );
    }
    return hash.digest('hex');
}

// Native Node type stripping requires the workspace's real source path outside
// node_modules. Keep the archive pin while exposing its sources through a link.
export async function prepare() {
    const world = JSON.parse(
        await fs.readFile(path.join(root, 'apps/world/package.json'), 'utf8'),
    );
    const specifier = world.dependencies['@opendfieldmap/ganglia'];
    const archive = path.resolve(
        root,
        'apps/world',
        specifier.slice('file:'.length),
    );
    const identity = digest(
        Buffer.concat([
            await fs.readFile(archive),
            await fs.readFile(fileURLToPath(import.meta.url)),
        ]),
    );
    const receipt = path.join(directory, '.generated.json');
    try {
        const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
        if (saved.sourceDigest !== (await sourceDigest(directory)))
            throw new Error(
                'Generated Ganglia source was edited; update the pinned archive instead',
            );
        if (saved.identity === identity) return saved;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const staging = directory + '-prepare-' + process.pid;
    await fs.mkdir(staging, { recursive: true });
    try {
        execFileSync('tar', [
            '-xzf',
            archive,
            '--strip-components=1',
            '-C',
            staging,
        ]);
        // This workspace consumes the package; it does not develop Ganglia or
        // carry the producer's tests and formatter configuration.
        const manifestFile = path.join(staging, 'package.json');
        const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
        delete manifest.devDependencies;
        delete manifest.scripts;
        await fs.writeFile(
            manifestFile,
            JSON.stringify(manifest, null, 2) + '\n',
        );
        const saved = { identity, sourceDigest: await sourceDigest(staging) };
        await fs.writeFile(
            path.join(staging, '.generated.json'),
            JSON.stringify(saved, null, 2) + '\n',
        );
        try {
            await fs.access(directory);
            await fs.access(receipt);
            await fs.rm(directory, { recursive: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            try {
                await fs.access(directory);
                throw new Error(
                    'Refusing to replace an unmarked Ganglia directory',
                );
            } catch (missing) {
                if (missing.code !== 'ENOENT') throw missing;
            }
        }
        await fs.rename(staging, directory);
        return saved;
    } finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
    console.log(JSON.stringify(await prepare(), null, 2));
