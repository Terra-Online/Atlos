# Local Release Runbook (Dual-Server)

This runbook follows the current constraints:
- Local machine builds and packages artifacts only.
- Remote servers publish.
- SG server publishes `org` (R2), Aliyun server publishes `cn` (OSS).

## 1) Prepare Configs

Copy templates if needed:

```bash
cp config/config.template.json config/config.json
cp config/config.r2.template.json config/config.r2.json
```

Optional channel prefixes (recommended):
- `config/config.json` -> `web.build.deployChannels.beta.ossPrefix`, `web.build.deployChannels.prod.ossPrefix`
- `config/config.r2.json` -> `web.build.deployChannels.beta.r2Prefix`, `web.build.deployChannels.prod.r2Prefix`

If channel mappings are missing, scripts fallback to:
- `prod`: use base prefix from `oss.prefix` / `r2.prefix`
- `beta`: derive from base prefix (`_dev -> _beta`, or append `-beta`)

## 2) Package Artifacts Locally

CN beta package:

```bash
pnpm release:package:cn:beta
```

ORG beta package:

```bash
pnpm release:package:org:beta
```

CN prod package:

```bash
pnpm release:package:cn:prod
```

ORG prod package:

```bash
pnpm release:package:org:prod
```

Artifacts are generated in `release-artifacts/`:
- `dist-<target>-<channel>-<timestamp>-<sha>.zip`
- `*.sha256`
- `*.json` (metadata)

Packaging prune rules applied automatically:
- Remove `dist/clips/Jinlong`
- Remove script files under `dist/clips` (`.py/.sh/.js/.mjs/.ts/.bash/.zsh`)

## 3) Transfer and Publish on SG (org / R2)

Transfer package (example):

```bash
scp -i "<your-key>.pem" release-artifacts/dist-org-beta-*.zip \
  ubuntu@<sg-host>:/home/ubuntu/Public/Receptions/dist.zip
```

Remote publish:

```bash
ssh -i "<your-key>.pem" ubuntu@<sg-host>
cd Public/Receptions
rm -rf dist && unzip dist.zip && rm dist.zip
cd <talos-repo-dir>
DEPLOY_CHANNEL=beta node ./scripts/publish-R2.js
```

For prod:

```bash
DEPLOY_CHANNEL=prod node ./scripts/publish-R2.js
```

## 4) Transfer and Publish on Aliyun (cn / OSS)

Upload package to Aliyun machine as `dist.zip` (FileZilla or SCP), then:

```bash
ssh <deploy-user>@<aliyun-host>
cd <talos-repo-dir>
rm -rf dist && unzip dist.zip && rm dist.zip
DEPLOY_CHANNEL=beta pnpm publish:web
```

For prod:

```bash
DEPLOY_CHANNEL=prod pnpm publish:web
```

## 5) Verification Checklist

After each publish, verify:
- Beta domains:
  - `beta.opendfieldmap.org`
  - `beta.opendfieldmap.cn`
- Production domains:
  - `opendfieldmap.org`
  - `opendfieldmap.cn`
- Key files: `index.html`, main JS asset, `manifest.json`, search docs
- Cache headers behavior (html no-store, assets immutable)

## 6) Notes

- Channel switching is controlled by `DEPLOY_CHANNEL=beta|prod`.
- Optional env overrides are supported for one-off publishing:
  - `DEPLOY_PREFIX`
  - `DEPLOY_BETA_PREFIX`
  - `DEPLOY_PROD_PREFIX`
- Keep credentials only on remote publishing machines.
