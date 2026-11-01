import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import { resourceConfig } from '../../scripts/release-artifact.mjs';
import { getDeployChannel } from '../../scripts/release-channel.js';

export default defineConfig(async ({ command }) => {
    const root = resolve(import.meta.dirname, '../..');
    const target = process.env.BUILD_TARGET === 'r2' ? 'org' : 'cn';
    const assetsHost =
        command === 'serve'
            ? ''
            : (
                  await resourceConfig(
                      root,
                      process.env,
                      { channel: getDeployChannel() },
                      target,
                  )
              ).assetsHost;
    return {
        base: '/minimap/',
        plugins: [react(), svgr()],
        build: {
            rollupOptions: {
                input: {
                    minimap: resolve(import.meta.dirname, 'index.html'),
                    regions: resolve(import.meta.dirname, 'regions.html'),
                },
            },
        },
        envDir: root,
        resolve: { alias: { '@': resolve(root, 'src') } },
        define: {
            __ASSETS_HOST: JSON.stringify(assetsHost),
            __APP_VERSION__: JSON.stringify(
                process.env.BUILD_ASSET_VERSION || '',
            ),
        },
        server: {
            proxy: {
                '/clips': 'http://127.0.0.1:5173',
                '/assets': 'http://127.0.0.1:5173',
            },
        },
    };
});
