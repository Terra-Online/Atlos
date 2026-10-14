import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from './task-runner.mjs';
import { parseTask, runTask } from './tasks.mjs';
import { verifyArtifact, verifyOutput } from './release-artifact.mjs';

const fixture = async (t, fail = () => false) => {
    await fs.mkdir(path.join(ROOT, '.cache'), { recursive: true });
    const root = await fs.mkdtemp(path.join(ROOT, '.cache/workflow-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const calls = [];
    const write = async (file, text = 'fixture') => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, text);
    };
    const execute = async (command, args, { env, cwd }) => {
        const call = { command, args, env, cwd };
        calls.push(call);
        if (fail(call)) throw new Error('injected failure');
        if (args.includes('vite') && args.includes('build')) {
            const dir = args[args.indexOf('--outDir') + 1];
            await write(path.join(dir, 'index.html'));
            await write(path.join(dir, 'assets/app.js'));
        }
        if (env.SEO_PUBLIC_OUT_DIR) {
            await write(path.join(env.SEO_PUBLIC_OUT_DIR, 'robots.txt'));
            await write(path.join(env.SEO_PUBLIC_OUT_DIR, 'sitemap.xml'));
            await write(
                path.join(
                    env.SEO_PUBLIC_OUT_DIR,
                    'seo/points',
                    env.BUILD_TARGET,
                    'Ab12345.html',
                ),
            );
        }
    };
    for (const storage of ['oss', 'r2'])
        await write(
            path.join(
                root,
                'config',
                storage === 'oss' ? 'config.json' : 'config.r2.json',
            ),
            JSON.stringify({
                web: {
                    build: {
                        cdn: 'https://test.invalid',
                        [storage]: { prefix: '/prod', bucket: 'test' },
                        deployChannels: {
                            beta: { [`${storage}Prefix`]: '/beta' },
                        },
                    },
                },
            }),
        );
    return { root, calls, execute, env: {}, write, log: () => {} };
};
const isRemote = ({ args }) =>
    args.some(
        (arg) => /publish-|deploy-cn-server/.test(arg) || arg === 'deploy',
    );
const countScript = (calls, file) =>
    calls.filter(({ args }) => args.includes(`./scripts/${file}`)).length;

test('rejects invalid release arguments before any work and accepts pnpm separators', () => {
    assert.equal(
        parseTask(['deploy', '--target', 'all', '--', '--skip-og']).skipOg,
        true,
    );
    assert.equal(
        parseTask(['build', '--target=org', '--channel=beta']).target,
        'org',
    );
    for (const args of [
        ['build', '--deploy'],
        ['build', '--target', 'typo'],
        ['publish'],
        ['deploy', '--channel', 'beta'],
        ['publish', '--target', 'org', '--only', 'server'],
        ['publish', '--target', 'cn', '--only', 'server', '--channel', 'beta'],
        ['build', '--channel', 'typo'],
        ['build', '--target', 'all', '--dist-dir', 'x'],
        ['type-check', '--app', 'scripts'],
        ['test', '--app', 'search'],
    ])
        assert.throws(() => parseTask(args, {}));
});

test('full build prepares data and each font once across both targets without publishing', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--target', 'all'], {
        ...f,
        env: { VITE_AUTH_BASE: 'https://auth.test.invalid' },
    });
    assert.equal(countScript(f.calls, 'build-marker-version-new.mjs'), 1);
    assert.equal(countScript(f.calls, 'build-relink-preview.mjs'), 1);
    assert.equal(
        f.calls.filter(({ command }) => command === 'python3').length,
        3,
    );
    assert.equal(f.calls.filter(({ args }) => args.includes('vite')).length, 6);
    assert.equal(f.calls.some(isRemote), false);
    assert.ok(
        f.calls
            .filter(({ args }) => args.includes('@atlos/user-hub'))
            .every(
                ({ env }) => env.VITE_AUTH_BASE === 'https://auth.test.invalid',
            ),
    );
    for (const target of ['cn', 'org'])
        await verifyArtifact(
            path.join(f.root, 'dist', target === 'cn' ? 'oss' : 'r2'),
            { channel: 'prod' },
            target,
        );
});

