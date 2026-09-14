import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import eslint from 'vite-plugin-eslint';
import fs, { existsSync } from 'fs';
import Inspect from 'vite-plugin-inspect';
import autoprefixer from 'autoprefixer';
import { createHtmlPlugin } from 'vite-plugin-html';
import {
    getDeployChannel,
    joinCdnPath,
    resolveDeployPrefix,
} from './scripts/release-channel.js';

// 通过 BUILD_TARGET 选择使用的配置：
// - 默认 / 未设置：使用 config/config.json（阿里云 OSS / .cn）
// - BUILD_TARGET=r2：使用 config/config.r2.json（Cloudflare R2 / .org）
const buildTarget = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
const buildOutDir = process.env.BUILD_OUT_DIR || `dist/${buildTarget}`;
const configPath =
    buildTarget === 'r2' ? './config/config.r2.json' : './config/config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const deployChannel = getDeployChannel();

const basePrefix =
    buildTarget === 'r2'
        ? config?.web?.build?.r2?.prefix
        : config?.web?.build?.oss?.prefix;
const { prefix: resolvedPrefix, source: prefixSource } = resolveDeployPrefix({
    basePrefix,
    channel: deployChannel,
    target: buildTarget,
    deployChannels: config?.web?.build?.deployChannels,
});

const channelSiteUrl =
    config?.web?.build?.deployChannels?.[deployChannel]?.siteUrl;
const defaultSiteUrl =
    buildTarget === 'r2'
        ? deployChannel === 'beta'
            ? 'https://beta.opendfieldmap.org'
            : 'https://opendfieldmap.org'
        : deployChannel === 'beta'
          ? 'https://beta.opendfieldmap.cn'
          : 'https://opendfieldmap.cn';
const siteUrl = channelSiteUrl || defaultSiteUrl;

// Define meta info based on build target
const metaInfo = buildTarget === 'r2' 
    ? {
        title: "Open Endfield Map - Arknights: Endfield Interactive Map",
        description: "Open Endfield Map is an open-source online map for Arknights: Endfield.",
                ogUrl: siteUrl,
        keywords: "Endfield Map, Arknights: Endfield, Endfield, endfield, Arknights, Atlos, online map, interactive map, full-collection"
      }
    : {
        title: "终末地地图集 - 明日方舟：终末地交互式资源点位地图全集",
        description: "终末地地图集 (Open Endfield Map) 是明日方舟：终末地的开源在线地图，提供交互式地图、物品收集和战略规划工具。",
                ogUrl: siteUrl,
        keywords: "终末地地图, 明日方舟：终末地, 终末地, 全收集, 终末地WIKI, Arknights Endfield, Atlos, 在线地图, 交互式地图"
      };

