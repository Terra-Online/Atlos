import assert from 'node:assert/strict';
import test from 'node:test';
import postcss from 'postcss';
import { literalText } from './catalog.mjs';
import { regionFontStyles } from './vite-plugin.mjs';

test('ICU extraction collects literal branches without argument/selector identifiers', () => {
    const text = literalText(
        '{count, plural, one {一份} other {#份}}，{name} {kind, select, yes {开启} other {关闭}}',
        'zh-CN',
    );
    assert.match(text, /一份/);
    assert.match(text, /0123456789份/);
    assert.match(text, /开启关闭/);
    assert.doesNotMatch(text, /count|name|kind|other|yes/);
});

test('region variables preserve family precedence and face definitions', async () => {
    const result = await postcss([regionFontStyles()]).process(
        `@font-face{font-family:'HMSans';src:url(h.woff2)} .a{font-family:'Novecento Medium','HMSans_EN',HMSans,'UD_ShinGo Regular',sans-serif}.b{font-family:"UD_ShinGo Bold"}`,
        { from: undefined },
    );
    assert.match(result.css, /@font-face\{font-family:'HMSans'/);
    assert.match(
        result.css,
        /'Novecento Medium','HMSans_EN',var\(--font-h, "Atlos-pending-h"\),var\(--font-r, "Atlos-pending-r"\),sans-serif/,
    );
    assert.match(result.css, /var\(--font-b, "Atlos-pending-b"\)/);
});

test('build validation rejects modified immutable resources and partial diagnostics', async (t) => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    const { createHash } = await import('node:crypto');
    const { checkFonts } = await import('./vite-plugin.mjs');
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), 'atlos-font-contract-'),
    );
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const output = path.join(directory, '.cache/font-shards/v1');
    await fs.mkdir(output, { recursive: true });
    const write = async (stem, ext, content) => {
        const name = `${stem}-${createHash('sha256').update(content).digest('hex').slice(0, 20)}.${ext}`;
        await fs.writeFile(path.join(output, name), content);
        return name;
    };
    const shard = await write('font', 'woff2', 'original');
    const index = {};
    const makeManifest = (region, faces) =>
        JSON.stringify({
            version: 'v1',
            region,
            packing: { target: 1024, minimum: 512, maximum: 1536 },
            maps: ['U+4E00'],
            faces: Object.fromEntries(
                faces.map((face) => [
                    face,
                    { base: { file: shard, map: 0, range: 0, bytes: 8 } },
                ]),
            ),
        });
    for (const region of ['CN', 'HK', 'JP'])
        index[region] = await write(
            region,
            'json',
            makeManifest(
                region,
                region === 'JP'
                    ? ['b', 'db', 'm', 'r']
                    : ['b', 'db', 'm', 'r', 'h'],
            ),
        );
    await fs.writeFile(path.join(output, 'index.json'), JSON.stringify(index));
    await checkFonts(directory);
    await fs.writeFile(path.join(output, shard), 'corrupted');
    await assert.rejects(
        checkFonts(directory),
        /Modified immutable font resource/,
    );
    await fs.writeFile(path.join(output, shard), 'original');
    index.CN = await write('CN', 'json', makeManifest('CN', ['r']));
    await fs.writeFile(path.join(output, 'index.json'), JSON.stringify(index));
    await assert.rejects(
        checkFonts(directory),
        /Incomplete frozen font manifest/,
    );
});
