# Downloading client files for local extraction

The local packing workflow downloaded missing CHK files directly from the official
client CDN's split ZIP. EndfieldStudio is an extraction tool, not the downloader
used by that workflow. `scripts/noclip-download.py` is the maintained version of
that selective downloader. It needs Python 3.10+ and no third-party packages.

## Input

Supply a **local launcher package-response JSON** for the exact PC client build
being extracted. Obtain the response from the official launcher's download
metadata, or obtain the matching saved response from the person supplying your
development dataset. The downloader does not discover builds, authenticate, fetch
hot updates, or scrape launcher endpoints. A complete official installation is
also a valid input for noclip and needs no selective download step.

The response must have this shape (URLs and sizes below are placeholders):

```json
{
  "proxy_rsps": [{
    "get_latest_game_rsp": {
      "pkg": {
        "packs": [
          { "url": "https://CLIENT-CDN/first-part", "package_size": 1000000 },
          { "url": "https://CLIENT-CDN/final-part", "package_size": 200000 }
        ]
      }
    }
  }]
}
```

Preserve the original part order and exact byte sizes. Keep the response outside
Git; CDN URLs may expire. Use one build throughout: EXE/DLL, IL2CPP metadata,
catalogs and chunks must match. An old saved manifest is not a current-build API.

## List and download

Run from `talos`. Use absolute paths for your local inputs and outputs:

```sh
python3 scripts/noclip-download.py --links /data/client-links.json \
  --cache /data/download-cache --list > /data/client-files.txt
```

The script downloads the tail of the final part to read the central directory.
If that directory is larger than the default 8 MiB, increase `--index-bytes`
(for example `33554432`). It then downloads only the ranges for selected files,
including entries crossing part boundaries. The CDN must support HTTP Range
requests with status 206; full-file fallback is deliberately rejected.

Create `/data/required-files.txt` with **one exact archive path per line**, copied
from the listing. For initial extraction, select `GameAssembly.dll`,
`Endfield_Data/il2cpp_data/Metadata/global-metadata.dat`, and the VFS `.blc`
catalogs. Keep any leading archive directory in these paths. Then download them:

```sh
python3 scripts/noclip-download.py --links /data/client-links.json \
  --cache /data/download-cache --out /data/client \
  --file-list /data/required-files.txt
```

For a missing chunk reported by `init` or `pack`, copy its exact filename:

```sh
python3 scripts/noclip-download.py --links /data/client-links.json \
  --cache /data/download-cache --out /data/client MISSING_HASH.chk
```

A unique path suffix is accepted; ambiguous suffixes fail. Rerun the failed
extractor command and repeat for other missing chunks. For unattended packing,
select all required chunks first or use a full installation. The helper does not
guess a scene's dependency closure and is not automatically invoked by `pack`.

Output preserves archive-relative paths. Find the resulting directory containing
`GameAssembly.dll` beside `Endfield_Data` and pass that directory to noclip `init`.
Raw CHK files are not viewer packages. noclip directly reads the VFS containers;
you do not need to dump every bundle through EndfieldStudio first.

Downloaded files must match ZIP size and CRC before atomic publication. Matching
existing files are verified and skipped; mismatched files are never overwritten.
Inspect and move an incorrect existing file yourself before retrying. If a cached
range is corrupt, remove the affected manifest-specific cache directory and retry.
CRC is an archive integrity check, not an authenticity signature: use trusted
official metadata over HTTPS. Cached ranges are retained for reuse; allow disk
space for both the selected compressed ranges and extracted files.

The helper supports stored/deflated files with ordinary local ZIP headers. It
rejects encryption, data descriptors, ZIP64 local entries, traversal paths and
symlink output paths. If a future client archive uses unsupported features, use
the official full installer rather than bypassing these checks.

## Extraction prerequisites

Use Node 26 and the Atlos-pinned pnpm version. Run `pnpm noclip:prepare` and
`pnpm install --frozen-lockfile` from `talos` before invoking the generated CLI.
Initialize a private config using the matching client and local key-source
checkouts, as described in the generated noclip `docs/extraction.md`.
`An1X3R/Endfield-map-extractor` supplies the supported VFS-key source layout;
`Escartem/AnimeStudio` supplies the supported bundle-key source layout. The
`EIHRTeam/EndfieldStudio` checkout used locally is based on AnimeStudio, but a
future fork layout is not guaranteed to satisfy `init --keys-from`.

Only cloning these source checkouts is necessary for key import. Building their
GUIs, installing .NET/Blender or running their full extraction pipelines is not a
prerequisite for the noclip exporter. No keys, saved responses, raw client files,
download caches, extracted assets or private configs belong in Git.

## Validation

```sh
python3 scripts/noclip-download-test.py
python3 scripts/noclip-download.py --help
```

The offline regression fixture covers split-boundary reads, verified reuse,
overwrite refusal, traversal rejection, corrupt output rejection and a server
ignoring Range. Live client completeness must still be checked by `init`, `pack`
and `oem-check` against your own matching dataset.