const isProd = process.env.NODE_ENV === 'production';
const getGitAssetVersion = () => {
    try {
        return execSync('git rev-parse --short=12 HEAD', {
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
    } catch {
        return '';
    }
};
const buildAssetVersion = process.env.BUILD_ASSET_VERSION || getGitAssetVersion() || Date.now().toString(36);
const assetsHost = isProd
    ? joinCdnPath(config?.web?.build?.cdn, resolvedPrefix)
    : '';

const getSearchDocVersions = () => {
    const docsDir = resolve(__dirname, 'public/search/docs');
    const manifestPath = resolve(docsDir, 'index.json');
    let manifest = {};

    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
        // Fall back to hashing locale files directly below.
    }

    const versions = {};
    const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
    for (const entry of locales) {
        if (!entry || typeof entry.locale !== 'string' || typeof entry.file !== 'string') continue;
        try {
            const content = fs.readFileSync(resolve(docsDir, entry.file));
            versions[entry.locale] = createHash('sha256').update(content).digest('hex').slice(0, 16);
        } catch {
            if (typeof entry.revision === 'string' && entry.revision) {
                versions[entry.locale] = entry.revision;
            }
        }
    }
    return versions;
};

const searchDocVersions = getSearchDocVersions();
const excludedClipDirNames = new Set(['jinlong']);
const scriptExts = new Set(['.py', '.sh', '.js', '.mjs', '.ts', '.bash', '.zsh']);
const historicalMarkerDataPattern = /src\/data\/marker\/data\/\d{8}\//;

const isExcludedClipDir = (name) => excludedClipDirNames.has(name.toLowerCase());

const stableFontAssetFamilies = new Set(['Fedra', 'Novecento', 'UD_ShinGo', 'Harmony']);
const fontAssetExtPattern = /\.(?:woff2?|otf|ttf)$/i;

const getStableFontAssetFamily = (assetInfo) => {
    const sources = [
        ...(assetInfo.originalFileNames || []),
        ...(assetInfo.names || []),
        assetInfo.name,
    ].filter(Boolean);

    for (const source of sources) {
        const normalized = String(source).replace(/\\/g, '/');
        if (!fontAssetExtPattern.test(normalized)) continue;

        const fontPathMatch = normalized.match(/(?:^|\/)(?:src\/)?assets\/fonts\/([^/]+)\//);
        if (fontPathMatch && stableFontAssetFamilies.has(fontPathMatch[1])) {
            return fontPathMatch[1];
        }

        const filename = normalized.split('/').pop() || '';
        if (filename.startsWith('FedraSansPro-')) return 'Fedra';
        if (
            filename.startsWith('Novecento-') ||
            filename.startsWith('NWBold+') ||
            filename.startsWith('NWDemiBold+') ||
            filename.startsWith('NWMed+')
        ) {
            return 'Novecento';
        }
    }

    return undefined;
};

if (isProd) {
    console.log(
        `[vite] target=${buildTarget} channel=${deployChannel} prefix=${resolvedPrefix || '/'} source=${prefixSource} siteUrl=${siteUrl}`,
    );
}

const getMapClipTargets = () => {
    const clipsDir = resolve(__dirname, 'public/clips');
    if (!existsSync(clipsDir)) return [];

    const targets = [];
    const mapDirs = fs.readdirSync(clipsDir);

    for (const mapName of mapDirs) {
        if (isExcludedClipDir(mapName)) continue;

        const mapPath = resolve(clipsDir, mapName);
        if (!fs.statSync(mapPath).isDirectory()) continue;

        const items = fs.readdirSync(mapPath);
        for (const item of items) {
            const itemPath = resolve(mapPath, item);
            // Only copy directories (e.g. 0, 1, 2, 3)
            if (fs.statSync(itemPath).isDirectory()) {
                targets.push({
                    src: `public/clips/${mapName}/${item}`,
                    dest: `clips/${mapName}`,
                });
            }
        }
    }
    return targets;
};

const cleanDistClipsPlugin = () => {
    let distDir = resolve(__dirname, 'dist');

    const removeScriptFiles = (dir) => {
        if (!existsSync(dir)) return;

        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = resolve(dir, entry.name);
            if (entry.isDirectory()) {
                removeScriptFiles(fullPath);
                continue;
            }

            if (scriptExts.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase())) {
                fs.rmSync(fullPath, { force: true });
            }
        }
    };

    return {
        name: 'clean-dist-clips',
        configResolved(resolvedConfig) {
            distDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);
        },
        closeBundle() {
            const clipsDir = resolve(distDir, 'clips');
            if (!existsSync(clipsDir)) return;

            const entries = fs.readdirSync(clipsDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = resolve(clipsDir, entry.name);
                if (entry.isDirectory()) {
                    if (isExcludedClipDir(entry.name)) {
                        fs.rmSync(fullPath, { recursive: true, force: true });
                    }
                    continue;
                }

                fs.rmSync(fullPath, { force: true });
            }

            removeScriptFiles(clipsDir);
        },
    };
};

const cleanDistSeoPointsPlugin = () => {
    let distDir = resolve(__dirname, 'dist');

    return {
        name: 'clean-dist-seo-points',
        enforce: 'post',
        configResolved(resolvedConfig) {
            distDir = resolve(resolvedConfig.root, resolvedConfig.build.outDir);
        },
        writeBundle() {
            const pointsDir = resolve(distDir, 'seo/points');
            if (!existsSync(pointsDir)) return;

            const entries = fs.readdirSync(pointsDir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = resolve(pointsDir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name !== buildTarget) {
                        fs.rmSync(fullPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
                    }
                    continue;
                }

                if (/^[0-9a-zA-Z]{7}\.html$/.test(entry.name)) {
                    fs.rmSync(fullPath, { force: true });
                }
            }
        },
    };
};

