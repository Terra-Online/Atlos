import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import eslint from 'vite-plugin-eslint';
import fs, { existsSync } from 'fs';
import Inspect from 'vite-plugin-inspect';
import autoprefixer from 'autoprefixer';
import { createHtmlPlugin } from 'vite-plugin-html';

// 通过 BUILD_TARGET 选择使用的配置：
// - 默认 / 未设置：使用 config/config.json（阿里云 OSS / .cn）
// - BUILD_TARGET=r2：使用 config/config.r2.json（Cloudflare R2 / .org）
const buildTarget = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
const configPath =
    buildTarget === 'r2' ? './config/config.r2.json' : './config/config.json';
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Define meta info based on build target
const metaInfo = buildTarget === 'r2' 
    ? {
        title: "Open Endfield Map",
        description: "Open Endfield Map is an open-source online map for Arknights: Endfield.",
        ogUrl: "https://opendfieldmap.org", // Example URL for R2/Global
        keywords: "Endfield Map, Arknights: Endfield, Endfield, endfield, Arknights, Atlos, online map"
      }
    : {
        title: "终末地地图集",
        description: "终末地地图集 (Open Endfield Map) 是明日方舟：终末地的开源在线地图，提供交互式地图、物品收集和战略规划工具。",
        ogUrl: "https://opendfieldmap.cn",
        keywords: "终末地地图, 明日方舟：终末地, 终末地, 终末地WIKI, Arknights Endfield, Atlos, 在线地图"
      };

const isProd = process.env.NODE_ENV === 'production';
const assetsHost = isProd
    ? `${config.web.build.cdn}${
          buildTarget === 'r2'
              ? config.web.build.r2.prefix
              : config.web.build.oss.prefix
      }`
    : '';

const getMapClipTargets = () => {
    const clipsDir = resolve(__dirname, 'public/clips');
    if (!existsSync(clipsDir)) return [];

    const targets = [];
    const mapDirs = fs.readdirSync(clipsDir);

    for (const mapName of mapDirs) {
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

// https://vite.dev/config/
export default defineConfig({
    publicDir: false,
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
    },
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src'),
            '@/components': resolve(__dirname, 'src/component'),
            '@/utils': resolve(__dirname, 'src/utils'),
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
});
