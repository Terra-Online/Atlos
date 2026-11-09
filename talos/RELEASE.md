# Release runbook

Run commands from `talos/`. Configure both ignored files under `config/`
using their templates. Local publishing needs existing OSS/R2 credentials,
Cloudflare authentication, and the `atlos-cn` SSH alias for the server.

## Normal release

Build, deploy, publish, package and OG commands default to ORG/R2. Select CN
or all targets explicitly; `deploy:all` always deploys both sites.

```sh
pnpm check
pnpm deploy:org                  # ORG / R2
pnpm deploy:all
pnpm deploy:all --skip-og
pnpm deploy:cn
pnpm deploy:org --channel beta
pnpm deploy:all --dry-run
```

`deploy:all` prepares data and each app's fonts once, generates OG by default,
then builds/publishes both complete sites in parallel. CN publishes OSS and
replaces the server's `dist/`. ORG publishes R2 and packages/deploys Pages.
Only after both sites succeed does it deploy relink. Single-site deployment
does not deploy shared Workers; search Worker publishing remains explicit.

`--skip-og` (alias `--skip-seo-og`) disables both generation and upload,
including old OG output. `--skip-subset` (alias `--skip-subset-fonts`) skips
all font pipelines. `--skip-intel` explicitly omits Intel and its Pages routes;
the main site and user hub remain required.

Deployment checks data and complete artifacts. Types, lint and tests run
through `pnpm check` and CI. Each parallel site reports its result; a successful
external upload remains published if its peer fails. Server replacement retains
rollback on a failed directory swap. Dry-run prints commands/environment
overrides without generating, validating, packaging or uploading files; it does
not prove current artifacts are valid.

## Independent publishing and recovery

```sh
pnpm build --target all
pnpm run publish                                # ORG: R2 + Pages
pnpm run publish --target cn                    # OSS + server
pnpm run publish --target cn --only oss
pnpm run publish --target cn --only server
pnpm run publish --target org                   # R2 + Pages
pnpm run publish --target org --only r2
pnpm run publish --target org --only pages
pnpm run publish --target org --only resources
```

Use **`pnpm run publish`**: `pnpm publish` is pnpm's registry command.
Publishing never rebuilds. `--dist-dir PATH` selects an extracted/offline
artifact instead of the default target directory.

Complete builds write `.atlos-build.json` with target, channel, source commit
and included apps. Publishing checks that receipt, app entrypoints/assets, SEO
point pages, robots and sitemap. Whole-site publishing rejects wrong-channel,
incomplete, main-only and source-only CI artifacts. Builds without a receipt need a fresh
complete build. The source commit records provenance and need not match the
current checkout, allowing recovery from an older built artifact.
Resource upload also checks the recorded CDN, bucket/endpoint and prefix against
the current configuration. Restore the matching configuration or rebuild if
they differ. Beta prefixes must differ from both configured and overridden
production prefixes.

```sh
pnpm build --target org --channel beta
pnpm run publish --target org --channel beta
pnpm run publish --target org --channel beta --only resources --skip-og
```

The CN server serves production only. CN beta offline/resource builds remain
available with `build --target cn --channel beta` and
`run publish --target cn --channel beta --only oss`; they cannot replace
the production server directory.

Pages always packages the complete ORG site, including Intel, user hub, point
aliases and route/cache configuration. Do not upload a standalone app directory
to the whole-site Pages project.

## Publishing one app

Intel and the user hub can be released without rebuilding the main site or
changing hosting. First establish a baseline with one successful full release
using these scripts (`pnpm deploy:org` or `pnpm deploy:cn`). Older releases do
not have the required snapshot and remote state. A full `pnpm run publish`
also establishes a baseline from an already-built complete artifact.

```sh
pnpm deploy:org --app intel
pnpm deploy:org --app user-hub
pnpm deploy:cn --app intel
pnpm deploy:org --app intel --channel beta

# Or build, inspect/test, and publish the same app artifact later:
pnpm build --target org --app user-hub
pnpm run publish --target org --app user-hub
```

Standalone builds go to `dist/apps/<target>-<channel>/intel` or `me`, and write
an app receipt with file hashes. They leave `dist/r2` and `dist/oss` intact.
`--dist-dir` selects the parent containing `intel/` or `me/` when building or
publishing an app. `--app main` remains a local partial build; publishing main
alone is unsupported. App publishing rejects `--only` and `--skip-intel`;
both resources and entrypoints must be published together. It skips OG work
and shared Worker deployment, including when targeting both sites.

Each full successful publication saves the complete artifact in
`.release-work/<target>-<channel>/published`. Remote state records its ID and
content digest under `<resource-prefix>/_release/<target>-<channel>/state.json`.
The snapshot is local to the publishing checkout: a different host/checkout,
missing snapshot, changed file, changed destination, source-only build, or
failed/transport-only last publication requires a full publish before releasing
an app. Keep `.release-work` when retaining the ability to publish apps.

App publishing verifies the snapshot against remote state and live HTML/entry
assets, then overlays the selected app into an isolated complete artifact under
`dist/releases/`. Other applications, main-site resources, SEO and root files
are preserved. Previous hashed app chunks are retained for open browser sessions;
colliding immutable filenames with different bytes are rejected. Per-app source
versions are recorded in the composed build receipt. Runtime shared images and
archive text must match the published baseline; changing those requires a full
release. Pages receives the complete composed package. CN uploads the selected
app's OSS resources first, then swaps the composed complete server directory.
App uploads do not reconcile or prune main-site assets or tiles.

