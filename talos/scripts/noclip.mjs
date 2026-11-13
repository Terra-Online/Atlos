import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = path.join(root, 'integrations/noclip');
export const directory = path.join(root, '.cache/noclip');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function sourceDigest(base) {
    const hash = createHash('sha256');
    const visit = async (relative = '') => {
        const entries = await fs.readdir(path.join(base, relative), { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            if (['node_modules', '.generated.json', 'out', 'dist', '.research'].includes(entry.name)) continue;
            const name = path.join(relative, entry.name);
            if (entry.isDirectory()) await visit(name);
            else if (entry.isFile()) hash.update(name + '\0').update(await fs.readFile(path.join(base, name)));
            else if (entry.isSymbolicLink()) hash.update(name + '\0symlink\0' + await fs.readlink(path.join(base, name)));
            else throw new Error('Unexpected source entry: ' + name);
        }
    };
    await visit();
    return hash.digest('hex');
}

/** The cache is generated source, never an independent checkout or a place to edit. */
export async function prepare() {
    const manifestBytes = await fs.readFile(path.join(input, 'source.json'));
    const manifest = JSON.parse(manifestBytes);
    const archive = await fs.readFile(path.join(input, manifest.archive));
    if (digest(archive) !== manifest.sha256) throw new Error('noclip upstream archive checksum differs');
    const patches = await Promise.all(manifest.patches.map((name) => fs.readFile(path.join(input, name))));
    const identity = digest(Buffer.concat([manifestBytes, ...patches]));
    const receipt = path.join(directory, '.generated.json');
    try {
        const saved = JSON.parse(await fs.readFile(receipt, 'utf8'));
        if (saved.sourceDigest && saved.sourceDigest !== await sourceDigest(directory)) {
            throw new Error('Generated noclip source was edited; move changes into integrations/noclip patches before preparing');
        }
        if (saved.identity === identity && saved.sourceDigest) return saved;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    const staging = directory + '-prepare-' + process.pid;
    await fs.mkdir(staging, { recursive: true });
    try {
        execFileSync('tar', ['-xzf', path.join(input, manifest.archive), '-C', staging]);
        for (const name of manifest.patches) {
            execFileSync('git', ['apply', '--unsafe-paths', '--directory=' + staging, path.join(input, name)], { cwd: '/tmp' });
        }
        const saved = { identity, upstream: manifest.commit, packageVersion: manifest.packageVersion, sourceDigest: await sourceDigest(staging) };
        await fs.writeFile(path.join(staging, '.generated.json'), JSON.stringify(saved, null, 2) + '\n');
        try {
            await fs.access(directory);
            // Only replace a directory created by this script.
            await fs.access(receipt);
            await fs.rm(directory, { recursive: true });
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            try { await fs.access(directory); throw new Error('Refusing to replace an unmarked noclip directory'); }
            catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
        }
        await fs.rename(staging, directory);
        return saved;
    } finally {
        await fs.rm(staging, { recursive: true, force: true });
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv[2] !== 'prepare') throw new Error('Use noclip.mjs prepare');
    console.log(JSON.stringify(await prepare(), null, 2));
}
