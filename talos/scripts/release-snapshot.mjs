import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
    apps,
    receipt,
    verifyArtifact,
    resourceConfig,
} from './release-artifact.mjs';
import { pagesConfig } from './pages-config.mjs';

export const appReceipt = '.atlos-app.json';
const snapshotReceipt = '.atlos-snapshot.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const hashFile = async (file) => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
};

export const hashFiles = async (directory) => {
    const files = {};
    const visit = async (relative) => {
        for (const item of (
            await fs.readdir(path.join(directory, relative), {
                withFileTypes: true,
            })
        ).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
            const name = path.posix.join(relative, item.name);
            if (item.isSymbolicLink())
                throw new Error(
                    `Symlinks are not allowed in release artifacts: ${name}`,
                );
            if (['.DS_Store', snapshotReceipt, appReceipt].includes(item.name))
                continue;
            if (item.isDirectory()) await visit(name);
            else if (item.isFile())
                files[name] = await hashFile(path.join(directory, name));
            else throw new Error(`Unsupported release artifact: ${name}`);
        }
    };
    await visit('');
    return files;
};
const digest = (files) =>
    sha256(
        JSON.stringify(
            Object.entries(files).sort(([a], [b]) => a.localeCompare(b, 'en')),
        ),
    );
const json = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
const writeJson = (file, value) =>
    fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const snapshotPath = async (runner, target, channel) => {
    const parent = path.join(
        runner.root,
        '.release-work',
        `${target}-${channel}`,
    );
    await fs.mkdir(parent, { recursive: true });
    if (
        (await fs.realpath(parent)) !==
        path.join(
            await fs.realpath(runner.root),
            '.release-work',
            `${target}-${channel}`,
        )
    )
        throw new Error('Release snapshot directories must not be symlinks.');
    const published = path.join(parent, 'published');
    if (
        await fs.lstat(published).then(
            (entry) => entry.isSymbolicLink(),
            () => false,
        )
    )
        throw new Error('Release snapshot directories must not be symlinks.');
    return published;
};

export const siteUrl = async (runner, options, target) => {
    if (target === 'org')
        return `https://${pagesConfig[options.channel].customDomain}`;
    const config = await json(path.join(runner.root, 'config/config.json'));
    return (
        config.web.build.deployChannels?.[options.channel]?.siteUrl ||
        'https://opendfieldmap.cn'
    );
};

