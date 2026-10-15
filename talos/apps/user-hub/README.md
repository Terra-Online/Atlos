# User center

Standalone account pages under `/me/`, sharing the map's session cookies,
language preference, fonts, and theme. Signed-out users sign in through the
shared login dialog in place. The profile dialog links to this app.

`/me/` opens the content center for images, comments, and review status.
`/me/profile` edits the avatar and nickname. Previous account and service
URLs redirect to the content center.

From `talos/`:

- `pnpm dev:user-hub`: starts the main site and user hub; open `http://localhost:5173/me/`. The hub Vite server runs behind the main site proxy on port 5175.
- `pnpm dev:intel`: starts the main site and Intel app. Each development command
  starts only its selected app alongside the main site.
- `pnpm type-check --app user-hub` and `pnpm run test --app user-hub`: focused validation.
- `pnpm build --app user-hub --target cn`: domestic build in `dist/oss/me`, using the `.cn` API.
- `pnpm build --app user-hub`: international (default) build in `dist/r2/me`,
  using the `.org` API. Add `--channel beta` for the beta variant.

`VITE_AUTH_BASE` in the build command environment overrides the user hub's production API
endpoint. Development reads the main
workspace's environment files and defaults to the local Bayes instance on port
8787 when no endpoint is configured.

`build` and `deploy:all` include the user center after the main build. Pages
packaging copies `dist/r2/me` and supplies the `/me/*` fallback. Building only
the main site with `--app main` does not build standalone apps and invalidates
the complete-site build receipt.

The overview, login methods, and Endfield binding come from `/me/v1/overview`.
Contributions load separately from `/me/v1/contributions`, using the backend's
cursor pagination. Account linking and unlinking use `/auth/v1`; Endfield
unlinking uses `/binding/v1/endfield/unlink`. New Endfield bindings continue to
use the map's existing binding dialog.

UI strings live in this app's `src/locale/data/ui` catalogs. English,
Simplified Chinese, and Traditional Chinese are included; untranslated locales
use the app's English fallback. Shared components retain the main locale catalog. The regression suite covers request
cancellation, pagination retry, refresh, duplicate page requests, and account/profile
errors.

Typography follows the source components: HarmonyOS Sans for interface labels,
UD ShinGo for the ID card and regional fallbacks, and Fedra for metadata.
The root size follows the map's screen breakpoints; body copy remains 18px. Novecento follows the shared main-site display headings, ID card, and option tags.

The compact profile reuses the map's ID card view, avatar offsets, responsive
scaling, textures, and pointer-driven gradient. Navigation uses standard links with the Intel sidebar filter's style and state
transitions under app-owned names; content filters reuse ModalTabs. App-specific classes and overrides stay inside user-hub, while
the original main-site component CSS stays unchanged. Navigation has no decorative icons,
and filter counts sit beside their labels. Header controls use HeadItem; account and
feed actions use AccessButton. Contribution cards reuse notification styles, and comments use CommentContent
for formatted text and emoji. Icons come from the main site's existing assets.
Theme changes retain the map's timing curves, texture filters, icon rotation,
and shadow transitions.
