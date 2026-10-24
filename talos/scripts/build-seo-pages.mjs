import path from 'node:path';
import fs from 'node:fs/promises';
import { enqueueSeoOgPublishChanges } from './seo-og-publish-queue.js';
import {
  configureSharpFonts, buildOgWorklist, generateOgImagesInParallel, buildOgSignature,
  buildFallbackOgSignature, generateOgImage, generateFallbackOgImage,
} from './seo/og.mjs';
import {
  collectFingerprints, loadBuildState, removeLegacyFlatPointFiles, mergeScopedBuildState,
  writeBuildState, pruneStaleFiles,
} from './seo/state.mjs';
import {
  MAP_PATTERN_FILE, OBSERVATOR_LOGO_FILE, HARMONY_FONT_FILE, HARMONY_SC_FONT_FILE,
  HARMONY_TC_FONT_FILE, UDSHINGO_HK_DB_FONT_FILE, COINBASE_DISPLAY_FONT_FILE,
  COINBASE_DISPLAY_BOLD_FONT_FILE, ZILLA_SLAB_HIGHLIGHT_FONT_FILE, NOVECENTO_SLAB_BOLD_FONT_FILE,
  SEO_PAGE_STATE_FILE, SEO_OG_STATE_FILE, shouldBuildPreviewOnly, buildTarget, defaultLocale,
  siteUrl, ROOT, workerPreviewFile, shouldBuildImagesOnly, SEO_OUT_DIR, SEO_POINTS_OUT_DIR,
  shouldBuildPointImages, seoOgOutputDir, shouldRefreshOgStateOnly, SEO_STATE_VERSION,
  FILE_FINGERPRINT_VERSION, OG_RENDER_SIGNATURE_VERSION, shouldWritePointFiles,
  shouldForcePointFiles, shouldForceImages, shouldForceAllImages, SITEMAP_LIMIT, PUBLIC_OUT_DIR,
  shouldWriteWorkerPreview,
} from './seo/config.mjs';
import { loadPoints } from './seo/content.mjs';
import {
  writePreviewFile, buildHtmlSignature, buildPointHtml, buildSitemap, buildSitemapIndex,
  buildRobots,
} from './seo/documents.mjs';
import { pathExists } from './seo/io.mjs';

