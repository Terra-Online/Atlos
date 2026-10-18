import fs from 'node:fs/promises';
import { requirements } from './requirements.mjs';
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
        const original = declaration.value;
        declaration.value = declaration.value.replace(
            /(['"])(UD_ShinGo (?:Bold|DemiBold|Medium|Regular)|HMSans)\1|\bHMSans\b(?![\w-])/g,
            (_match, _quote, family) => {
                const face = fontVariables[family || 'HMSans'];
                return `var(--font-${face}, "Atlos-pending-${face}")`;
            },
        );
        // Inherited font-family is already resolved. Rebind the app's body
        // stack at explicit boundaries so local aliases isolate inherited text.
        if (
            declaration.parent.selector === 'body' &&
            original !== declaration.value
        ) {
            declaration.parent.after(
                declaration.parent.clone({
                    selector: ':where([data-font-owner])',
                    nodes: [declaration.clone()],
                }),
            );
        }
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

const initialFontPreloadTags = (fonts, metadata) => {
    if (!fonts || !Object.keys(metadata.requirements).length) return [];
    const preloadByRegion = Object.fromEntries(
        Object.entries(metadata.requirements).map(([region, data]) => {
            const manifest = fonts.manifests[region];
            const manifestUrl = metadata.manifests[region];
            const urls = new Set();
            for (const [face, keys] of Object.entries(data.shell || {}))
                for (const key of keys || []) {
                    const part = manifest?.faces?.[face]?.[key];
                    if (part && manifestUrl)
                        urls.add(new URL(part.file, manifestUrl).href);
                }
            return [region, [...urls]];
        }),
    );
    const payload = JSON.stringify(preloadByRegion);
    return [
        {
            tag: 'script',
            attrs: { type: 'text/javascript' },
            children: `(()=>{const p=${payload};let l='';try{l=localStorage.getItem('talos:locale')||navigator.language||''}catch{};const v=String(l).toLowerCase().replace('_','-');const r=v.includes('ja')||v.includes('jp')?'JP':v.includes('zh-tw')||v.includes('zh-hk')||v.includes('zh-hant')?'HK':v.includes('zh-cn')||v.includes('zh-hans')?'CN':null;for(const h of p[r]||[]){const n=document.createElement('link');n.rel='preload';n.as='font';n.type='font/woff2';n.crossOrigin='anonymous';n.href=h;document.head.appendChild(n)}})()`,
            injectTo: 'head-prepend',
        },
    ];
};

/** @returns {import('vite').Plugin} */
export const fontShardsPlugin = (app = 'main') => {
    let fonts;
    let base;
    let building;
    let scriptBase;
    let metadata = { manifests: {}, requirements: {} };
    const preloadEntry = '/@atlos-font-preload';
    const preloadFile = path.join(root, 'src/locale/fontPreload.ts');
    return {
        name: 'atlos-font-shards',
        configResolved(config) {
            building = config.command === 'build';
            scriptBase = config.base;
        },
        buildStart() {
            if (fonts && building)
                this.emitFile({
                    type: 'chunk',
                    id: preloadFile,
                    name: 'font-preload',
                    preserveSignature: 'strict',
                });
        },
        resolveId(id) {
            if (id === preloadEntry) return '\0atlos-font-preload';
        },
        load(id) {
            if (id === '\0atlos-font-preload')
                return `import ${JSON.stringify(preloadFile)};`;
        },
        transform(_code, id) {
            if (
                id.split('?')[0] === path.join(root, 'src/locale/fontConfig.ts')
            ) {
                // Unlike dev `define` globals, module dependencies are ready
                // before the early entry executes, even before @vite/client.
                return {
                    code: `export const manifests = ${JSON.stringify(metadata.manifests)};\nexport const requirements = ${JSON.stringify(metadata.requirements)};`,
                    map: null,
                };
            }
        },
        transformIndexHtml: {
            // A separate Rollup entry avoids Vite merging this into the much
            // larger application entry when processing HTML module scripts.
            order: 'post',
            handler(_html, context) {
                if (!fonts) return;
                const chunk = Object.values(context.bundle || {}).find(
                    (entry) =>
                        entry.type === 'chunk' &&
                        entry.facadeModuleId === preloadFile,
                );
                if (building && !chunk)
                    throw new Error('Missing font preload entry.');
                return [
                    ...initialFontPreloadTags(fonts, metadata),
                    {
                        tag: 'script',
                        attrs: {
                            type: 'module',
                            crossorigin: '',
                            src: chunk
                                ? joinCdnPath(scriptBase, chunk.fileName)
                                : preloadEntry,
                        },
                        injectTo: 'head-prepend',
                    },
                ];
            },
        },
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
            metadata = {
                manifests,
                requirements: fonts
                    ? await requirements(fonts.manifests, app)
                    : {},
            };
            const existing = config.css?.postcss;
            if (typeof existing === 'string')
                throw new Error(
                    'Font regions require inline PostCSS configuration.',
                );
            return {
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
