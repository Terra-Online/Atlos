import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import svgr from 'vite-plugin-svgr';
import config from './config/config.json';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';
import eslint from 'vite-plugin-eslint';
import { existsSync } from 'fs';
import Inspect from 'vite-plugin-inspect';

const isProd = process.env.NODE_ENV === 'production';
const assetsHost = isProd
    ? `${config.web.build.cdn}${config.web.build.oss.prefix}`
    : '';
import autoprefixer from 'autoprefixer';

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        svgr(),
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
                {
                    src: 'src/assets/fonts',
                    dest: 'assets',
                },
            ].filter((target) => existsSync(target.src)), // 只包含存在的源路径
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
