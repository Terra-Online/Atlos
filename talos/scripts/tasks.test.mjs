import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { ROOT } from './task-runner.mjs';
import { parseTask, runTask } from './tasks.mjs';
import { verifyArtifact, verifyOutput } from './release-artifact.mjs';
import { hashFiles, verifyReferences } from './release-snapshot.mjs';
import { withLocalLock, createReleaseStore } from './release-store.mjs';
import { createServer } from 'node:http';

const fixture = async (t, fail = () => false) => {
    await fs.mkdir(path.join(ROOT, '.cache'), { recursive: true });
    const root = await fs.mkdtemp(path.join(ROOT, '.cache/workflow-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const calls = [];
    const states = new Map();
    const locks = new Set();
    const live = new Map();
    let buildNumber = 0;
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
            await fs.rm(dir, { recursive: true, force: true });
            const name = args.includes('@atlos/intel')
                ? 'intel'
                : args.includes('@atlos/user-hub')
                  ? 'me'
                  : '';
            const prefix = name
                ? `/${name}`
                : `https://test.invalid/${env.DEPLOY_CHANNEL === 'beta' ? 'beta' : 'prod'}`;
            const asset = `app-${++buildNumber}`;
            await write(
                path.join(dir, 'index.html'),
                `<html><script type="module" src="${prefix}/assets/${asset}.js"></script><link rel="stylesheet" href="${prefix}/assets/${asset}.css"></html>`,
            );
            await write(
                path.join(dir, `assets/${asset}.js`),
                `export default ${buildNumber};`,
            );
            await write(
                path.join(dir, `assets/${asset}.css`),
                `body{opacity:1}`,
            );
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
        if (
            (args.includes('pages') && args.includes('deploy')) ||
            args.includes('./scripts/deploy-cn-server.sh')
        ) {
            const files = await hashFiles(env.DIST_DIR);
            const contents = new Map();
            for (const file of Object.keys(files))
                contents.set(
                    file,
                    await fs.readFile(path.join(env.DIST_DIR, file)),
                );
            live.set(`${env.BUILD_TARGET}-${env.DEPLOY_CHANNEL}`, contents);
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
    const releaseStore = async (_runner, options, target) => {
        const key = `${target}-${options.channel}`;
        return {
            read: async () => states.get(key),
            write: async (state) => {
                states.set(key, state);
            },
            acquire: async () => {
                if (locks.has(key)) throw new Error('Remote release lock held');
                locks.add(key);
                return async () => {
                    locks.delete(key);
                };
            },
        };
    };
    const fetch = async (url) => {
        const storage = url.hostname.endsWith('.cn') ? 'oss' : 'r2';
        const channel = url.hostname.startsWith('beta.') ? 'beta' : 'prod';
        const file =
            url.pathname.replace(/^\//, '').replace(/\/$/, '/index.html') ||
            'index.html';
        const assetFile = file.replace(/^(?:prod|beta)\//, '');
        const body =
            live.get(`${storage}-${channel}`)?.get(file) ||
            [...live.values()].map((site) => site.get(assetFile)).find(Boolean);
        return new Response(body || 'not found', {
            status: body ? 200 : 404,
            headers: {
                'Content-Type': file.endsWith('.html')
                    ? 'text/html'
                    : file.endsWith('.css')
                      ? 'text/css'
                      : 'application/javascript',
            },
        });
    };
    return {
        root,
        calls,
        execute,
        env: {},
        write,
        releaseStore,
        fetch,
        states,
        live,
        locks,
        log: () => {},
    };
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
    for (const command of ['build', 'deploy', 'publish', 'package', 'og'])
        assert.equal(parseTask([command]).target, 'org');
    for (const args of [
        ['build', '--deploy'],
        ['build', '--target', 'typo'],
        ['deploy', '--target', 'all', '--channel', 'beta'],
        ['publish', '--target', 'org', '--only', 'server'],
        ['publish', '--target', 'cn', '--only', 'server', '--channel', 'beta'],
        ['build', '--channel', 'typo'],
        ['build', '--target', 'all', '--dist-dir', 'x'],
        ['type-check', '--app', 'scripts'],
        ['test', '--app', 'search'],
        ['deploy', '--app', 'main'],
        ['publish', '--app', 'all'],
        ['publish', '--app', 'intel', '--only', 'pages'],
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
    await runTask(
        ['deploy', '--target', 'all', '--skip-og', '--skip-subset-fonts'],
        f,
    );
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

test('explicit all-target deploy builds OG for both targets and independent beta deploy only publishes ORG', async (t) => {
    const f = await fixture(t);
    await runTask(['deploy', '--target', 'all', '--skip-subset'], f);
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
        runTask(['deploy', '--target', 'all', '--skip-subset', '--skip-og'], f),
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
    await runTask(['build', '--target', 'cn', '--skip-subset'], f);
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
    await runTask(
        ['build', '--target', 'cn', '--app', 'main', '--skip-subset'],
        f,
    );
    await assert.rejects(
        runTask(['publish', '--target', 'cn', '--only', 'oss'], f),
        /ENOENT/,
    );
    await runTask(
        ['build', '--target', 'cn', '--source-only', '--skip-subset'],
        f,
    );
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
    await runTask(['deploy', '--app', 'intel', '--dry-run'], {
        ...f,
        execute: () => {
            throw new Error('dry-run executed a command');
        },
    });
    assert.deepEqual(await fs.readdir(f.root), ['config']);
});

test('OSS adapter enforces exclusive writes and refuses versioned buckets', async (t) => {
    const f = await fixture(t);
    const objects = new Map();
    let versioning = '';
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://localhost');
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        if (url.searchParams.has('versioning')) {
            response.setHeader('Content-Type', 'application/xml');
            response.end(
                `<VersioningConfiguration>${versioning ? `<Status>${versioning}</Status>` : ''}</VersioningConfiguration>`,
            );
            return;
        }
        if (request.method === 'PUT') {
            if (
                request.headers['x-oss-forbid-overwrite'] === 'true' &&
                objects.has(url.pathname)
            ) {
                response.writeHead(409, { 'Content-Type': 'application/xml' });
                response.end(
                    '<Error><Code>FileAlreadyExists</Code><Message>Object already exists</Message></Error>',
                );
                return;
            }
            objects.set(url.pathname, Buffer.concat(chunks).toString());
            response.writeHead(200, { ETag: '"test-etag"' });
        } else if (request.method === 'GET') {
            if (!objects.has(url.pathname)) {
                response.writeHead(404, { 'Content-Type': 'application/xml' });
                response.end(
                    '<Error><Code>NoSuchKey</Code><Message>Missing object</Message></Error>',
                );
                return;
            }
            response.end(objects.get(url.pathname));
            return;
        } else if (request.method === 'DELETE') {
            objects.delete(url.pathname);
            response.writeHead(204);
        }
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(
        () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(resolve);
            }),
    );
    await f.write(
        path.join(f.root, 'config/config.json'),
        JSON.stringify({
            web: {
                build: {
                    oss: {
                        endpoint: `http://127.0.0.1:${server.address().port}`,
                        cname: true,
                        region: 'oss-cn-hangzhou',
                        bucket: 'test-bucket',
                        prefix: '/prod',
                        accessKeyId: 'test-key',
                        accessKeySecret: 'test-secret',
                    },
                },
            },
        }),
    );
    const first = await createReleaseStore(f, { channel: 'prod' }, 'cn');
    const second = await createReleaseStore(f, { channel: 'prod' }, 'cn');
    assert.equal(await first.read(), null);
    const unlock = await first.acquire();
    await assert.rejects(second.acquire(), /Cannot acquire release lock/);
    await first.write({ status: 'ready', id: 'cn-release' });
    assert.deepEqual(await second.read(), {
        status: 'ready',
        id: 'cn-release',
    });
    await unlock();
    await (
        await second.acquire()
    )();
    versioning = 'Suspended';
    await assert.rejects(
        createReleaseStore(f, { channel: 'prod' }, 'cn'),
        /unversioned OSS bucket/,
    );
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
    await runTask(['build', '--target', 'cn', '--skip-subset'], f);
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

test('default packaging builds the ORG artifact and never publishes', async (t) => {
    const f = await fixture(t);
    await runTask(['package', '--skip-subset'], f);
    await verifyArtifact(
        path.join(f.root, 'dist/r2'),
        { channel: 'prod' },
        'org',
    );
    const archive = f.calls.find(({ args }) =>
        args.includes('./scripts/package-dist.mjs'),
    );
    assert.equal(archive.args[archive.args.indexOf('--target') + 1], 'org');
    assert.equal(archive.env.BUILD_TARGET, 'r2');
    assert.equal(f.calls.some(isRemote), false);
});

test('rebuilds owned external app outputs while rejecting symlinks into unrelated directories', async (t) => {
    const f = await fixture(t);
    const external = await fs.mkdtemp(
        path.join(os.tmpdir(), 'atlos-artifact-'),
    );
    t.after(() => fs.rm(external, { recursive: true, force: true }));
    const dir = path.join(external, 'site');
    const args = ['build', '--dist-dir', dir, '--skip-subset'];
    await runTask(args, f);
    await runTask(args, f);
    await verifyArtifact(dir, { channel: 'prod' }, 'org');
    const unrelated = path.join(external, 'unrelated');
    await f.write(path.join(unrelated, 'keep.txt'));
    await fs.rm(path.join(dir, 'me'), { recursive: true });
    await fs.symlink(unrelated, path.join(dir, 'me'));
    const count = f.calls.length;
    await assert.rejects(runTask(args, f), /unrelated directory/);
    assert.equal(f.calls.length, count);
    assert.equal(
        await fs.readFile(path.join(unrelated, 'keep.txt'), 'utf8'),
        'fixture',
    );
});

test('standalone builds leave the complete-site artifact and receipt intact', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--skip-subset'], f);
    const before = await hashFiles(path.join(f.root, 'dist/r2'));
    for (const app of ['intel', 'user-hub']) {
        await runTask(['build', '--app', app, '--skip-subset'], f);
        assert.deepEqual(await hashFiles(path.join(f.root, 'dist/r2')), before);
        const name = app === 'intel' ? 'intel' : 'me';
        const info = JSON.parse(
            await fs.readFile(
                path.join(
                    f.root,
                    'dist/apps/org-prod',
                    name,
                    '.atlos-app.json',
                ),
            ),
        );
        assert.equal(info.app, app);
    }
    await verifyArtifact(
        path.join(f.root, 'dist/r2'),
        { channel: 'prod' },
        'org',
    );
});

test('app releases on both hosts preserve other apps and retain previous hashed chunks', async (t) => {
    for (const target of ['org', 'cn']) {
        const f = await fixture(t);
        await runTask(
            ['deploy', '--target', target, '--skip-subset', '--skip-og'],
            f,
        );
        const published = path.join(
            f.root,
            `.release-work/${target}-prod/published`,
        );
        let previous = await hashFiles(published);
        for (const app of ['intel', 'user-hub']) {
            f.calls.length = 0;
            await runTask(
                ['deploy', '--target', target, '--app', app, '--skip-subset'],
                f,
            );
            const next = await hashFiles(published);
            const prefix = app === 'intel' ? 'intel/' : 'me/';
            for (const [file, hash] of Object.entries(previous)) {
                if (!file.startsWith(prefix) && file !== '.atlos-build.json')
                    assert.equal(next[file], hash, file);
                if (file.startsWith(`${prefix}assets/`))
                    assert.equal(next[file], hash, file);
            }
            assert.notEqual(
                next[`${prefix}index.html`],
                previous[`${prefix}index.html`],
            );
            assert.equal(
                f.calls.filter(({ args }) => args.includes('vite')).length,
                1,
            );
            assert.ok(
                f.calls
                    .filter(({ args }) => args.includes('vite'))
                    .every(({ args }) => args.includes(`@atlos/${app}`)),
            );
            assert.equal(
                f.calls.some(({ env }) => env.SEO_IMAGE_ONLY === '1'),
                false,
            );
            const transport = f.calls.find(({ args }) =>
                args.includes(
                    target === 'org'
                        ? './scripts/publish-R2.js'
                        : './scripts/deploy-cn-server.sh',
                ),
            );
            assert.equal(transport.env.PUBLISH_APP_PATH, prefix.slice(0, -1));
            const info = JSON.parse(
                await fs.readFile(path.join(published, '.atlos-build.json')),
            );
            assert.ok(info.appVersions[app].source);
            assert.equal(f.states.get(`${target}-prod`).status, 'ready');
            previous = next;
        }
    }
});

test('app publish refuses missing, stale, tampered and wrong-channel baselines without uploads', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--app', 'intel', '--skip-subset'], f);
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /full release baseline/,
    );
    assert.equal(f.calls.some(isRemote), false);
    await runTask(['deploy', '--skip-subset', '--skip-og'], f);
    const state = f.states.get('org-prod');
    const previousCalls = f.calls.length;
    f.states.set('org-prod', { ...state, id: 'another-host-release' });
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /stale or modified/,
    );
    f.states.set('org-prod', state);
    const appIndex = path.join(f.root, 'dist/apps/org-prod/intel/index.html');
    const index = await fs.readFile(appIndex);
    await fs.writeFile(appIndex, 'tampered');
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /App artifact is modified/,
    );
    await fs.writeFile(appIndex, index);
    await f.write(
        path.join(f.root, '.release-work/org-prod/published/index.html'),
        'tampered baseline',
    );
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /stale or modified/,
    );
    await assert.rejects(
        runTask(['publish', '--app', 'intel', '--channel', 'beta'], f),
        /full release baseline/,
    );
    assert.equal(f.calls.length, previousCalls);
    assert.equal(f.states.get('org-prod').id, state.id);
});

test('out-of-band live entrypoint changes and shared-resource changes block app publication', async (t) => {
    const f = await fixture(t);
    await runTask(['deploy', '--skip-subset', '--skip-og'], f);
    await runTask(['build', '--app', 'user-hub', '--skip-subset'], f);
    const before = f.calls.length;
    const live = f.live.get('r2-prod');
    const main = live.get('index.html');
    live.set('index.html', Buffer.from('a different release'));
    await assert.rejects(
        runTask(['publish', '--app', 'user-hub'], f),
        /Live entrypoint differs/,
    );
    live.set('index.html', main);
    await f.write(
        path.join(f.root, 'src/assets/images/emoji/new.webp'),
        'new emoji',
    );
    await assert.rejects(
        runTask(['publish', '--app', 'user-hub'], f),
        /Shared resource changed/,
    );
    assert.equal(f.calls.length, before);
});

test('missing stylesheet and module dependencies are rejected before any remote mutation', async (t) => {
    const f = await fixture(t);
    await runTask(['build', '--skip-subset'], f);
    const directory = path.join(f.root, 'dist/r2');
    const index = await fs.readFile(path.join(directory, 'index.html'), 'utf8');
    const css = index.match(/assets\/([^"']+\.css)/)[1];
    await fs.rm(path.join(directory, 'assets', css));
    await assert.rejects(runTask(['publish'], f), /Missing referenced asset/);
    assert.equal(f.calls.some(isRemote), false);
    assert.equal(f.states.size, 0);
    await f.write(
        path.join(directory, 'assets', css),
        'body{background:url("data:image/svg+xml,<svg><path clip-path=\'url(%23clip)\'/></svg>")}',
    );
    await verifyReferences(
        directory,
        JSON.parse(
            await fs.readFile(path.join(directory, '.atlos-build.json')),
        ),
        'https://opendfieldmap.org',
    );
    const js = index.match(/assets\/([^"']+\.js)/)[1];
    await f.write(path.join(directory, 'assets', js), 'import "./missing.js";');
    await assert.rejects(runTask(['publish'], f), /Missing referenced asset/);
    assert.equal(f.states.size, 0);
});

test('failed or transport-only publications invalidate the app baseline until a full publish succeeds', async (t) => {
    let failPages = false;
    const f = await fixture(
        t,
        ({ args }) =>
            failPages && args.includes('pages') && args.includes('deploy'),
    );
    await runTask(['deploy', '--skip-subset', '--skip-og'], f);
    const baseline = f.states.get('org-prod').id;
    failPages = true;
    await assert.rejects(
        runTask(['deploy', '--app', 'intel', '--skip-subset'], f),
        AggregateError,
    );
    assert.equal(f.states.get('org-prod').status, 'publishing');
    const saved = JSON.parse(
        await fs.readFile(
            path.join(
                f.root,
                '.release-work/org-prod/published/.atlos-snapshot.json',
            ),
        ),
    );
    assert.equal(saved.id, baseline);
    assert.equal(f.locks.size, 1);
    // The failed publisher has stopped; simulate explicit operator lock recovery.
    f.locks.clear();
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /full release baseline/,
    );
    assert.equal(f.locks.size, 0);
    failPages = false;
    await runTask(['publish', '--skip-og'], f);
    assert.equal(f.states.get('org-prod').status, 'ready');
    await runTask(['publish', '--only', 'pages', '--skip-og'], f);
    assert.equal(f.states.get('org-prod').status, 'partial');
    await assert.rejects(
        runTask(['publish', '--app', 'intel'], f),
        /full release baseline/,
    );
});

test('local and remote locks reject concurrent work without removing another owner lock', async (t) => {
    const f = await fixture(t);
    await withLocalLock(f.root, async () => {
        await assert.rejects(
            runTask(['build', '--skip-subset'], f),
            /Another release\/build/,
        );
        assert.ok(await fs.stat(path.join(f.root, '.cache/release.lock')));
        assert.equal(f.calls.length, 0);
    });
    await runTask(['build', '--skip-subset'], f);
    const store = await f.releaseStore(null, { channel: 'prod' }, 'org');
    const unlock = await store.acquire();
    await assert.rejects(runTask(['publish'], f), /Remote release lock held/);
    assert.equal(f.locks.size, 1);
    assert.equal(f.states.size, 0);
    await unlock();
});

test('R2 adapter uses exclusive writes across independent clients and preserves a foreign lock', async (t) => {
    const f = await fixture(t);
    const objects = new Map();
    const server = createServer(async (request, response) => {
        const key = new URL(request.url, 'http://localhost').pathname;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        if (request.method === 'PUT') {
            if (request.headers['if-none-match'] === '*' && objects.has(key)) {
                response.writeHead(412, { 'Content-Type': 'application/xml' });
                response.end('<Error><Code>PreconditionFailed</Code></Error>');
                return;
            }
            objects.set(key, Buffer.concat(chunks).toString());
            response.writeHead(200, { ETag: '"test-etag"' });
        } else if (request.method === 'GET') {
            if (!objects.has(key)) {
                response.writeHead(404, { 'Content-Type': 'application/xml' });
                response.end('<Error><Code>NoSuchKey</Code></Error>');
                return;
            }
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(objects.get(key));
            return;
        } else if (request.method === 'DELETE') {
            objects.delete(key);
            response.writeHead(204);
        }
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(
        () =>
            new Promise((resolve) => {
                server.closeAllConnections();
                server.close(resolve);
            }),
    );
    await f.write(
        path.join(f.root, 'config/config.r2.json'),
        JSON.stringify({
            web: {
                build: {
                    r2: {
                        endpoint: `http://127.0.0.1:${server.address().port}`,
                        region: 'auto',
                        bucket: 'test',
                        prefix: '/prod',
                        accessKeyId: 'test-key',
                        accessKeySecret: 'test-secret',
                    },
                },
            },
        }),
    );
    const options = { channel: 'prod' };
    const first = await createReleaseStore(f, options, 'org');
    const second = await createReleaseStore(f, options, 'org');
    assert.equal(await first.read(), null);
    const unlock = await first.acquire();
    await assert.rejects(second.acquire(), /Cannot acquire release lock/);
    await first.write({ status: 'publishing', id: 'release-id' });
    assert.deepEqual(await second.read(), {
        status: 'publishing',
        id: 'release-id',
    });
    const key = [...objects.keys()].find((name) => name.endsWith('/lock.json'));
    const owner = objects.get(key);
    objects.set(key, JSON.stringify({ owner: 'another-publisher' }));
    await assert.rejects(unlock(), /ownership changed/);
    assert.ok(objects.has(key));
    objects.set(key, owner);
    await unlock();
    await (
        await second.acquire()
    )();
});
