# Release runbook

Run commands from `talos/`. Configure both ignored files under `config/`
using their templates. Local publishing needs existing OSS/R2 credentials,
Cloudflare authentication, and the `atlos-cn` SSH alias for the server.

## Normal release

```sh
pnpm check
pnpm deploy:all
pnpm deploy:all --skip-og
pnpm deploy:cn
pnpm deploy:org
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
point pages, robots and sitemap. Wrong-channel, incomplete, partial-build and
source-only CI artifacts are rejected. Builds without a receipt need a fresh
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

## OG images and Workers

```sh
pnpm og                                      # Generate both targets
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
