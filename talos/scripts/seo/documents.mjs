import fs from 'node:fs/promises';
import path from 'node:path';
import { hashSignature } from './state.mjs';
import {
  SEO_STATE_VERSION, buildTarget, defaultLocale, langKey, htmlLang, IMAGE_WIDTH, IMAGE_HEIGHT,
  SITE_NAME, siteUrl, DEEP_LINK_QUERY_PARAMS, workerPreviewFile, workerPreviewFormat,
} from './config.mjs';
import { html, xml } from './text.mjs';

export async function buildHtmlSignature(point) {
  return hashSignature({
    version: SEO_STATE_VERSION,
    kind: 'html',
    target: buildTarget,
    locale: defaultLocale,
    langKey,
    htmlLang,
    title: point.documentTitle,
    description: point.description,
    canonicalUrl: point.canonicalUrl,
    ogImageUrl: point.ogImageUrl,
    spaUrl: point.spaUrl,
  });
}

export function buildPointHtml(point) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: point.documentTitle,
    description: point.description,
    url: point.canonicalUrl,
    image: {
      '@type': 'ImageObject',
      url: point.ogImageUrl,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: SITE_NAME,
      url: siteUrl,
    },
  };
  const serializedSpaUrl = JSON.stringify(point.spaUrl).replace(/</g, '\\u003c');
  const forwardDeepLinkScript = `<script>
    (() => {
      const target = new URL(${serializedSpaUrl});
      const source = new URLSearchParams(window.location.search);
      for (const key of ${JSON.stringify(DEEP_LINK_QUERY_PARAMS)}) {
        const values = source.getAll(key);
        if (values.length === 0) continue;
        target.searchParams.delete(key);
        values.forEach((value) => target.searchParams.append(key, value));
      }
      window.location.replace(target.toString());
    })();
  </script>`;
  return `<!doctype html>
<html lang="${html(htmlLang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${html(point.documentTitle)}</title>
  <meta name="description" content="${html(point.description)}" />
  <link rel="canonical" href="${html(point.canonicalUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${html(point.documentTitle)}" />
  <meta property="og:description" content="${html(point.description)}" />
  <meta property="og:url" content="${html(point.canonicalUrl)}" />
  <meta property="og:image" content="${html(point.ogImageUrl)}" />
  <meta property="og:image:width" content="${IMAGE_WIDTH}" />
  <meta property="og:image:height" content="${IMAGE_HEIGHT}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${html(point.documentTitle)}" />
  <meta name="twitter:description" content="${html(point.description)}" />
  <meta name="twitter:image" content="${html(point.ogImageUrl)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  ${forwardDeepLinkScript}
  <meta http-equiv="refresh" content="0;url=${html(point.spaUrl)}" />
  <style>
    html, body { background: #fff; color: #fff; margin: 0; }
    body { min-height: 100vh; }
    a { display: block; width: 1px; height: 1px; overflow: hidden; opacity: 0; position: absolute; left: -9999px; top: 0; }
  </style>
</head>
<body>
  <a href="${html(point.spaUrl)}"></a>
</body>
</html>`;
}

export function buildSitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((item) => `  <url>
    <loc>${xml(item.loc)}</loc>
    <lastmod>${item.lastmod}</lastmod>
    <image:image>
      <image:loc>${xml(item.image)}</image:loc>
      <image:title>${xml(item.title)}</image:title>
    </image:image>
  </url>`).join('\n')}
</urlset>
`;
}

export function buildSitemapIndex(files) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((file) => `  <sitemap><loc>${xml(`${siteUrl}/${file}`)}</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
}

export function buildRobots() {
  return `User-agent: *
Allow: /

Sitemap: ${siteUrl}/sitemap.xml
`;
}

function previewData(points) {
  return Object.fromEntries(points.map((point) => [point.token, {
    title: point.documentTitle,
    description: point.description,
  }]));
}

function previewTs(points) {
  const mapObject = previewData(points);
  return `export type SeoPointPreview = {
  title: string;
  description: string;
};

export const SEO_POINT_PREVIEWS: Record<string, SeoPointPreview> = ${JSON.stringify(mapObject, null, 2)} as const;
`;
}

export async function writePreviewFile(points) {
  await fs.mkdir(path.dirname(workerPreviewFile), { recursive: true });
  if (workerPreviewFormat === 'json') {
    await fs.writeFile(workerPreviewFile, `${JSON.stringify(previewData(points), null, 2)}\n`);
    return;
  }
  await fs.writeFile(workerPreviewFile, previewTs(points));
}
