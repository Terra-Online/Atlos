import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('prepares reproducible source and rejects altered inputs or edited generated code', async () => {
    const root = await fs.mkdtemp(path.join(tmpdir(), 'noclip-inputs-'));
    try {
        const input = path.join(root, 'integrations/noclip');
        await fs.mkdir(input, { recursive: true });
        await fs.mkdir(path.join(root, 'scripts'));
        await fs.copyFile(new URL('./noclip.mjs', import.meta.url), path.join(root, 'scripts/noclip.mjs'));
        const source = path.join(root, 'fixture');
        await fs.mkdir(source);
        await fs.writeFile(path.join(source, 'value.txt'), 'upstream\n');
        execFileSync('tar', ['-czf', path.join(input, 'upstream.tar.gz'), '-C', source, 'value.txt']);
        const archive = await fs.readFile(path.join(input, 'upstream.tar.gz'));
        const manifest = { archive: 'upstream.tar.gz', commit: 'fixture', sha256: createHash('sha256').update(archive).digest('hex'), patches: ['local.patch'], packageVersion: 1 };
        await fs.writeFile(path.join(input, 'source.json'), JSON.stringify(manifest));
        const patch = 'diff --git a/value.txt b/value.txt\n--- a/value.txt\n+++ b/value.txt\n@@ -1 +1 @@\n-upstream\n+hosted\n';
        await fs.writeFile(path.join(input, 'local.patch'), patch);
        const run = () => spawnSync(process.execPath, ['scripts/noclip.mjs', 'prepare'], { cwd: root, encoding: 'utf8' });
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        const output = path.join(root, '.cache/noclip/value.txt');
        assert.equal(await fs.readFile(output, 'utf8'), 'hosted\n');
        assert.equal(run().stdout, first.stdout);
        await fs.appendFile(path.join(input, 'upstream.tar.gz'), 'tamper');
        assert.match(run().stderr, /checksum differs/);
        assert.equal(await fs.readFile(output, 'utf8'), 'hosted\n');
        await fs.writeFile(path.join(input, 'upstream.tar.gz'), archive);
        await fs.writeFile(output, 'local edit\n');
        assert.match(run().stderr, /source was edited/);
        assert.equal(await fs.readFile(output, 'utf8'), 'local edit\n');
        await fs.writeFile(output, 'hosted\n');
        await fs.writeFile(path.join(input, 'local.patch'), patch.replace('-upstream', '-wrong baseline'));
        assert.notEqual(run().status, 0);
        assert.equal(await fs.readFile(output, 'utf8'), 'hosted\n');
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
