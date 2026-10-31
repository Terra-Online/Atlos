import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('./package-pages.mjs', import.meta.url));
const fixture = async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atlos-satellite-pages-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source'), output = path.join(root, 'pages');
    const files = {
        '.atlos-build.json': JSON.stringify({ target: 'org', channel: 'prod', apps: ['main', 'user-hub'] }),
        'index.html': '<html>map entry</html>', 'assets/main.js': 'main',
        'satellite/index.html': '<html>map entry</html>', 'satellite/Dijiang/1/1_1.webp': 'tile',
        'me/index.html': '<html>user hub</html>', 'me/assets/main.js': 'hub',
        'sitemap.xml': 'sitemap', 'robots.txt': 'robots', 'seo/points/r2/Ab12345.html': 'point',
    };
    for (const [file, contents] of Object.entries(files)) {
        await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
        await fs.writeFile(path.join(source, file), contents);
    }
    return { source, output, run: () => exec(process.execPath, [script, '--skip-intel', '--dist-dir', source, '--output-dir', output]) };
};

test('packages the satellite SPA entry without bringing tile resources into Pages', async (t) => {
    const { output, run } = await fixture(t);
    await run();
    assert.equal(await fs.readFile(path.join(output, 'satellite/index.html'), 'utf8'),
        await fs.readFile(path.join(output, 'index.html'), 'utf8'));
    assert.deepEqual(await fs.readdir(path.join(output, 'satellite')), ['index.html']);
    assert.ok(await fs.stat(path.join(output, 'me/index.html')));
});

test('rejects a missing satellite entry before replacing an existing package', async (t) => {
    const { source, output, run } = await fixture(t);
    await fs.rm(path.join(source, 'satellite/index.html'));
    await fs.mkdir(output);
    await fs.writeFile(path.join(output, '.atlos-pages.json'), '{}');
    await fs.writeFile(path.join(output, 'keep.txt'), 'previous package');
    await assert.rejects(run(), /satellite/);
    assert.equal(await fs.readFile(path.join(output, 'keep.txt'), 'utf8'), 'previous package');
});
