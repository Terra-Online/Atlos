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
base fit into one pack (about 700–800 characters per region). Reading characters
remain adjacent in document order. The rest of the original cmap is packed by
**actual character count**, targeting 1,024 characters, merging/rebalancing
tails below 512, with a 1,536-glyph ceiling. Unicode interval width is not a
size criterion. The four UD weights share partition boundaries so coverage maps
can be reused; Harmony packs its actual cmap separately. This avoids tiny
fragments from sparse CJK extensions, compatibility characters and private-use
blocks.

A source font change requires a deliberate layout/version update; do not edit
the published v1 partition to accommodate new UI text. Re-running generation
checks cached file hashes, leaves unchanged bytes untouched and retains old
hashed outputs. Diagnostic partial generation requires a temporary output path.

## Runtime contract

The shared Vite plugin translates the existing CJK `font-family` entries into
region variables while preserving preceding Latin faces and the family order. It
leaves `@font-face` definitions intact. Main boot and each app's existing locale
initialization start the build-time shell requests without waiting for downloads.
`requirements.mjs` resolves catalog text to frozen shard IDs at build time; it
never regenerates fonts. Shell faces are explicit per app. New catalog characters
select existing residual packs. UI requirements include ICU literal branches.

`prepareFonts(selection, alias)` loads every selected face without registering
it. An explicit owner registers the complete set and enables its aliases in one
task. Identical selections share reference-counted native faces. Updating text
or language invalidates pending work; failures retain fallback until a later
update or visit. Source buffers are shared and bounded by 64 entries / 16 MiB.

`useFontRegion(runs)` attaches to an existing component element. Supply actual
formatted data and the ordered CJK faces declared by that component, including
pseudo-element text. Ref detachment releases ownership. Static UI for its faces
is included automatically. Modals, archive bodies, ID cards and translation
annotations declare their data; tooltips register on opening. Fonts preserve
existing Latin precedence and unsupported glyphs retain the original fallback.
Body font declarations also bind at explicit owners to isolate inherited text.

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
```

The browser harness requires Playwright with Chromium, Firefox and WebKit
installed and resolvable (an existing tool runtime can be supplied via
`NODE_PATH`). It starts its own loopback server, uses actual generated fonts,
and records results to `.cache/font-browser/results.json`. It checks delayed
responses, failure/retry, language races, explicit mount demand without scroll scanning and cleanup.
