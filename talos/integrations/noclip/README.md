# noclip integration

`source.json` pins the current upstream commit and its exact source archive. The patches own our
renderer host, photography, OEM package contracts and extraction/navigation extensions. They are
Atlos build inputs; the `EF Repos/endfield-noclip` checkout stays on upstream `trunk` without local
feature commits. `feat/filters` remains a separate PR development branch in that repository.

```sh
cd talos
pnpm noclip:prepare
pnpm install --frozen-lockfile
```

Preparation verifies the archive and applies the patches into ignored `.cache/noclip`. All four
generated packages participate in this workspace; World bundles the viewer and invokes the generated
extractor for local route jobs. Node 26 is required for the upstream APIs. The cache has no `.git`
directory and can be recreated from these committed inputs. Preparation rejects edited generated
source; move intentional changes into the corresponding patch before regenerating.

Use the existing `pnpm dev:world`, `pnpm type-check --app world`, `pnpm test --app world` and
`pnpm build --app world` commands after preparation. World builds record the upstream commit and a
digest of the manifest and patches, so deployment checks the exact renderer inputs.

For the standalone viewer, run `pnpm --filter @endfield-noclip/viewer dev` with `NOCLIP_PACKAGES` and
`NOCLIP_RELEASES` pointing to the retained local data. `WORLD_ROUTING_DIRECTORY` and `WORLD_GAME_CONFIG`
configure route data and the private game configuration. Neither keys nor game content belong here.

## updating

The current pin uses package format v106, including sludge-erosion decals, subsurface
water materials and decal ordering beneath water. Existing v104 archives must be repacked
before using this viewer.
Export companion and navigation metadata against the new states before rebaking point views with
`oem-views --rebuild`. The exporter and `oem-check` use the indexed `openTraversalPicks` profile,
matching World's default completed progression with doors open and activations enabled. Using only
completed progression produces different visibility keys and makes the frontend discard baked poses.
Offline decoding retains moving-row buffers and frames their initial path pose
without mutating shared decoded rows. Publish the resulting immutable catalog only after `oem-check`
confirms complete pose coverage and generation/visibility bindings. A context-only fallback remains
an unconfirmed view, not proof that the target is visible.

1. Fast-forward the clean upstream noclip checkout to its upstream `trunk`.
2. Regenerate `upstream.tar.gz` with `git archive --format=tar.gz <upstream-remote>/trunk`, record its commit
   and SHA-256 in `source.json`, and port each patch to that baseline. Review the package-format version
   before replacing the active viewer; a breaking format requires repacking the retained maps.
3. Run preparation, installation, World tests/type checking/build and the generated extractor tests.
   Check a real map, target framing, navigation and photography before accepting the migration.
4. Keep one current upstream archive. Ganglia is the editable `packages/ganglia` workspace
   package, shared by World and the extractor. Remove replaced upstream artifacts after
   validation; do not add old-format readers or keep backup source trees.

The patches migrate the previously committed implementation recorded by `migratedFrom` in
`source.json`. Future OEM-specific changes belong here or in `apps/world`. Renderer changes suitable
for upstream should be developed on a focused PR branch, then incorporated into these inputs until
accepted upstream. There is no integration branch or permanent repack checkout.