// Resolve build-time references against the same URL layout used by the browser.
// Runtime-computed URLs are covered separately by the shared-resource comparison.
export const verifyReferences = async (dir, info, origin) => {
    const files = await hashFiles(dir);
    const host = new URL(
        `${info.resources.assetsHost.replace(/\/$/, '')}/`,
        origin,
    );
    const assetPath = (url) => {
        if (
            url.origin === host.origin &&
            url.pathname.startsWith(host.pathname)
        )
            return decodeURIComponent(url.pathname.slice(host.pathname.length));
        if (url.origin === new URL(origin).origin)
            return decodeURIComponent(url.pathname.replace(/^\//, ''));
        return null;
    };
    const pending = info.apps.map((name) =>
        path.posix.join(apps[name], 'index.html'),
    );
    const visited = new Set();
    while (pending.length) {
        const file = pending.pop();
        if (visited.has(file) || !/\.(?:html|css|js)$/.test(file)) continue;
        visited.add(file);
        // Point-share documents intentionally use OG media generated outside dist.
        // The app entrypoints and their bundled modules must be self-consistent.
        const source = await fs.readFile(path.join(dir, file), 'utf8');
        const base = file.startsWith('assets/')
            ? new URL(file, host)
            : new URL(file, `${origin}/`);
        const references = [];
        if (file.endsWith('.html')) {
            if (
                !/<script\b[^>]*\bsrc=["'][^"']+\.js(?:\?[^"']*)?["']/i.test(
                    source,
                )
            )
                throw new Error(`Missing app entry module: ${file}`);
            for (const tag of source.matchAll(
                /<(?:script|link|img|source)\b[^>]*>/gi,
            )) {
                if (
                    /^<link/i.test(tag[0]) &&
                    !/\brel=["'](?:stylesheet|modulepreload|preload|icon|apple-touch-icon|manifest)["']/i.test(
                        tag[0],
                    )
                )
                    continue;
                for (const match of tag[0].matchAll(
                    /\b(?:src|href)=["']([^"']+)["']/gi,
                ))
                    references.push(match[1]);
            }
        } else if (file.endsWith('.css')) {
            for (const match of source.matchAll(
                /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"'\s)]*))\s*\)|@import\s*["']([^"']+)/g,
            ))
                references.push(
                    match[1] || match[2] || match[3] || match[4] || '',
                );
        } else {
            for (const match of source.matchAll(
                /["']((?:\.{1,2}\/|\/|assets\/|https?:\/\/)[^\s"'<>]*\.(?:js|css|woff2?|ttf|otf|png|webp|svg|jpe?g|gif|wasm))(?:\?[^"']*)?["']/g,
            )) {
                // import.meta.glob keeps source filenames as object keys; the
                // rewritten URL values, rather than those keys, are requested.
                if (!/^\s*:/.test(source.slice(match.index + match[0].length)))
                    references.push(match[1]);
            }
        }
        for (const reference of references) {
            if (!reference || /^(?:data:|blob:|#)/.test(reference)) continue;
            // Vite's mapDeps paths are relative to the app's HTML, whereas
            // module imports use the importing module as their base.
            const resolved =
                file.endsWith('.js') && reference.startsWith('assets/')
                    ? new URL(
                          reference,
                          file.startsWith('assets/')
                              ? host
                              : new URL(`${file.split('/')[0]}/`, `${origin}/`),
                      )
                    : new URL(reference, base);
            const local = assetPath(resolved);
            if (local !== null && !Object.hasOwn(files, local))
                throw new Error(
                    `Missing referenced asset: ${file} -> ${reference}`,
                );
            if (local !== null) pending.push(local);
        }
    }
    return files;
};

export const verifyLive = async (runner, dir, info, origin) => {
    const checked = new Set();
    for (const name of info.apps) {
        const file = path.posix.join(apps[name], 'index.html');
        const url = new URL(apps[name] ? `/${apps[name]}/` : '/', origin);
        url.searchParams.set('_atlos_release', randomUUID());
        const response = await runner.fetch(url, {
            headers: { 'Cache-Control': 'no-cache' },
            redirect: 'error',
            signal: AbortSignal.timeout(20000),
        });
        const html = Buffer.from(await response.arrayBuffer());
        if (
            !response.ok ||
            !response.headers.get('content-type')?.includes('text/html') ||
            sha256(html) !== (await hashFile(path.join(dir, file)))
        )
            throw new Error(
                `Live entrypoint differs from the release snapshot: ${url.pathname}. Complete a full publish before publishing an app.`,
            );
        for (const tag of html
            .toString()
            .matchAll(/<(?:script|link)\b[^>]*>/gi)) {
            if (
                /^<link/i.test(tag[0]) &&
                !/\brel=["'](?:stylesheet|modulepreload)["']/i.test(tag[0])
            )
                continue;
            const reference = tag[0].match(
                /\b(?:src|href)=["']([^"']+)["']/i,
            )?.[1];
            if (!reference) continue;
            const assetUrl = new URL(reference, url);
            const host = new URL(
                `${info.resources.assetsHost.replace(/\/$/, '')}/`,
                origin,
            );
            let local;
            if (
                assetUrl.origin === host.origin &&
                assetUrl.pathname.startsWith(host.pathname)
            )
                local = decodeURIComponent(
                    assetUrl.pathname.slice(host.pathname.length),
                );
            else if (assetUrl.origin === new URL(origin).origin)
                local = decodeURIComponent(assetUrl.pathname.slice(1));
            else continue;
            if (checked.has(assetUrl.href)) continue;
            checked.add(assetUrl.href);
            const result = await runner.fetch(assetUrl, {
                headers: { 'Cache-Control': 'no-cache' },
                redirect: 'error',
                signal: AbortSignal.timeout(20000),
            });
            const type = result.headers.get('content-type') || '';
            if (
                !result.ok ||
                !(local.endsWith('.css')
                    ? type.includes('text/css')
                    : /javascript|ecmascript/.test(type)) ||
                sha256(Buffer.from(await result.arrayBuffer())) !==
                    (await hashFile(path.join(dir, local)))
            )
                throw new Error(
                    `Live asset is missing or differs from the release snapshot: ${assetUrl.href}`,
                );
        }
    }
};

export const recordApp = async (dir, info, name) => {
    const appDir = path.join(dir, apps[name]);
    await writeJson(path.join(appDir, appReceipt), {
        ...info,
        app: name,
        files: await hashFiles(appDir),
    });
};

export const composeApp = async (runner, options, target, source, state) => {
    if (state?.status !== 'ready')
        throw new Error(
            'No successful full release baseline. Complete a full publish first.',
        );
    const baseline = await snapshotPath(runner, target, options.channel);
    let saved;
    try {
        saved = await json(path.join(baseline, snapshotReceipt));
    } catch {
        throw new Error(
            'Published snapshot is missing on this host. Complete a full publish first.',
        );
    }
    const baselineFiles = await hashFiles(baseline);
    if (saved.id !== state.id || digest(baselineFiles) !== state.digest)
        throw new Error(
            'Published snapshot is stale or modified. Complete a full publish first.',
        );
    const info = await verifyArtifact(baseline, options, target);
    const resources = await resourceConfig(
        runner.root,
        runner.env,
        options,
        target,
    );
    if (JSON.stringify(resources) !== JSON.stringify(info.resources))
        throw new Error(
            'Baseline resource destination changed. Complete a full publish first.',
        );
    const appDir = path.join(source, apps[options.app]);
    const app = await json(path.join(appDir, appReceipt));
    if (
        app.app !== options.app ||
        app.target !== target ||
        app.channel !== options.channel ||
        app.sourceOnly ||
        JSON.stringify(app.resources) !== JSON.stringify(resources) ||
        digest(await hashFiles(appDir)) !== digest(app.files)
    )
        throw new Error(
            'App artifact is modified or has a different target/channel/resource destination. Rebuild the app.',
        );
    // These files are requested dynamically through the shared resource helper;
    // updating them requires a full release so the main site's contract stays intact.
    for (const [local, published] of [
        ['src/assets/images/emoji', 'assets/images/emoji'],
        ['src/assets/images/marker', 'assets/images/marker'],
        ['src/assets/images/item', 'assets/images/item'],
        ['src/assets/images/category', 'assets/images/category'],
        ['public/files/text', 'files/text'],
    ]) {
        const localDir = path.join(runner.root, local);
        if (
            !(await fs.stat(localDir).then(
                () => true,
                () => false,
            ))
        )
            continue;
        for (const [file, hash] of Object.entries(await hashFiles(localDir))) {
            if (baselineFiles[`${published}/${file}`] !== hash)
                throw new Error(
                    `Shared resource changed: ${published}/${file}. Complete a full publish first.`,
                );
        }
    }
    const shardDir = path.join(appDir, 'assets/fonts/shards');
    if (await fs.access(shardDir).then(() => true, () => false)) {
        for (const [file, hash] of Object.entries(await hashFiles(shardDir)))
            if (baselineFiles[`assets/fonts/shards/${file}`] !== hash)
                throw new Error(`Shared font changed: ${file}. Complete a full publish first.`);
    }
    const origin = await siteUrl(runner, options, target);
    await verifyLive(runner, baseline, info, origin);
    const work = path.join(
        runner.root,
        'dist',
        'releases',
        `${target}-${options.channel}-${randomUUID()}`,
    );
    await fs.cp(baseline, work, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
    });
    await fs.rm(path.join(work, snapshotReceipt));
    const destination = path.join(work, apps[options.app]);
    // Keep old hashed chunks so already-open app sessions can finish loading them.
    // Reject collisions instead of changing bytes underneath an immutable URL.
    const previousAssets = await hashFiles(path.join(destination, 'assets'));
    const nextAssets = await hashFiles(path.join(appDir, 'assets'));
    for (const [file, hash] of Object.entries(nextAssets))
        if (previousAssets[file] && previousAssets[file] !== hash)
            throw new Error(`Immutable app asset collision: ${file}`);
    await fs.cp(appDir, destination, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
    });
    await fs.rm(path.join(destination, appReceipt), { force: true });
    const versions =
        info.appVersions ||
        Object.fromEntries(
            info.apps.map((name) => [
                name,
                {
                    source: info.source,
                    sourceDirty: info.sourceDirty,
                    builtAt: info.builtAt,
                },
            ]),
        );
    versions[options.app] = {
        source: app.source,
        sourceDirty: app.sourceDirty,
        builtAt: app.builtAt,
    };
    await writeJson(path.join(work, receipt), {
        ...info,
        appVersions: versions,
    });
    await verifyArtifact(work, options, target);
    await verifyReferences(work, info, origin);
    return work;
};

export const saveSnapshot = async (runner, options, target, dir, id, files) => {
    const destination = await snapshotPath(runner, target, options.channel);
    const temporary = `${destination}-${id}`;
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(dir, temporary, {
        recursive: true,
        mode: constants.COPYFILE_FICLONE,
    });
    if (digest(await hashFiles(temporary)) !== digest(files))
        throw new Error(
            'Release artifact changed while saving its snapshot. Complete a full publish again.',
        );
    await writeJson(path.join(temporary, snapshotReceipt), { id });
    if (
        await fs.stat(destination).then(
            () => true,
            () => false,
        )
    )
        await fs.access(path.join(destination, snapshotReceipt));
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(temporary, destination);
    return { status: 'ready', id, digest: digest(files) };
};