async function build() {
  await configureSharpFonts();
  const sharedOgFingerprints = await collectFingerprints([
    MAP_PATTERN_FILE,
    OBSERVATOR_LOGO_FILE,
    HARMONY_FONT_FILE,
    HARMONY_SC_FONT_FILE,
    HARMONY_TC_FONT_FILE,
    UDSHINGO_HK_DB_FONT_FILE,
    COINBASE_DISPLAY_FONT_FILE,
    COINBASE_DISPLAY_BOLD_FONT_FILE,
    ZILLA_SLAB_HIGHLIGHT_FONT_FILE,
    NOVECENTO_SLAB_BOLD_FONT_FILE,
  ]);
  const previousPageState = await loadBuildState(SEO_PAGE_STATE_FILE);
  const previousOgState = await loadBuildState(SEO_OG_STATE_FILE);

  const { markers, allMarkerTokens } = await loadPoints();

  if (shouldBuildPreviewOnly) {
    await writePreviewFile(markers);
    console.log(`[seo] target=${buildTarget} locale=${defaultLocale} site=${siteUrl}`);
    console.log(`[seo] wrote point previews=${markers.length} to ${path.relative(ROOT, workerPreviewFile)}`);
    return;
  }

  if (!shouldBuildImagesOnly) {
    await fs.mkdir(SEO_OUT_DIR, { recursive: true });
    await removeLegacyFlatPointFiles();
    await fs.mkdir(SEO_POINTS_OUT_DIR, { recursive: true });
  }
  if (shouldBuildPointImages) {
    await fs.mkdir(seoOgOutputDir, { recursive: true });
  }

  if (shouldBuildImagesOnly) {
    const { worklist, nextState: scopedNextState } = await buildOgWorklist(markers, sharedOgFingerprints, previousOgState);
    const nextState = mergeScopedBuildState(previousOgState, scopedNextState, allMarkerTokens);
    const activeTokens = allMarkerTokens;
    const staleTokens = Object.keys(previousOgState.entries ?? {})
      .filter((token) => !activeTokens.has(token));
    if (shouldRefreshOgStateOnly) {
      const outputChecks = await Promise.all(markers.map(async (point) => ({
        token: point.token,
        exists: await pathExists(point.ogImagePath),
      })));
      const missingOutputs = outputChecks.filter(({ exists }) => !exists);
      if (missingOutputs.length > 0) {
        throw new Error(`Cannot refresh OG state: ${missingOutputs.length} image outputs are missing.`);
      }
      await enqueueSeoOgPublishChanges(seoOgOutputDir, { deleteTokens: staleTokens });
      await writeBuildState(SEO_OG_STATE_FILE, nextState);
      await pruneStaleFiles(seoOgOutputDir, '.jpg', activeTokens, new Set(Object.keys(previousOgState.entries ?? {})));
      console.log(`[seo] target=${buildTarget} locale=${defaultLocale} site=${siteUrl}`);
      console.log(`[seo] refreshed point image state=${markers.length}, output=${path.relative(ROOT, seoOgOutputDir)}`);
      return;
    }

    const checkpointState = {
      version: SEO_STATE_VERSION,
      fingerprintVersion: FILE_FINGERPRINT_VERSION,
      renderVersion: OG_RENDER_SIGNATURE_VERSION,
      entries: { ...previousOgState.entries },
    };
    let checkpointWrite = Promise.resolve();
    const pendingUploadTokens = [];
    await generateOgImagesInParallel(worklist, (point, completed) => {
      checkpointState.entries[point.token] = nextState.entries[point.token];
      pendingUploadTokens.push(point.token);
      if (completed % 250 !== 0) return undefined;

      const snapshot = {
        ...checkpointState,
        entries: { ...checkpointState.entries },
      };
      const checkpointTokens = pendingUploadTokens.splice(0);
      checkpointWrite = checkpointWrite.then(async () => {
        await enqueueSeoOgPublishChanges(seoOgOutputDir, { uploadTokens: checkpointTokens });
        await writeBuildState(SEO_OG_STATE_FILE, snapshot);
      });
      return checkpointWrite;
    });
    await checkpointWrite;
    await enqueueSeoOgPublishChanges(seoOgOutputDir, {
      uploadTokens: pendingUploadTokens,
      deleteTokens: staleTokens,
    });
    await writeBuildState(SEO_OG_STATE_FILE, nextState);
    await pruneStaleFiles(seoOgOutputDir, '.jpg', activeTokens, new Set(Object.keys(previousOgState.entries ?? {})));
    console.log(`[seo] target=${buildTarget} locale=${defaultLocale} site=${siteUrl}`);
    console.log(`[seo] generated point images=${worklist.length}/${markers.length}, output=${path.relative(ROOT, seoOgOutputDir)}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const sitemapItems = [];
  const nextPageState = { version: SEO_STATE_VERSION, entries: {} };
  const nextOgState = {
    version: SEO_STATE_VERSION,
    fingerprintVersion: FILE_FINGERPRINT_VERSION,
    renderVersion: OG_RENDER_SIGNATURE_VERSION,
    entries: {},
  };
  const generatedOgTokens = [];
  for (let index = 0; index < markers.length; index += 1) {
    const point = markers[index];
    if (shouldWritePointFiles) {
      const htmlSignature = await buildHtmlSignature(point);
      nextPageState.entries[point.token] = { signature: htmlSignature };
      const pageStateSignature = previousPageState.entries?.[point.token]?.signature;
      if (shouldForcePointFiles || pageStateSignature !== htmlSignature || !(await pathExists(point.htmlPath))) {
        await fs.writeFile(point.htmlPath, buildPointHtml(point));
      }
      if (shouldBuildPointImages || shouldForceImages || shouldForceAllImages) {
        const ogSignature = shouldBuildPointImages
          ? await buildOgSignature(point, sharedOgFingerprints)
          : await buildFallbackOgSignature(point, sharedOgFingerprints);
        nextOgState.entries[point.token] = { signature: ogSignature };
        const previousSignature = previousOgState.entries?.[point.token]?.signature;
        if (
          shouldForceImages
          || shouldForceAllImages
          || previousSignature !== ogSignature
          || !(await pathExists(point.ogImagePath))
        ) {
          if (shouldBuildPointImages) {
            await generateOgImage(point);
          } else {
            await generateFallbackOgImage(point);
          }
          generatedOgTokens.push(point.token);
        }
      }
    }
    if (point.indexable) {
      sitemapItems.push({
        loc: point.canonicalUrl,
        image: point.ogImageUrl,
        title: point.title,
        lastmod: today,
      });
    }
    if ((index + 1) % 250 === 0) {
      console.log(`[seo] generated ${index + 1}/${markers.length} point pages`);
    }
  }

  if (shouldWritePointFiles) {
    const pageState = mergeScopedBuildState(previousPageState, nextPageState, allMarkerTokens);
    await writeBuildState(SEO_PAGE_STATE_FILE, pageState);
    await pruneStaleFiles(SEO_POINTS_OUT_DIR, '.html', allMarkerTokens, new Set(Object.keys(previousPageState.entries ?? {})));
  }
  if (shouldBuildPointImages || shouldForceImages || shouldForceAllImages) {
    const activeTokens = allMarkerTokens;
    const staleTokens = Object.keys(previousOgState.entries ?? {})
      .filter((token) => !activeTokens.has(token));
    await enqueueSeoOgPublishChanges(seoOgOutputDir, {
      uploadTokens: generatedOgTokens,
      deleteTokens: staleTokens,
    });
    const ogState = mergeScopedBuildState(previousOgState, nextOgState, activeTokens);
    await writeBuildState(SEO_OG_STATE_FILE, ogState);
    await pruneStaleFiles(seoOgOutputDir, '.jpg', activeTokens, new Set(Object.keys(previousOgState.entries ?? {})));
  }

  const sitemapFiles = [];
  for (let i = 0; i < sitemapItems.length; i += SITEMAP_LIMIT) {
    const chunk = sitemapItems.slice(i, i + SITEMAP_LIMIT);
    const fileName = `sitemap-points-${Math.floor(i / SITEMAP_LIMIT) + 1}.xml`;
    sitemapFiles.push(fileName);
    await fs.writeFile(path.resolve(PUBLIC_OUT_DIR, fileName), buildSitemap(chunk));
  }
  await fs.writeFile(path.resolve(PUBLIC_OUT_DIR, 'sitemap.xml'), buildSitemapIndex(sitemapFiles));
  await fs.writeFile(path.resolve(PUBLIC_OUT_DIR, 'robots.txt'), buildRobots());

  if (shouldWriteWorkerPreview) {
    await writePreviewFile(markers);
  }

  console.log(`[seo] target=${buildTarget} locale=${defaultLocale} site=${siteUrl}`);
  console.log(`[seo] generated point pages=${markers.length}, sitemap urls=${sitemapItems.length}, sitemap files=${sitemapFiles.length}`);
  if (shouldWriteWorkerPreview) {
    console.log(`[seo] wrote ${path.relative(ROOT, workerPreviewFile)}`);
  }
}

build().catch((err) => {
  console.error('[seo] build failed');
  console.error(err);
  process.exitCode = 1;
});
