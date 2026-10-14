# talos

Use Node 20+ and the pinned pnpm version. Copy both config templates under
`config/` to `config.json` and `config.r2.json`, then configure your local
targets. Keep credentials out of Git.

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:intel
pnpm dev:user-hub
```

The main dev server proxies the selected app at `/intel/` or `/me/`.

## Build and check

```sh
pnpm build                             # ORG full site: main, Intel, user hub, SEO
pnpm build --target cn                 # CN full site
pnpm build --target org
pnpm build --target all                # Prepare data/fonts once for both sites
pnpm build --target org --channel beta
pnpm build --app user-hub --target org  # Partial build for local inspection
pnpm check                             # Data, types, lint, all existing tests
pnpm check --build                      # Also build both targets; share preparation
pnpm type-check --app intel
pnpm run test --app user-hub
pnpm lint
pnpm lint:fix                           # Lint fixes only
pnpm format                            # Explicit source formatting
pnpm preview --outDir dist/r2
```

Outputs remain `dist/oss` (CN) and `dist/r2` (ORG); the default build and
preview target is ORG. `--skip-subset` skips font subsetting in all apps;
`--skip-subset-fonts` remains an alias.
Font processing caches input signatures and output hashes under `.cache/fonts`.
Unchanged fonts are skipped; missing or modified outputs are regenerated.
All apps process fonts in parallel; Intel and user-hub emit WOFF2 only.
Run `python3 scripts/subset_fonts_test.py` for font cache regression checks
(requires fonttools and brotli).
Vite reports emitted asset sizes and gzip sizes for each app.
OG rendering keeps map intermediates lossless in memory; use
`SEO_OG_PIPELINE=legacy` only to compare against the previous JPEG pipeline.
OG generation defaults to 16 point workers with one libvips worker per task to
avoid CPU oversubscription; override with `SEO_OG_CONCURRENCY` or
`SEO_SHARP_CONCURRENCY` when benchmarking another host. The renderer caches the
rasterized map mask and only submits tiles that can intersect the OG window.
Marker SVGs are rasterized once and reused; set `SEO_MARKER_RASTER_CACHE=0`
only when comparing the uncached path.
Builds never publish. Partial builds invalidate the full-site build receipt;
rebuild the complete site before publishing.

Lint follows existing selector naming and CSS compatibility patterns.
Prettier runs separately. Type-aware ESLint covers all apps and both Workers;
Node maintenance scripts use JS correctness rules. Vite does not run lint.
Lint and default main-site tests use tracked and new non-ignored files, keeping
local scratch tests and generated artifacts outside the normal check.

CI uses `pnpm check --build --source-only --skip-subset`: it checks public
source contracts and compiles both targets without private icon/font/map
assets. Source-only artifacts cannot be published. Normal local checks and
release builds require Intel's actual icon files.

## Publish

```sh
pnpm deploy:all                  # Both production sites, then relink Worker
pnpm deploy:all --skip-og        # Skip both OG generation and upload
pnpm deploy:cn                   # CN only: OSS and server
pnpm deploy:org                  # ORG only: R2 and Pages
pnpm deploy:org --channel beta
pnpm deploy:all --dry-run        # Print without executing
```

Deployment runs data and artifact checks. Run `pnpm check` separately for
types, lint and tests. See [RELEASE.md](./RELEASE.md) for independent publishing,
offline packages, target configuration and command migration.

## Data tools

```sh
pnpm data prepare
pnpm data check
pnpm data tile-coverage
pnpm data sync-intel
pnpm data fonts --app intel
pnpm og --target org
pnpm worker search check
pnpm worker search deploy
```

`pnpm data --help` lists individual tasks. Unknown CLI values are rejected;
`--` separators are accepted.

Map tiles and other large/licensed assets are not distributed in this
repository. For map clips for local preview, contact cirisus at
`cirisus@outlook.com`.
