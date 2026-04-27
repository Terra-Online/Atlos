# talos

Copy `config/config.template.json` and `config/config.r2.template.json` to `config/config.json` and `config/config.r2.json` and configure your settings. By doing this you can build this project in your local env.

Generally you need `config.json` only, to enable local build. R2 version is used for CloudFlare CDN.


### dev

```shell
    pnpm dev
```

### build (R2)

```shell
pnpm build:r2
```

Skip font subsetting:

```shell
pnpm build:r2 --skip-subset
```

Include worker deploy during build prepare:

```shell
pnpm build:r2 --deploy
```

For standard web build, you can also skip font subsetting:

```shell
pnpm build --skip-subset
```

# note
Due to legal restrictions and file size limitations, we do not upload/pre-host any map tile data used for cartographic display in this repository. If you actually need clips for local preview, contact cirisus with `cirisus@outlook.com`.