Release commands no longer create or consult local `.cache/release.lock` or
remote `_release/<target>-<channel>/lock.json` objects. Legacy lock files are
ignored; interrupted and failed releases can be retried without manual unlocks.
Run builds and releases from one checkout serially, and coordinate publications
to the same target/channel across hosts. `deploy:all` still manages its two
independent site pipelines in parallel.

Ctrl+C and SIGTERM cancel the command, terminate its child command trees and
prevent subsequent build/upload/Worker stages from starting. On POSIX systems,
unresponsive command groups are killed after five seconds; network calls cannot
keep a cancelled CLI running beyond the six-second shutdown deadline.

Remote state becomes `publishing` before uploads begin and becomes `ready` only
after entrypoint and entry JS/CSS HTTP/MIME/content checks succeed and the new
snapshot is saved. A failed release may have partially updated the remote; it
cannot serve as an app baseline. Complete a full publish to recover; no lock
cleanup is required. An already submitted Pages deployment or remote SSH
operation may still complete after the local command is cancelled; cancellation
does not roll back externally accepted work. A transport-only `--only`
publication records `partial` and requires a full publish to reestablish a
baseline.

Use the unified commands for **all** releases. Direct transport scripts, manual
Wrangler deployments and raw file uploads bypass release checks. Existing
out-of-band HTML changes are detected; simultaneous publications are not
serialized. Dry-run does not check the remote baseline. No command in this
workflow changes hosting configuration.

## OG images and Workers

```sh
pnpm og                                      # Generate ORG (default)
pnpm og --target all                         # Generate both targets
pnpm og --target org --channel beta
pnpm og --target cn --action publish
pnpm og --target org --action refresh         # Refresh state of existing images
pnpm worker search check
pnpm worker search deploy
pnpm worker relink check
pnpm worker relink deploy
```

OG output remains `../seo-og/oss` and `../seo-og/r2`. Incremental queues,
empty-directory deletion protection and full verification options remain in
the transport scripts. Worker commands never publish a site; builds never
publish a Worker.

## Offline packages

```sh
pnpm package                                  # ORG / prod archive (default)
pnpm package --target cn --channel prod
pnpm package --target org --channel beta
pnpm package --target org --channel prod --skip-build
pnpm package --target org --format pages --skip-build
```

Archive packages contain the complete artifact and receipt inside `dist/`,
plus SHA-256 and metadata files under `release-artifacts/`. Packaging still
prunes `clips/Jinlong`, loose files in `clips/`, and scripts under clips from
the copy, leaving the source build intact. `--output-dir PATH` overrides the
destination. Pages output defaults to `.pages-dist/org-prod` or
`.pages-dist/org-beta`.
Build and Pages destinations inside the checkout are limited to dedicated
subdirectories of `dist/` and `.pages-dist/`. External destinations must be
empty or contain a previous artifact marker; source directories and symlink
escapes are rejected before a directory can be emptied.

Transfer and extract an archive on a publishing host, then use:

```sh
pnpm run publish --target org --channel beta --dist-dir /path/to/extracted/dist
```

When Node is unavailable, the low-level server-only transport remains:
`bash scripts/deploy-cn-server.sh --skip-build --server-only --dist-dir PATH`.
It validates ZIP/root entrypoint structure but bypasses the unified receipt
check; prefer the unified command.

## Configuration and logs

| Target | Production | Beta |
| --- | --- | --- |
| CN | OSS + atlos-cn server | OSS resource/offline build only |
| ORG Pages | oem-root, main, opendfieldmap.org | oem-root-uatenv, beta, beta.opendfieldmap.org |

Pages values live in `scripts/pages-config.mjs`. Storage prefixes reuse
`web.build.deployChannels.{prod,beta}.{ossPrefix,r2Prefix}`. Existing
`DEPLOY_PREFIX`, `DEPLOY_PROD_PREFIX` and `DEPLOY_BETA_PREFIX` overrides
remain; command channels override `DEPLOY_CHANNEL`.
Set `PUBLISH_VERBOSE_SKIPS=1` for per-file skip logs. Existing retention,
clip reconciliation, `SEO_UPLOAD_POINT_ALIASES` and OG verification behavior
remain in the upload scripts.

Server overrides remain `ATLOS_CN_SSH_HOST` and `ATLOS_CN_REMOTE_DIR`.
The default remote path is `workspace/atlos-assets/_WORK_DIR/Atlos/talos`.
Keep SSH keys in local SSH configuration. The remote account needs write access,
Bash and unzip. Existing Pages custom domains, redirects and Access settings
are managed in Cloudflare.

After publishing, inspect the main site, Intel, user hub, one point-share page,
referenced assets and cache headers on the intended production/beta domain.

## Command migration

| Previous commands | Replacement |
| --- | --- |
| build:r2 / build:r2:beta / build:all | build --target org [--channel beta] / build --target all |
| build:intel[:r2] / build:user-hub[:r2] | build --app intel\|user-hub --target cn\|org |
| publish:web[:r2] / deploy:cn:server | run publish --target cn\|org [--only …] / deploy:cn |
| publish:web:r2:resources:beta | run publish --target org --channel beta --only resources |
| package:pages:org:* / publish:pages:org:* | package --target org --format pages / run publish --target org --only pages |
| release:package:* | package --target cn\|org --channel prod\|beta |
| build:seo:og:* / publish:seo:og:* | og --target … [--action build\|publish\|refresh] |
| build:prepare / individual generators and validators | data prepare / data <task> |
| type-check:* / test:user-hub | type-check --app … / test --app user-hub |
| Worker aliases / build --deploy | worker search\|relink check\|deploy |

The five old build/deploy orchestrators are removed. Individual generators and
transport implementations remain directly callable for focused maintenance.