test('skip OG and subset propagate through both site pipelines and shared Worker waits for both', async (t) => {
    const f = await fixture(t);
    await runTask(['deploy', '--skip-og', '--skip-subset-fonts'], f);
    assert.equal(
        f.calls.some(({ command }) => command === 'python3'),
        false,
    );
    assert.equal(
        f.calls.some(({ env }) => env.SEO_IMAGE_ONLY === '1'),
        false,
    );
    for (const call of f.calls
        .filter(isRemote)
        .filter(({ args }) => !args.includes('oem-relink')))
        assert.equal(call.env.SEO_SKIP_OG_UPLOAD, '1');
    assert.deepEqual(f.calls.at(-1).args, [
        '--filter',
        'oem-relink',
        'run',
        'deploy',
    ]);
});

test('default deploy builds OG for both targets and independent beta deploy only publishes ORG', async (t) => {
    const f = await fixture(t);
    await runTask(['deploy', '--skip-subset'], f);
    assert.equal(
        f.calls.filter(({ env }) => env.SEO_IMAGE_ONLY === '1').length,
        2,
    );
    const beta = await fixture(t);
    await runTask(
        [
            'deploy',
            '--target',
            'org',
            '--channel',
            'beta',
            '--skip-subset',
            '--skip-og',
        ],
        beta,
    );
    assert.equal(
        beta.calls.some(({ env }) => env.BUILD_TARGET === 'oss'),
        false,
    );
    assert.equal(
        beta.calls.some(({ args }) => args.includes('oem-relink')),
        false,
    );
    const pages = beta.calls.find(
        ({ args }) => args.includes('pages') && args.includes('deploy'),
    );
    assert.ok(pages.args.includes('oem-root-uatenv'));
    assert.ok(pages.args.includes('beta'));
});

test('a failed site waits for its peer and prevents the shared Worker deployment', async (t) => {
    const f = await fixture(t, ({ args }) =>
        args.includes('./scripts/publish-R2.js'),
    );
    await assert.rejects(
        runTask(['deploy', '--skip-subset', '--skip-og'], f),
        AggregateError,
    );
    assert.equal(
        f.calls.some(({ args }) =>
            args.includes('./scripts/deploy-cn-server.sh'),
        ),
        true,
    );
    assert.equal(
        f.calls.some(
            ({ args }) =>
                args.includes('oem-relink') && args.includes('deploy'),
        ),
        false,
    );
});

test('publish-only refuses wrong channels, missing apps, stale partial rebuilds, and source-only artifacts', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--skip-subset'], f);
    const initial = f.calls.length;
    await assert.rejects(
        runTask(
            ['publish', '--target', 'cn', '--only', 'oss', '--channel', 'beta'],
            f,
        ),
        /mismatch/,
    );
    assert.equal(f.calls.length, initial);
    await fs.rm(path.join(f.root, 'dist/oss/me/index.html'));
    await assert.rejects(
        runTask(['publish', '--target', 'cn', '--only', 'server'], f),
        /ENOENT/,
    );
    await runTask(['build', '--app', 'main', '--skip-subset'], f);
    await assert.rejects(
        runTask(['publish', '--target', 'cn', '--only', 'oss'], f),
        /ENOENT/,
    );
    await runTask(['build', '--source-only', '--skip-subset'], f);
    await assert.rejects(
        runTask(['publish', '--target', 'cn', '--only', 'oss'], f),
        /Source-only/,
    );
});

