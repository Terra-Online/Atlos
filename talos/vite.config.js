import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import svgr from "vite-plugin-svgr";
import config from './config/config.json';
import {viteStaticCopy} from 'vite-plugin-static-copy'
import {resolve} from 'path'
import eslint from 'vite-plugin-eslint';

const isProd = process.env.NODE_ENV === "production";
const assetsHost = isProd ? `${config.web.build.cdn}${config.web.build.oss.prefix}` : "";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    svgr(),
    viteStaticCopy({
      targets: [
        {
          src: 'src/asset/images/shared',
          dest: 'asset/images'
        },
        {
          src: 'src/asset/images/marker',
          dest: 'asset/images'
        },
        {
          src: 'src/asset/images/item',
          dest: 'asset/images'
        },
        {
          src: 'src/asset/images/category',
          dest: 'asset/images'
        }
      ]
    }),
    eslint({
      failOnWarning: false,
      failOnError: false,
      emitWarning: true,
      emitError: true,
    })
  ],
  base: assetsHost,
  define: {
    __ASSETS_HOST: JSON.stringify(assetsHost)
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/components': resolve(__dirname, 'src/component'),
      '@/utils': resolve(__dirname, 'src/utils'),
      '@/data': resolve(__dirname, 'src/data'),
      '@/assets': resolve(__dirname, 'src/asset'),
      '@/styles': resolve(__dirname, 'src/styles')
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
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
})
