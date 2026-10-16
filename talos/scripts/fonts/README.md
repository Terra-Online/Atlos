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
initialization start the shared observer without waiting for downloads.

`prepareFonts(selection, alias)` loads every selected face without registering
it. A region registers the complete prepared set and enables its aliases in one
task. Different complete selections have different aliases; regions with an
identical complete selection share loaded native faces with reference-counted
cleanup. A later text/language request invalidates previous pending work. Failed
regions remain in fallback and retry after the next content change or visit.
Completed buffers are shared between regions, bounded by 64 entries / 16 MiB;
in-flight requests are deduped.

`data-font-region` declares a boundary on an existing element, without adding a
layout wrapper. Shell, sidebar, drawer, detail and modal containers declare it;
articles, dialogs and tooltips are also automatic boundaries. Nested boundaries
are excluded from their parent's demand. The collector reads visible DOM text,
formatted dynamic values, input/select values, placeholders and pseudo content.
The bubbling `fontregionchange` event lets overflow labels remeasure after
regional activation or fallback. Viewport changes update demand; unrendered
virtual-list items are never scanned. Original cmap holes and unsupported
characters continue through the existing fallback stack. Picture-in-picture has
its own observer and cleanup lifecycle.

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
responses, failure/retry, language races, offscreen/scroll demand and cleanup.