test('publish-only selects each recovery transport without rebuilding', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--target', 'all', '--skip-subset'], f);
    for (const [target, only, script] of [
        ['cn', 'oss', 'publish-oss.js'],
        ['cn', 'server', 'deploy-cn-server.sh'],
        ['org', 'r2', 'publish-R2.js'],
        ['org', 'resources', 'publish-R2.js'],
        ['org', 'pages', 'package-pages.mjs'],
    ]) {
        f.calls.length = 0;
        await runTask(
            ['publish', '--target', target, '--only', only, '--skip-og'],
            f,
        );
        assert.equal(
            f.calls.some(({ args }) => args.includes('build')),
            false,
        );
        assert.equal(countScript(f.calls, script), 1);
        if (only === 'server')
            assert.ok(f.calls[0].args.includes('--server-only'));
        if (only === 'resources')
            assert.equal(f.calls[0].env.R2_UPLOAD_PROFILE, 'resources');
        if (only === 'pages')
            assert.equal(countScript(f.calls, 'publish-R2.js'), 0);
    }
});

test('CI check builds all targets after preparing types only once and covers standalone tests', async (t) => {
    const f = await fixture(t);
    await runTask(['check', '--build', '--source-only', '--skip-subset'], f);
    assert.equal(countScript(f.calls, 'build-marker-version-new.mjs'), 1);
    assert.equal(countScript(f.calls, 'build-relink-preview.mjs'), 1);
    assert.equal(f.calls.filter(({ args }) => args.includes('tsc')).length, 5);
    assert.equal(
        f.calls.filter(({ args }) => args.includes('vitest')).length,
        3,
    );
    assert.ok(
        f.calls.some(({ args }) =>
            args.includes('apps/intel/vitest.config.ts'),
        ),
    );
    assert.ok(
        f.calls.some(({ args }) =>
            args.includes('apps/user-hub/vitest.config.ts'),
        ),
    );
    assert.equal(f.calls.some(isRemote), false);
});

test('dry-run performs no commands, writes, packaging, or network publication', async (t) => {
    const f = await fixture(t);
    await runTask(['deploy', '--dry-run'], {
        ...f,
        execute: () => {
            throw new Error('dry-run executed a command');
        },
    });
    assert.deepEqual(await fs.readdir(f.root), ['config']);
});

test('refuses source outputs, symlink escapes and unowned external packaging directories', async (t) => {
    const f = await fixture(t);
    await assert.rejects(verifyOutput(f.root, f.root), /Unsafe/);
    await assert.rejects(
        verifyOutput(f.root, path.join(f.root, 'src')),
        /Unsafe/,
    );
    await assert.rejects(
        verifyOutput(f.root, path.join(f.root, 'src'), 'pages'),
        /Unsafe/,
    );
    await fs.mkdir(path.join(f.root, 'src'));
    await fs.mkdir(path.join(f.root, 'dist'));
    await fs.symlink(
        path.join(f.root, 'src'),
        path.join(f.root, 'dist/escape'),
    );
    await assert.rejects(
        verifyOutput(f.root, path.join(f.root, 'dist/escape')),
        /Unsafe/,
    );
    await assert.rejects(
        runTask(
            [
                'build',
                '--app',
                'intel',
                '--dist-dir',
                'dist/escape',
                '--skip-subset',
            ],
            f,
        ),
        /Unsafe/,
    );
    assert.equal(f.calls.length, 0);
    await verifyOutput(f.root, path.join(f.root, 'dist/oss'));
});

test('refuses changed resource destinations and beta overrides pointing at prod', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--skip-subset'], f);
    await assert.rejects(
        runTask(['publish', '--target', 'cn', '--only', 'oss'], {
            ...f,
            env: { DEPLOY_PREFIX: '/other' },
        }),
        /resource destination/,
    );
    await assert.rejects(
        runTask(
            ['build', '--target', 'org', '--channel', 'beta', '--skip-subset'],
            { ...f, env: { DEPLOY_PREFIX: '/prod' } },
        ),
        AggregateError,
    );
    await assert.rejects(
        runTask(
            ['build', '--target', 'org', '--channel', 'beta', '--skip-subset'],
            {
                ...f,
                env: {
                    DEPLOY_PROD_PREFIX: '/live',
                    DEPLOY_BETA_PREFIX: '/live',
                },
            },
        ),
        AggregateError,
    );
});
