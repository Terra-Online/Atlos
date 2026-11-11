import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('refreshes a pinned source package without carrying producer tools or overwriting edits', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'ganglia-inputs-'));
    try {
        for (const name of [
            'scripts',
            'apps/world',
            'vendor/ganglia',
            'fixture/package/src',
        ])
            await fs.mkdir(path.join(root, name), { recursive: true });
        await fs.copyFile(
            new URL('./ganglia.mjs', import.meta.url),
            path.join(root, 'scripts/ganglia.mjs'),
        );
        const source = path.join(root, 'fixture/package/src/index.ts');
        const archive = path.join(root, 'vendor/ganglia/pinned.tgz');
        await fs.writeFile(
            path.join(root, 'apps/world/package.json'),
            JSON.stringify({
                dependencies: {
                    '@opendfieldmap/ganglia':
                        'file:../../vendor/ganglia/pinned.tgz',
                },
            }),
        );
        await fs.writeFile(
            path.join(root, 'fixture/package/package.json'),
            JSON.stringify({
                name: '@opendfieldmap/ganglia',
                dependencies: { dependency: '1' },
                scripts: { test: 'producer-only' },
                devDependencies: { tool: '1' },
            }),
        );
        const pack = () =>
            execFileSync('tar', [
                '-czf',
                archive,
                '-C',
                path.join(root, 'fixture'),
                'package',
            ]);
        const run = () =>
            spawnSync(process.execPath, ['scripts/ganglia.mjs'], {
                cwd: root,
                encoding: 'utf8',
            });
        await fs.writeFile(source, 'export const value = 1;\n');
        pack();
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        assert.equal(run().stdout, first.stdout);
        const output = path.join(root, '.cache/ganglia');
        const manifest = JSON.parse(
            await fs.readFile(path.join(output, 'package.json'), 'utf8'),
        );
        assert.deepEqual(manifest.dependencies, { dependency: '1' });
        assert.equal(manifest.devDependencies, undefined);
        assert.equal(manifest.scripts, undefined);
        await fs.writeFile(path.join(output, 'src/index.ts'), 'local edit\n');
        assert.match(run().stderr, /source was edited/);
        assert.equal(
            await fs.readFile(path.join(output, 'src/index.ts'), 'utf8'),
            'local edit\n',
        );
        await fs.copyFile(source, path.join(output, 'src/index.ts'));
        await fs.writeFile(source, 'export const value = 2;\n');
        pack();
        const second = run();
        assert.equal(second.status, 0, second.stderr);
        assert.notEqual(
            JSON.parse(second.stdout).identity,
            JSON.parse(first.stdout).identity,
        );
        assert.equal(
            await fs.readFile(path.join(output, 'src/index.ts'), 'utf8'),
            'export const value = 2;\n',
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
