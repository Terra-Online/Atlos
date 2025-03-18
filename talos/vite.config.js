import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from "vite-plugin-svgr";
import config from './config/config.json';
import { viteStaticCopy } from 'vite-plugin-static-copy'

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
          src: 'src/asset/images/marker',
          dest: 'assets/images'
        },
        {
          src: 'src/asset/images/item',
          dest: 'assets/images'
        }
      ]
    })
  ],
  base: assetsHost,
  define: {
    __ASSETS_HOST: JSON.stringify(assetsHost)
  },
})
