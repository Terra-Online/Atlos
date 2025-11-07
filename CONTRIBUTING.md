# Contributing to Atlos

Thank you for your interest in contributing! This guide explains how to set up your environment, follow coding standards, add features, and submit high‑quality pull requests.

## 1. Project Scope & Philosophy
Atlos aims to provide a performant, multilingual, map‑centric web client for Arknights: Endfield community knowledge and exploration. We value:
- **Performance**: lean renders, efficient data access, CDN‑friendly assets.
- **Clarity**: typed interfaces (TypeScript), explicit fallbacks for i18n.
- **Maintainability**: modular components, minimal global state, readable SCSS.
- **Openness**: transparent build/deploy flow without leaking secrets.

## 2. Tech Stack Summary
- React 18 + TypeScript (strict mode)
- Vite build system
- SCSS Modules for component styling
- Leaflet for interactive mapping
- Zustand for lightweight global state
- Progressive blur & transitions for UI polish

## 3. Repository Structure (key paths)
```
Atlos/
  talos/
    src/
      component/        # UI + map components
      component/map/    # Leaflet integration & hooks
      locale/           # i18n loader, language data
      store/            # Zustand stores
      styles/           # global SCSS (palette, fonts, curves)
      utils/            # helpers (device, fonts, logging, resources)
      data/             # static data (types, markers)
    config/             # build-time config (ignored from VCS)
    scripts/            # publish / utility scripts
    public/             # static public assets
    vite.config.js      # build config
```

## 4. Environment Setup
```bash
# Move into web client
cd talos

# Install dependencies
pnpm install --frozen-lockfile

# Start dev server
pnpm dev

# Type check
pnpm run type-check

# Build production bundle
pnpm build
```
Node 20+ and pnpm 8+ recommended.

## 5. Coding Standards
- **TypeScript**: prefer explicit types; avoid implicit `any`. Use discriminated unions for complex variants.
- **Components**: keep pure/presentational vs. stateful separated. Co-locate style file (`.module.scss`) with component.
- **Imports**: use path aliases (`@/utils/...`) instead of deep relative traversals.
- **Logging**: use provided util (`log.ts`) rather than raw `console.log` for future centralization.
- **Performance**: memoize expensive derived values; avoid unnecessary re-renders (React hooks discipline).
- **CSS/SCSS**: leverage variables from `palette.scss`, keep selectors shallow, avoid global leakage.

## 6. Git & Branching
- **Branches**: `feature/<name>` for new features; `fix/<name>` for bug fixes; `release/<tag>` for prep.
- **Commits**: Use concise imperative messages; group related changes. Examples:
  - `feat(map): add dynamic marker clustering`
  - `fix(locale): fallback when UI-only language lacks game terms`
  - `chore(build): add OSS skip logic`
- Rebase before opening PR to keep history linear if possible.

## 7. Pull Request Checklist
Before marking a PR ready for review:
- [ ] Builds (`pnpm build`) and passes type-check.
- [ ] No introduction of secret values (config.json remains Git‑ignored).
- [ ] i18n keys added have defaults/fallbacks.
- [ ] UI changes tested in light & dark theme.
- [ ] For new languages or keys: translation placeholders added.
- [ ] Added/updated docs if behavior changed.

## 8. Internationalization Workflow
- UI strings live under `src/locale/data/ui/<lang>.json`.
- Distinguish between full support and UI‑only languages; ensure English fallback for missing in‑game terms.
- When adding a new key:
  1. Add to all existing language JSON files (tentative translation or placeholder).
  2. If the language is UI‑only, confirm fallback logic still works.
  3. Test language switch via `LanguageModal`.

## 9. Fonts
- HMSans variable font (100–900 weight range) configured in `fontLoader.ts`.
- When introducing a new font: ensure proper licensing & add @font-face with range if variable.
- Avoid inlining large font files directly in code; rely on CDN/OSS distribution.

## 10. Map & Data Updates
- Marker type definitions live under `src/data/marker/` and related tree constants.
- For new marker categories:
  - Update marker type tree & ensure translation keys exist.
  - Provide appropriate icons in `src/assets/images/marker/` (if needed) – optional copy logic will include them.
- Keep large geo/asset datasets out of Git if they are dynamic—use external storage/CDN.

## 11. Build & Deployment Notes
- `talos/config/config.json` is intentionally Git‑ignored.
- Use `config/config.template.json` for structure reference; generate a real config in CI/ECS with your CDN + OSS credentials.
- Vite base path derives from `web.build.cdn + web.build.oss.prefix`.
- **Do not** commit secrets (access keys, GA IDs). Inject via environment variables or private config generation.

## 12. Secrets & Safety
- Keep all credentials out of the public repo.
- Provide fallbacks (empty strings) to avoid build crashes when config is absent during local dev.
- NEVER echo secret values in CI logs—mask or print length only.

## 13. Testing & Verification
Currently lightweight (no full test suite). Recommended before PR:
- Manual verification of language switching.
- Map renders without console errors.
- Sidebar interactions (open/close, filter list, triggers) work.

Future additions may include unit tests for utilities & integration smoke tests.

## 14. Adding Translations
1. Duplicate an existing language file as reference.
2. Translate new keys; maintain punctuation consistency.
3. Ensure hints end with a period (or appropriate CJK punctuation)。
4. Validate encoding (UTF‑8) and no trailing commas.

## 15. Submitting Your PR
1. Open PR against `main` (or designated integration branch).
2. Fill description: motivation, changes, any follow-up TODO.
3. Link related issues (if any).
4. Request review from maintainers.

## 16. Questions & Support
Join the Discord community: https://discord.gg/2PMegCX4wJ

## 17. License
Contributions are accepted under the existing project license: **GNU AGPL v3**. By submitting a PR you agree your code is licensed accordingly.

---
Thanks again for helping improve Atlos - Open Endfield Map!
