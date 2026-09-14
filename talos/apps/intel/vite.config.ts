import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

const target = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
const channel = process.env.DEPLOY_CHANNEL === 'beta' ? 'beta' : 'prod';
const fontAssetPattern = /\.(?:woff2?|otf|ttf)$/i;
const mainFontLoader = resolve(import.meta.dirname, '../../src/locale/fontLoader.ts');
const intelFontAssets = resolve(import.meta.dirname, 'src/locale/fontAssets.ts');
const htmlMetadata = target === 'oss'
  ? {
      lang: 'zh-CN',
      title: '档案收集专题｜终末地地图集',
      description: '终末地地图集档案收集专题，提供《明日方舟：终末地》档案获取方式、收集进度与地图点位查询。',
    }
  : {
      lang: 'en',
      title: 'Intel Archive - Open Endfieldmap',
      description: 'Track Intel Archive collection progress, acquisition methods, and map locations in Arknights: Endfield.',
    };

const intelHtmlMetadataPlugin = (): import('vite').Plugin => ({
  name: 'intel-html-metadata',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html
        .replace('%INTEL_HTML_LANG%', htmlMetadata.lang)
        .replace('%INTEL_PAGE_TITLE%', htmlMetadata.title)
        .replace('%INTEL_PAGE_DESCRIPTION%', htmlMetadata.description);
    },
  },
});

const intelFontAssetsPlugin = (): import('vite').Plugin => ({
  name: 'intel-font-assets',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source !== './fontAssets' || !importer) return null;
    const normalizedImporter = importer.replace(/\\/g, '/').split('?')[0];
    return normalizedImporter === mainFontLoader.replace(/\\/g, '/') ? intelFontAssets : null;
  },
});

const INTEL_IMPORT_PREFIXES = ['OEA-0-', 'MAE-0-'] as const;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const INTEL_IMPORT_DEBUG_PATH_PATTERN = new RegExp(
  `^\\/(?:intel\\/)?i\\/((?:${INTEL_IMPORT_PREFIXES.map(escapeRegex).join('|')})[A-Za-z0-9_-]+)\\/_debug\\/?$`,
);

const intelImportDebugPlugin = (): import('vite').Plugin => ({
  name: 'intel-import-debug-json',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split('?')[0] ?? '';
      const match = pathname.match(INTEL_IMPORT_DEBUG_PATH_PATTERN);
      if (!match) {
        next();
        return;
      }

      const sendJson = (body: unknown, statusCode: number): void => {
        const json = JSON.stringify(body, null, 2);
        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.end(json);
      };

      try {
        const token = match[1];
        const prefix = INTEL_IMPORT_PREFIXES.find((candidate) => token.startsWith(candidate));
        if (!prefix) throw new Error('The import token has an invalid prefix.');
        const encoded = token.slice(prefix.length);
        if (!encoded || encoded.includes('=') || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
          throw new Error('The import token is not valid base64url.');
        }
        const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const payload = JSON.parse(gunzipSync(Buffer.from(padded, 'base64')).toString('utf8')) as unknown;
        sendJson({ ok: true, payload }, 200);
      } catch (error) {
        sendJson({
          ok: false,
          error: error instanceof Error ? error.message : 'The import payload could not be decoded.',
        }, 400);
      }
    });
  },
});

export default defineConfig(() => ({
  base: '/intel/',
  plugins: [intelHtmlMetadataPlugin(), intelFontAssetsPlugin(), intelImportDebugPlugin(), react(), svgr()],
  resolve: {
    alias: [
      { find: '@intel', replacement: resolve(import.meta.dirname, 'src') },
      { find: '@main', replacement: resolve(import.meta.dirname, '../../src') },
      { find: '@', replacement: resolve(import.meta.dirname, '../../src') },
    ],
  },
  define: {
    __INTEL_BUILD_TARGET__: JSON.stringify(target),
    __INTEL_DEPLOY_CHANNEL__: JSON.stringify(channel),
  },
  server: {
    port: Number(process.env.INTEL_DEV_PORT || 5174),
    strictPort: true,
    fs: { allow: [resolve(import.meta.dirname, '../..')] },
  },
  build: {
    outDir: resolve(import.meta.dirname, `../../dist/${target}/intel`),
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/intel-[hash].js',
        chunkFileNames: 'assets/intel-[name]-[hash].js',
        assetFileNames(assetInfo) {
          const sourceNames = [
            ...(assetInfo.originalFileNames || []),
            ...(assetInfo.names || []),
            assetInfo.name,
          ].filter(Boolean).map((value) => String(value).replace(/\\/g, '/'));
          if (sourceNames.some((value) => fontAssetPattern.test(value) && value.includes('/assets/fonts/'))) {
            const family = sourceNames.find((value) => value.includes('/assets/fonts/'))
              ?.match(/\/assets\/fonts\/([^/]+)\//)?.[1];
            if (family) return `assets/fonts/${family}/[name]-[hash][extname]`;
          }
          return 'assets/intel-[name]-[hash][extname]';
        },
      },
    },
  },
}));
