# Atlos
Atlos is an open-source online map for the 3D RTSRPG game Arknights: Endfield (by Hypergryph). This repository contains the web client (codename “talos”) built with React + Vite, featuring a high‑performance map (Leaflet), rich UI, multilingual support, and a CDN‑friendly build pipeline.

PRs are warmly welcome—see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Community

Come and chat with us on **Discord**: https://discord.gg/2PMegCX4wJ

## Highlights

- Modern stack: React 18, TypeScript, Vite, SCSS Modules
- Map rendering with Leaflet and custom hooks/components (verb.1, we consider to migrate current structure to Canvaskit in next version)
- Clean UI with modals, sidebars, blur/fade transitions
- Full internationalization (UI/Game), clear fallback rules
- CDN/OSS friendly build and publish scripts

## Repository layout

Top-level folders you’ll most likely interact with:

> [!IMPORTANT]
> - `talos/` – the web app
	- `src/` – application source
		- `component/` – UI components (modal, sidebar, language selector, groups modal, etc.)
    		- `component/map/` – map integration (Leaflet + hooks)
		- `locale/` – i18n system, UI text resources
		- `store/` – global UI state (Zustand)
		- `styles/` – shared SCSS (palette, fonts, globals)
		- `utils/` – helpers (device, font loader/cache, logging, resources)
	- `public/` – public static assets
	- `config/` – build-time config (ignored by Git), see “Build & Deploy”
	- `scripts/` – helper scripts (e.g. publish to OSS/CDN)
	- `vite.config.js` – Vite configuration

## Getting started

Requirements:
- Node.js 20+
- pnpm 8+

Install & run (from the `talos` directory):

```bash
# 1) Install deps
pnpm install

# 2) Start dev server
pnpm dev

# 3) Type check (optional)
pnpm run type-check

# 4) Build for production
pnpm build
```

## Internationalization (i18n)

- UI language resources now live under `talos/src/locale/data/ui/`.
- The app distinguishes between “full support” (UI + in‑game terms) and “UI‑only” languages. When game content is not available, English will be used as a fallback for those parts.
- To add or improve translations, see the guidance in [CONTRIBUTING.md](CONTRIBUTING.md).

## Fonts
- Main latin letters are displayed in Novencento Sans Wide family provided by [Synthview Type Design](https://typography.synthview.com/novecento-sans-font-family.php).
- Variable font HMSans (weights 100–900) is used alongside region‑specific fonts.
- Fonts are loaded dynamically using the utilities in `src/utils/fontLoader.ts` and `src/utils/fontCache.ts`.

## Build & Deploy (CDN/OSS)

- Build output is designed to be CDN‑hosted. The base public path is determined from `talos/config/config.json` at build time:
	- `web.build.cdn`: your CDN origin (e.g. `https://cdn.example.com`)
	- `web.build.oss.prefix`: object prefix/path (e.g. `/talos`)
- The file `talos/config/config.json` is Git‑ignored by default. Use `config/config.template.json` as a starting point, and generate a real config.json in your CI/ECS.
- Publishing: `talos/scripts/publish-oss.js` uploads the `dist/` artifacts to OSS and can skip already‑present large assets on the CDN to save time.
- Now we hosted the service on Aliyun for users from China mainland and consider to deploy the site on AWS Singapore server for global users.

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:
- environment setup
- coding standards & linting
- branch/commit/PR conventions
- translation workflow

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See [LICENSE](LICENSE) for the full text.