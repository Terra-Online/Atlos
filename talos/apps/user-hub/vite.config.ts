import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const target = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
const envDir = resolve(import.meta.dirname, '../..');
const mainFontLoader = resolve(envDir, 'src/locale/fontLoader.ts');
const fontAssets = resolve(import.meta.dirname, 'src/locale/fontAssets.ts');

const fontAssetsPlugin = (): import('vite').Plugin => ({
    name: 'user-hub-font-assets',
    enforce: 'pre',
    resolveId(source, importer) {
        if (source !== './fontAssets' || !importer) return null;
        const normalizedImporter = importer.replace(/\\/g, '/').split('?')[0];
        return normalizedImporter === mainFontLoader.replace(/\\/g, '/')
            ? fontAssets
            : null;
    },
});
const htmlMetadata =
    target === 'oss'
        ? {
              lang: 'zh-CN',
              title: '用户中心｜终末地地图集',
              description:
                  '终末地地图集用户中心，管理个人资料、提交内容与绑定账户。',
          }
        : {
              lang: 'en',
              title: 'User Center - Open Endfield Map',
              description:
                  'Manage your profile, contributions and linked accounts on Open Endfield Map.',
          };

const htmlMetadataPlugin = (): import('vite').Plugin => ({
    name: 'user-hub-html-metadata',
    transformIndexHtml: {
        order: 'pre',
        handler(html) {
            return html
                .replace('%HUB_HTML_LANG%', htmlMetadata.lang)
                .replace('%HUB_PAGE_TITLE%', htmlMetadata.title)
                .replace('%HUB_PAGE_DESCRIPTION%', htmlMetadata.description);
        },
    },
});

export default defineConfig(({ command }) => {
    return {
        base: '/me/',
        envDir,
        plugins: [
            htmlMetadataPlugin(),
            fontAssetsPlugin(),
            react(),
            svgr(),
            ...(command === 'serve'
                ? [
                      viteStaticCopy({
                          targets: [
                              {
                                  src: resolve(
                                      envDir,
                                      'src/assets/images/emoji',
                                  ),
                                  dest: 'assets/images',
                              },
                          ],
                      }),
                  ]
                : []),
        ],
        resolve: {
            alias: [
                {
                    find: '@hub',
                    replacement: resolve(import.meta.dirname, 'src'),
                },
                {
                    find: '@main',
                    replacement: resolve(import.meta.dirname, '../../src'),
                },
                {
                    find: '@',
                    replacement: resolve(import.meta.dirname, '../../src'),
                },
            ],
        },
        define: {
            // Development serves shared emoji beneath this application's Vite base.
            // Production uses the main site's existing /assets/images/emoji files.
            ...(command === 'serve'
                ? { __ASSETS_HOST: JSON.stringify('/me') }
                : {}),
            ...(command === 'build'
                ? {
                      'import.meta.env.VITE_AUTH_BASE': JSON.stringify(
                          process.env.VITE_AUTH_BASE ||
                              (target === 'oss'
                                  ? 'https://api.opendfieldmap.cn'
                                  : 'https://api.opendfieldmap.org'),
                      ),
                  }
                : {}),
        },
        server: {
            port: Number(process.env.USER_HUB_DEV_PORT || 5175),
            strictPort: true,
            fs: { allow: [resolve(import.meta.dirname, '../..')] },
        },
        build: {
            outDir: resolve(import.meta.dirname, `../../dist/${target}/me`),
            emptyOutDir: true,
            assetsDir: 'assets',
            rollupOptions: {
                output: {
                    entryFileNames: 'assets/user-hub-[hash].js',
                    chunkFileNames: 'assets/user-hub-[name]-[hash].js',
                    assetFileNames(assetInfo) {
                        const sourceNames = [
                            ...(assetInfo.originalFileNames || []),
                            ...(assetInfo.names || []),
                            assetInfo.name,
                        ]
                            .filter(Boolean)
                            .map((value) => String(value).replace(/\\/g, '/'));
                        const fontSource = sourceNames.find(
                            (value) =>
                                /\.(?:woff2?|otf|ttf)$/i.test(value) &&
                                value.includes('/assets/fonts/'),
                        );
                        const family = fontSource?.match(
                            /\/assets\/fonts\/([^/]+)\//,
                        )?.[1];
                        return family
                            ? `assets/fonts/${family}/[name]-[hash][extname]`
                            : 'assets/user-hub-[name]-[hash][extname]';
                    },
                },
            },
        },
    };
});