// https://vite.dev/config/
export default defineConfig({
    // publicDir: false, // Disabled to allow standard Vite public directory behavior
    plugins: [
        react(),
        svgr(),
        createHtmlPlugin({
            minify: true,
            inject: {
                data: {
                    title: metaInfo.title,
                    description: metaInfo.description,
                    ogUrl: metaInfo.ogUrl,
                    keywords: metaInfo.keywords,
                    cdnHost: config.web.build.cdn || '',
                },
            },
        }),
        // 只复制存在的目录，避免构建失败
        viteStaticCopy({
            targets: [
                {
                    src: 'src/assets/images/marker',
                    dest: 'assets/images',
                },
                {
                    src: 'src/assets/images/item',
                    dest: 'assets/images',
                },
                {
                    src: 'src/assets/images/category',
                    dest: 'assets/images',
                },
            ]
                .filter((target) => existsSync(target.src))
                .concat(getMapClipTargets()), // 只包含存在的源路径
        }),
        cleanDistClipsPlugin(),
        cleanDistSeoPointsPlugin(),
        eslint({
            failOnWarning: false,
            failOnError: true,
            emitWarning: true,
            emitError: true,
        }),
        Inspect(),
    ],
    base: assetsHost,
    define: {
        __ASSETS_HOST: JSON.stringify(assetsHost),
        __APP_VERSION__: JSON.stringify(buildAssetVersion),
        __SEARCH_DOC_VERSIONS__: JSON.stringify(searchDocVersions),
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@/components': resolve(__dirname, 'src/component'),
            '@/data': resolve(__dirname, 'src/data'),
            '@/assets': resolve(__dirname, 'src/assets'),
            '@/styles': resolve(__dirname, 'src/styles'),
        },
        extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json'],
    },
    esbuild: {
        loader: 'tsx',
        include: /src\/.*\.(jsx?|tsx?)$/,
        exclude: [],
    },
    optimizeDeps: {
        esbuildOptions: {
            loader: {
                '.js': 'jsx',
                '.ts': 'tsx',
                '.tsx': 'tsx',
            },
        },
    },
    css: {
        postcss: {
            plugins: [autoprefixer()],
        },
    },
    server: {
        proxy: {
            '/intel': {
                target: 'http://127.0.0.1:5174',
                changeOrigin: true,
                ws: true,
                rewrite: (requestPath) => requestPath.replace(/^\/intel(?=[?#]|$)/, '/intel/'),
            },
            '/proxy/skport-auth': {
                target: 'https://as.gryphline.com',
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/proxy\/skport-auth/, ''),
            },
            '/proxy/skport-api': {
                target: 'https://zonai.skport.com',
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/proxy\/skport-api/, ''),
            },
            '/proxy/skland-auth': {
                target: 'https://as.hypergryph.com',
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/proxy\/skland-auth/, ''),
            },
            '/proxy/skland-api': {
                target: 'https://zonai.skland.com',
                changeOrigin: true,
                secure: true,
                rewrite: (path) => path.replace(/^\/proxy\/skland-api/, ''),
            },
        },
    },
    build: {
        outDir: buildOutDir,
        emptyOutDir: true,
        rollupOptions: {
            external: [
                // Exclude dated legacy marker snapshots from accidental glob/import expansion.
                historicalMarkerDataPattern,
            ],
            output: {
                entryFileNames: `assets/[name]-[hash]-${buildAssetVersion}.js`,
                chunkFileNames: `assets/[name]-[hash]-${buildAssetVersion}.js`,
                assetFileNames(assetInfo) {
                    const stableFontFamily = getStableFontAssetFamily(assetInfo);
                    if (stableFontFamily) {
                        return `assets/fonts/${stableFontFamily}/[name]-[hash][extname]`;
                    }

                    return `assets/[name]-[hash]-${buildAssetVersion}[extname]`;
                },
                manualChunks(id) {
                    if (!id.includes('/node_modules/')) return undefined;

                    // 手动归并 React 核心运行时，确保它们在同一个 chunk
                    if (
                        id.includes('/react/') ||
                        id.includes('/react-dom/') ||
                        id.includes('/scheduler/') ||
                        id.includes('/react-is/')
                    ) {
                        return 'vendor-react';
                    }

                    return undefined;
                },
            },
        },
    },
});
