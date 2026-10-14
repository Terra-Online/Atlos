import fs from 'node:fs/promises';
import path from 'node:path';
import { joinCdnPath, resolveDeployPrefix } from './release-channel.js';

export const targets = { cn: 'oss', org: 'r2' };
export const apps = { main: '', intel: 'intel', 'user-hub': 'me' };
export const receipt = '.atlos-build.json';

const isWithin = (parent, child) => {
    const relative = path.relative(parent, child);
    return (
        relative === '' ||
        (relative !== '..' &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
    );
};
const realPath = async (file) => {
    try {
        return await fs.realpath(file);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return path.join(
            await realPath(path.dirname(file)),
            path.basename(file),
        );
    }
};

// Vite and Pages empty their destination. Inside the checkout, only dedicated
// output trees may be emptied; external paths must be empty or an existing artifact.
export const verifyOutput = async (root, directory, kind = 'build') => {
    const project = await realPath(root);
    const output = await realPath(directory);
    const allowed = path.join(
        project,
        kind === 'pages' ? '.pages-dist' : 'dist',
    );
    if (
        isWithin(output, project) ||
        (isWithin(project, output) &&
            (!isWithin(allowed, output) || output === allowed))
    ) {
        throw new Error(
            `Unsafe ${kind} output: ${directory}. Use a dedicated directory under ${allowed}.`,
        );
    }
    if (!isWithin(project, output)) {
        let entries;
        try {
            entries = await fs.readdir(output);
        } catch (error) {
            if (error.code === 'ENOENT') return;
            throw error;
        }
        const marker = kind === 'pages' ? '.atlos-pages.json' : receipt;
        if (entries.length && !entries.includes(marker))
            throw new Error(
                `Refusing to empty an unrelated directory: ${directory}`,
            );
    }
};

export const resourceConfig = async (root, env, options, target) => {
    const storage = targets[target];
    const config = JSON.parse(
        await fs.readFile(
            path.join(
                root,
                'config',
                storage === 'r2' ? 'config.r2.json' : 'config.json',
            ),
            'utf8',
        ),
    );
    const build = config.web.build;
    const settings = {
        basePrefix: build[storage]?.prefix,
        target: storage,
        deployChannels: build.deployChannels,
    };
    const { prefix } = resolveDeployPrefix({
        ...settings,
        channel: options.channel,
        env,
    });
    if (options.channel === 'beta') {
        const production = resolveDeployPrefix({
            ...settings,
            channel: 'prod',
            env: {},
        }).prefix;
        const overriddenProduction = resolveDeployPrefix({
            ...settings,
            channel: 'prod',
            env: { ...env, DEPLOY_PREFIX: '' },
        }).prefix;
        if (prefix === production || prefix === overriddenProduction)
            throw new Error(
                'Beta resources resolve to the production prefix. Check channel configuration and DEPLOY_* overrides.',
            );
    }
    return {
        prefix,
        assetsHost: joinCdnPath(build.cdn, prefix),
        bucket: build[storage]?.bucket || '',
        endpoint: build[storage]?.endpoint || build[storage]?.region || '',
    };
};

export const verifyArtifact = async (dir, options, target) => {
    const info = JSON.parse(await fs.readFile(path.join(dir, receipt), 'utf8'));
    if (info.sourceOnly && !options.sourceOnly)
        throw new Error(
            'Source-only CI artifacts cannot be published. Rebuild with local assets.',
        );
    if (info.target !== target || info.channel !== options.channel)
        throw new Error(
            `Artifact target/channel mismatch in ${dir}. Rebuild for ${target}/${options.channel}.`,
        );
    const requiredApps = Object.keys(apps).filter(
        (name) => !options.skipIntel || name !== 'intel',
    );
    for (const name of requiredApps) {
        if (!info.apps?.includes(name))
            throw new Error(
                `Artifact is missing ${name}. Build the full site first.`,
            );
        await fs.access(path.join(dir, apps[name], 'index.html'));
        const assets = await fs.readdir(path.join(dir, apps[name], 'assets'));
        if (!assets.length) throw new Error(`Empty ${name} assets in ${dir}`);
    }
    await fs.access(path.join(dir, 'sitemap.xml'));
    await fs.access(path.join(dir, 'robots.txt'));
    const points = await fs.readdir(
        path.join(dir, 'seo/points', targets[target]),
    );
    if (!points.some((file) => /^[0-9A-Za-z]{7}\.html$/.test(file)))
        throw new Error(`No SEO point pages in ${dir}`);
    return info;
};
