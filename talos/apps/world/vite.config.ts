import { sceneCatalog } from './scene-resources';
import { createHash } from 'node:crypto';
import { hashFiles } from '../../scripts/release-snapshot.mjs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { fontShardsPlugin } from '../../scripts/fonts/vite-plugin.mjs';
import { resourceConfig } from '../../scripts/release-artifact.mjs';
import { routeServer } from './dev-route-server';
import { getDeployChannel } from '../../scripts/release-channel.js';

export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
    const root = resolve(import.meta.dirname, '../..');
    const env = { ...loadEnv(mode, root, ''), ...process.env };
    if (command === 'build' && !env.VITE_WORLD_CATALOG_URL)
        throw new Error(
            'Set VITE_WORLD_CATALOG_URL to a verified immutable release before building World',
        );
    const assetsHost =
        command === 'serve'
            ? ''
            : (
                  await resourceConfig(
                      root,
                      env,
                      { channel: getDeployChannel() },
                      'org',
                  )
              ).assetsHost;
    return {
        base: '/',
        build: { emptyOutDir: true },
        envDir: root,
        plugins: [
            fontShardsPlugin('world'),
            react(),
            svgr(),
            routeServer(env.WORLD_ROUTING_DIRECTORY, {
                sceneBinding: sceneCatalog(env.VITE_WORLD_CATALOG_URL),
                extractor: resolve(root, '.cache/noclip'),
                config: env.WORLD_GAME_CONFIG,
                node: env.WORLD_EXTRACTOR_NODE,
                solver:
                    'workspace:' +
                    createHash('sha256')
                        .update(
                            JSON.stringify(
                                await hashFiles(
                                    resolve(root, 'packages/ganglia/src'),
                                ),
                            ),
                        )
                        .digest('hex'),
            }),
        ],
        resolve: {
            alias: { '@': resolve(root, 'src') },
            dedupe: ['react', 'react-dom'],
        },
        define: {
            __ASSETS_HOST: JSON.stringify(assetsHost),
            __APP_VERSION__: JSON.stringify(env.BUILD_ASSET_VERSION || ''),
        },
        worker: { format: 'es' },
        server: {
            proxy: {
                '/clips': 'http://127.0.0.1:5173',
                '/satellite': 'http://127.0.0.1:5173',
                '/assets': 'http://127.0.0.1:5173',
                '/oem': 'http://127.0.0.1:5199',
            },
        },
    };
});
