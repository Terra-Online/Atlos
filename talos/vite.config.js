import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from "vite-plugin-svgr";
import config from './config/config.json';

const isProd = process.env.NODE_ENV === "production";
const assetsHost = isProd ? `${config.web.build.cdn}${config.web.build.oss.prefix}` : "";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), svgr()],
  base: assetsHost,
  define: {
    __ASSETS_HOST: JSON.stringify(assetsHost)
  },
})
