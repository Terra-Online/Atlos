# Stable font shards

All three apps use one immutable CJK font layout and canonical resource URLs:
`<assetsHost>/assets/fonts/shards/v1/<content-hashed file>`. App builds contain
a copy of these resources; the task runner also composes them into the
artifact's shared root. App-only publication requires a full published baseline
containing the same shards. Publishers preserve historical shard URLs.

## Generate and validate

From `talos`:

```sh
pnpm data fonts
node scripts/fonts/catalog.mjs
```

Generation requires `fonttools`, `brotli`, and the private originals under
`src/assets/fonts_original`. The generated resources and reports live in
`.cache/font-shards/v1/`; they are not committed. Normal builds verify these
resources and current UI coverage, without regenerating fonts. Source-only CI
builds omit private fonts and retain fallback rendering.

`layout-v1.json` freezes three initial semantic sets per region: UI literals,
map/region/Intel names, and archive text ordered by document co-occurrence. It
also pins the original-font digests and the packing profile. ICU extraction uses
literal branches, without argument names/selectors. Daily text changes and new
apps never change this snapshot.

The UI base remains one pack. All current map/region/Intel names beyond the UI
base fit into one terms pack (about 700–800 characters per region). Reading
characters form the prose pack: Harmony is the preferred pack for CN/HK and UD
faces provide the prose pack for JP. CN/HK UD faces keep those glyphs in the
residual packs, so custom text can still use every glyph from the original cmap
without downloading a second semantic pack. The residual cmap is packed by
**actual character count**, targeting 1,024 characters, merging/rebalancing
tails below 512, with a 1,536-glyph ceiling. Unicode interval width is not a
size criterion. The four UD weights share partition boundaries where their
semantic policy is the same; Harmony packs its actual cmap separately. This
avoids tiny fragments from sparse CJK extensions, compatibility characters and
private-use blocks.

Manifest parts use one interned coverage map for both selection and
`unicode-range`. Older beta manifests may still contain the redundant `range`
field and remain readable; newly generated manifests omit it.

A source font change requires a deliberate layout/version update; do not edit
the published v1 partition to accommodate new UI text. Re-running generation
checks cached file hashes, leaves unchanged bytes untouched and retains old
hashed outputs. Diagnostic partial generation requires a temporary output path.

## Runtime contract

The shared Vite plugin translates the existing CJK `font-family` entries into
region variables while preserving preceding Latin faces and the family order. It
leaves `@font-face` definitions intact. Main boot and each app's existing locale
initialization reuse an early HTML module that starts the build-time shell
requests independently of application startup. Its metadata is a generated
module dependency in dev and production, so it does not depend on Vite's client
installing globals first. Initial locale setup waits for the shell before
rendering the app.
`requirements.mjs` resolves each app's own UI text to frozen shard IDs at build
time; it never regenerates fonts. Shell faces are explicit per app. Map names and
other apps' catalogs do not enlarge the startup shell. UI requirements include
ICU literal branches. The main map preloads its target region's selector/binder
names and both zoom label sets through `preloadMapFonts(regionKey)`.

`prepareFonts(selection, alias)` loads every selected face without registering
it. An explicit owner registers the complete set and enables its aliases in one
task. Each document shares one reference-counted native face per locale, face
and immutable shard, including pending loads. Overlapping owner selections do
not decode the same WOFF2 twice, and a small owner does not wait for unrelated
parts of a larger selection. Up to 24 idle shards stay warm for repeat visits.
Updating text or language invalidates pending work. Text updates keep the
previous complete aliases until the new selection is ready. Language changes retain
the previous complete collection while preparing every mounted owner, and only
commit if the locale request and owner revisions are still current. Failed
language changes retain the previous fonts and catalog. Initial or new-content
failures retain fallback until a later update or visit.
Fonts load directly from immutable URLs through the browser's
font pipeline and resource cache, without retaining source buffers in JavaScript.

`useFontRegion(runs)` attaches to an existing component element. Supply actual
formatted data and the ordered CJK faces declared by that component, including
pseudo-element text. Ref detachment releases ownership. Static UI for its faces
is included automatically. Modals, archive bodies, ID cards and translation
annotations declare their data; tooltips register on opening. Fonts preserve
existing Latin precedence and unsupported glyphs retain the original fallback.
Body font declarations also bind at explicit owners to isolate inherited text.
`preloadFontRuns` uses the same native shard cache for intent-driven warmup;
`registerFontRegion(...).ready` allows non-React owners such as map labels to
finish preparation before they insert new text. Map label panes own both site
and subregion text, so normal pan/zoom does not discover additional glyphs.
Mark catalog-derived runs with `localized: 'ui'` or `'game'`: target-language
requirements come from build metadata, rather than downloading fonts for old
translations that will be replaced. User text remains part of each target demand.
The fixed `Lang Origin` face remains outside the regional aliases and is warmed
when the language component mounts, including while its dialog is closed.
Standalone language dialogs prepare their app's catalog before changing shared
fonts; catalogs and locale stores remain independent.

There is no DOM text traversal, computed-style/geometry inspection or scroll,
image-load or animation listener in the font loader. A single attribute observer
tracks document language, including picture-in-picture. Virtualized components
request fonts when mounted. `fontregionchange` announces atomic activation for
existing overflow measurements.

## Regression checks

```sh
pnpm exec vitest run src/locale/fontShards.spec.ts
node --test scripts/fonts/fonts.test.mjs scripts/tasks.test.mjs
python3 -m unittest discover -s scripts/fonts -p '*_test.py'
node scripts/fonts/browser.mjs
node scripts/fonts/ui-browser.mjs
```

The browser harness requires Playwright with Chromium, Firefox and WebKit
installed and resolvable (an existing tool runtime can be supplied via
`NODE_PATH`). It starts its own loopback server, uses actual generated fonts,
and records results to `.cache/font-browser/results.json`. It checks delayed
responses, failure/retry, language races, explicit mount demand without scroll scanning and cleanup.
The UI check uses the actual app and Chromium's platform-font inspection to
verify SC/HK/JP sidebar faces, Medium labels, and unchanged `Lang Origin` glyphs.
It also checks slow and superseded language requests and absence of reloads or
fallback frames during a language switch. Both harnesses isolate their Vite
dependency caches from the development server; outputs remain under `.cache`.
