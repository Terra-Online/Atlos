import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { getDeployChannel, joinCdnPath } from '../release-channel.js';
import { resourceConfig } from '../release-artifact.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const shardPath = 'assets/fonts/shards/v1';
export const fontVariables = {
    'UD_ShinGo Bold': 'b',
    'UD_ShinGo DemiBold': 'db',
    'UD_ShinGo Medium': 'm',
    'UD_ShinGo Regular': 'r',
    HMSans: 'h',
};

// Preserve each declaration's existing family order, including Latin faces.
// Rewriting only font-family avoids changing @font-face definitions or strings.
export const regionFontStyles = () => ({
    postcssPlugin: 'atlos-region-fonts',
    Declaration(declaration) {
        if (
            declaration.prop !== 'font-family' ||
            declaration.parent.type === 'atrule'
        )
            return;
        declaration.value = declaration.value.replace(
            /(['"])(UD_ShinGo (?:Bold|DemiBold|Medium|Regular)|HMSans)\1|\bHMSans\b(?![\w-])/g,
            (_match, _quote, family) => {
                const face = fontVariables[family || 'HMSans'];
                return `var(--font-${face}, "Atlos-pending-${face}")`;
            },
        );
    },
});

export const readFonts = async (project = root) => {
    const directory = path.join(project, '.cache/font-shards/v1');
    const index = JSON.parse(
        await fs
            .readFile(path.join(directory, 'index.json'), 'utf8')
            .catch(() => {
                throw new Error(
                    'Font shards are missing. Run pnpm data fonts (requires fonts_original).',
                );
            }),
    );
    const files = new Set();
    const manifests = {};
    for (const region of ['CN', 'HK', 'JP']) {
        const name = index[region];
        if (!name || path.basename(name) !== name)
            throw new Error(`Missing or invalid ${region} font manifest.`);
        const bytes = await fs.readFile(path.join(directory, name));
        if (
            !name.endsWith(
                `-${createHash('sha256').update(bytes).digest('hex').slice(0, 20)}.json`,
            )
        )
            throw new Error(`Modified font manifest: ${name}`);
        const manifest = JSON.parse(bytes);
        if (manifest.region !== region || manifest.version !== 'v1')
            throw new Error(`Invalid font manifest: ${name}`);
        const expected =
            region === 'JP'
                ? ['b', 'db', 'm', 'r']
                : ['b', 'db', 'm', 'r', 'h'];
        if (
            manifest.packing?.target !== 1024 ||
            expected.some((face) => !manifest.faces[face]?.base)
        )
            throw new Error(`Incomplete frozen font manifest: ${name}`);
        files.add(name);
        for (const parts of Object.values(manifest.faces))
            for (const part of Object.values(parts)) {
                if (path.basename(part.file) !== part.file)
                    throw new Error('Invalid font shard path.');
                files.add(part.file);
            }
        manifests[region] = manifest;
    }
    return { directory, index, files, manifests };
};
export const checkFonts = async (project = root) => {
    const fonts = await readFonts(project);
    const files = [...fonts.files];
    for (let index = 0; index < files.length; index += 64) {
        await Promise.all(
            files.slice(index, index + 64).map(async (file) => {
                const data = await fs.readFile(
                    path.join(fonts.directory, file),
                );
                const hash = createHash('sha256')
                    .update(data)
                    .digest('hex')
                    .slice(0, 20);
                if (!file.includes(`-${hash}.`))
                    throw new Error(
                        `Modified immutable font resource: ${file}`,
                    );
            }),
        );
    }
    return fonts;
};

export const fontShardsPlugin = () => {
    let fonts;
    let base;
    return {
        name: 'atlos-font-shards',
        async config(config, env) {
            const sourceOnly = process.env.ATLOS_SOURCE_ONLY === '1';
            if (!sourceOnly) fonts = await checkFonts();
            base =
                env.command === 'serve'
                    ? ''
                    : (
                          await resourceConfig(
                              root,
                              process.env,
                              { channel: getDeployChannel() },
                              process.env.BUILD_TARGET === 'r2' ? 'org' : 'cn',
                          )
                      ).assetsHost;
            const manifests = Object.fromEntries(
                Object.entries(fonts?.index || {}).map(([region, name]) => [
                    region,
                    joinCdnPath(base, `${shardPath}/${name}`),
                ]),
            );
            const existing = config.css?.postcss;
            if (typeof existing === 'string')
                throw new Error(
                    'Font regions require inline PostCSS configuration.',
                );
            return {
                define: { __FONT_SHARD_MANIFESTS__: JSON.stringify(manifests) },
                css: { postcss: { plugins: [regionFontStyles()] } },
            };
        },
        configureServer(server) {
            server.middlewares.use(async (request, response, next) => {
                const pathname = new URL(request.url || '/', 'http://localhost')
                    .pathname;
                const marker = `/${shardPath}/`;
                const index = pathname.indexOf(marker);
                if (index < 0 || !fonts) return next();
                const file = pathname.slice(index + marker.length);
                if (!fonts.files.has(file)) {
                    response.statusCode = 404;
                    response.end();
                    return;
                }
                try {
                    response.setHeader(
                        'Content-Type',
                        file.endsWith('.json')
                            ? 'application/json'
                            : 'font/woff2',
                    );
                    response.setHeader(
                        'Cache-Control',
                        'public,max-age=31536000,immutable',
                    );
                    response.end(
                        await fs.readFile(path.join(fonts.directory, file)),
                    );
                } catch (error) {
                    next(error);
                }
            });
        },
        async generateBundle() {
            if (!fonts) return;
            for (const file of fonts.files)
                this.emitFile({
                    type: 'asset',
                    fileName: `${shardPath}/${file}`,
                    source: await fs.readFile(path.join(fonts.directory, file)),
                });
        },
    };
};
