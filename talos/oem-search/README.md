# oem-search (Cloudflare Worker)

Cloudflare Worker service for OEM map search.

Search behavior:

- Case-insensitive for both simple keyword search and advanced grouped search.
- Locale-aware index loading (`locale` query param), with frontend fallback to `en-US` for UI-only locales.

## Endpoints

- `GET /health`
- `GET /search?q=<keyword>&limit=<n>&locale=<locale>`

Response payload:

```json
{
  "hits": [
    {
      "pointId": "...",
      "typeKey": "...",
      "typeMain": "...",
      "regionKey": "...",
      "subregionId": "...",
      "body": "...",
      "score": 12.3
    }
  ]
}
```

## Setup

1. Install dependencies

```bash
cd oem-search
pnpm install
```

Before deploying Worker, prebuild docs index in the web app project root:

```bash
cd ..
pnpm build:search-index
```

If files text should be fetched from R2 during index build:

```bash
OEM_SEARCH_R2_BASE="https://<your-cdn-base>" pnpm build:search-index
```

2. Configure `wrangler.toml`

- `INDEX_DOCS_URL`: public URL template to prebuilt locale docs (recommended: `/search/docs/{locale}.json` uploaded to CDN).
- Legacy compatibility: if `INDEX_DOCS_URL` points to a single `.json` file, worker will run single-index mode.
- `ALLOW_ORIGIN`: allowed CORS origin (or `*`).

3. Local dev

```bash
pnpm dev
```

Run type checks before deploy:

```bash
pnpm type-check
```

4. Deploy

```bash
pnpm deploy
```

## Frontend integration

In your web app environment:

```bash
VITE_SEARCH_ENDPOINT=https://<your-worker-domain>/search
```

If this variable is set, the frontend search hook will call Worker first and fallback to local Orama search when Worker fails.
