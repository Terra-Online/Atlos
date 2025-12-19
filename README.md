# Atlos
<ruby>
Atlos (= Atlas)
<rt>from Talos, an anagram trick</rt>
</ruby>is an open-source online map for the 3D RTSRPG game Arknights: Endfield (by Hypergryph). This repository contains the web client (codename “talos”) built with React + Vite, featuring an Endfield-esque UI, multilingual support, and a CDN‑friendly build pipeline.

PRs are warmly welcome—see [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## Community

[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/2PMegCX4wJ)
[![Build](https://img.shields.io/github/actions/workflow/status/Terra-Online/Atlos/build.yml?branch=main&label=build&logo=github)](https://github.com/Terra-Online/Atlos/actions/workflows/build.yml)
[![License](https://img.shields.io/github/license/Terra-Online/Atlos?label=license)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

Come and chat with us on **Discord**: https://discord.gg/2PMegCX4wJ

## Highlights

- Modern stack: React, TypeScript, Vite, SCSS Modules;
- Map rendering with Leaflet and custom hooks/components (verb.1, we consider to migrate current structure to Canvaskit in next version);
- The project is well organized in our JIRA Kanban, consider joining us and take some todos!
- Clean UI with Figma workflow;
- Full internationalization (UI/Game), clear fallback rules;
- CDN/OSS friendly build and publish scripts;

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:
- environment setup
- coding standards & linting
- branch/commit/PR conventions
- translation workflow

## Repository layout

Top-level folders you’ll most likely interact with:

- `talos/` – the web app
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
- pnpm 10+

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

## License

This project is licensed under the **GNU Affero General Public License v3.0**. See [LICENSE](LICENSE) for the full text.
