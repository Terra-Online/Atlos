import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { getDeployChannel, resolveDeployPrefix, joinCdnPath } from '../release-channel.js';
import fsSync from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '../..');
export const MARKER_TYPE_FILE = path.resolve(ROOT, 'src/data/marker/type.json');
export const REGION_FILE = path.resolve(ROOT, 'src/data/map/region.json');
const R2_CONFIG_FILE = path.resolve(ROOT, 'config/config.r2.json');
export const LABEL_FILE = path.resolve(ROOT, 'src/data/map/label/labels.json');
export const LOCALE_DIR = path.resolve(ROOT, 'src/locale/data/game');
export const REGION_LOCALE_DIR = path.resolve(ROOT, 'src/locale/data/region');
export const FILES_TEXT_DIR = path.resolve(ROOT, 'public/files/text');
export const CLIPS_DIR = path.resolve(ROOT, 'public/clips');
export const ITEM_DIR = path.resolve(ROOT, 'src/assets/images/item');
export const MARKER_ICON_DIR = path.resolve(ROOT, 'src/assets/images/marker');
export const MAP_PATTERN_FILE = path.resolve(ROOT, 'src/assets/images/UI/map-pattern.svg');
export const OBSERVATOR_LOGO_FILE = path.resolve(ROOT, 'src/assets/images/UI/observator_6.webp');
const FONT_DIR = path.resolve(ROOT, 'src/assets/fonts');
export const HARMONY_FONT_DIR = path.resolve(FONT_DIR, 'Harmony');
export const LOCAL_FONT_DIR = path.resolve(os.homedir(), 'Library/Fonts');
export const HARMONY_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/Harmony/HMSans.ttf');
// OG uses local originals; web builds no longer emit source-format CJK subsets.
export const HARMONY_SC_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts_original/Harmony/HMSans_SC.ttf');
export const HARMONY_TC_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts_original/Harmony/HMSans_TC.ttf');
export const UDSHINGO_HK_DB_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts_original/UD_ShinGo/UDShinGo_HK_DB.ttf');
export const COINBASE_DISPLAY_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Coinbase_Display-Regular-web-1.32.ttf');
export const COINBASE_DISPLAY_BOLD_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Coinbase_Display-Bold-web-1.32.ttf');
export const ZILLA_SLAB_HIGHLIGHT_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'ZillaSlabHighlight-Bold.ttf');
export const NOVECENTO_SLAB_BOLD_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Novecento Slab Bold.otf');
export const PUBLIC_OUT_DIR = process.env.SEO_PUBLIC_OUT_DIR
  ? path.resolve(ROOT, process.env.SEO_PUBLIC_OUT_DIR)
  : path.resolve(ROOT, 'public');
export const SEO_OUT_DIR = path.resolve(PUBLIC_OUT_DIR, 'seo');
export const SEO_POINTS_ROOT_DIR = path.resolve(SEO_OUT_DIR, 'points');
const SEO_OG_OUT_DIR = path.resolve(SEO_OUT_DIR, 'og');
const DEFAULT_WORKER_PREVIEW_FILE = path.resolve(ROOT, 'oem-relink/src/seo-preview.generated.ts');
const OSS_CONFIG_FILE = path.resolve(ROOT, 'config/config.json');
export const POINT_SHARE_SHORT_ORIGIN = 'https://oem.re';
export const SITE_NAME = 'Open Endfield Map';
export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;
export const WORK_IMAGE_WIDTH = 1200;
export const WORK_IMAGE_HEIGHT = 800;
export const WORK_IMAGE_CROP_TOP = Math.round((WORK_IMAGE_HEIGHT - IMAGE_HEIGHT) / 2);
const OG_SAMPLE_SCALE = 1.25;
export const SAMPLE_IMAGE_WIDTH = Math.round(WORK_IMAGE_WIDTH * OG_SAMPLE_SCALE);
export const SAMPLE_IMAGE_HEIGHT = Math.round(WORK_IMAGE_HEIGHT * OG_SAMPLE_SCALE);
export const SAMPLE_TO_WORK_SCALE = WORK_IMAGE_WIDTH / SAMPLE_IMAGE_WIDTH;
export const LEAFLET_TILE_SIZE = 200;
export const TILE_IMAGE_SIZE = 500;
export const MARKER_RENDER_SCALE = 2.5;
export const SITEMAP_LIMIT = 45000;
export const POINT_HTML_FILE_PATTERN = /^[0-9a-zA-Z]{7}\.html$/;
export const DEEP_LINK_QUERY_PARAMS = ['imageId', 'commentId'];
export const INDEXABLE_MAIN_CATEGORIES = new Set(['files']);
export const INDEXABLE_SUB_CATEGORIES = new Set(['archives', 'boss', 'valuable', 'facility']);
export const buildTarget = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
export const SEO_POINTS_OUT_DIR = path.resolve(SEO_POINTS_ROOT_DIR, buildTarget);
const deployChannel = getDeployChannel();
const defaultSiteUrl = buildTarget === 'r2'
  ? deployChannel === 'beta'
    ? 'https://beta.opendfieldmap.org'
    : 'https://opendfieldmap.org'
  : deployChannel === 'beta'
    ? 'https://beta.opendfieldmap.cn'
    : 'https://opendfieldmap.cn';
export const siteUrl = (process.env.SEO_SITE_URL || defaultSiteUrl).replace(/\/$/, '');
export const defaultLocale = process.env.SEO_LOCALE || (buildTarget === 'r2' ? 'en-US' : 'zh-CN');
export const langKey = defaultLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
export const htmlLang = defaultLocale.replace('_', '-');
export const seoLimit = Number.parseInt(process.env.SEO_LIMIT || '', 10);
export const seoTokens = (process.env.SEO_TOKENS || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);
const shouldGenerateImages = process.env.SEO_SKIP_IMAGES !== '1';
export const shouldForceImages = process.env.SEO_FORCE_IMAGES === '1';
export const shouldForceAllImages = process.env.SEO_FORCE_ALL_IMAGES === '1';
export const shouldRefreshOgStateOnly = process.env.SEO_OG_REFRESH_STATE_ONLY === '1';
const shouldSkipPointFiles = process.env.SEO_SKIP_POINT_FILES === '1';
export const shouldBuildImagesOnly = process.env.SEO_IMAGE_ONLY === '1';
export const useLegacyOgPipeline = process.env.SEO_OG_PIPELINE === 'legacy';
export const shouldBuildPreviewOnly = process.env.SEO_PREVIEW_ONLY === '1';
export const shouldWriteWorkerPreview = shouldBuildPreviewOnly || process.env.SEO_WRITE_WORKER_PREVIEW === '1';
export const workerPreviewFile = process.env.SEO_PREVIEW_OUTPUT_FILE
  ? path.resolve(ROOT, process.env.SEO_PREVIEW_OUTPUT_FILE)
  : DEFAULT_WORKER_PREVIEW_FILE;
export const workerPreviewFormat = process.env.SEO_PREVIEW_FORMAT === 'json' ? 'json' : 'ts';
export const hasExplicitPointScope = seoTokens.length > 0 || (Number.isFinite(seoLimit) && seoLimit > 0);
const shouldWriteAllPointFiles = process.env.SEO_WRITE_ALL_POINT_FILES === '1' || shouldForceAllImages;
export const shouldForcePointFiles = process.env.SEO_FORCE_POINT_FILES === '1';
export const shouldWritePointFiles = !shouldBuildImagesOnly && !shouldBuildPreviewOnly && !shouldSkipPointFiles && (hasExplicitPointScope || shouldWriteAllPointFiles);
export const shouldBuildPointImages = shouldGenerateImages && (shouldBuildImagesOnly || hasExplicitPointScope || shouldForceImages || shouldForceAllImages);
export const seoOgOutputDir = process.env.SEO_OG_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.SEO_OG_OUTPUT_DIR)
  : path.resolve(SEO_OG_OUT_DIR, buildTarget);
const SEO_CACHE_DIR = path.resolve(ROOT, '.cache/seo');
export const SEO_PAGE_STATE_FILE = path.resolve(SEO_CACHE_DIR, `pages-${buildTarget}-${defaultLocale}.json`);
export const SEO_OG_STATE_FILE = path.resolve(SEO_CACHE_DIR, `og-${buildTarget}-${defaultLocale}.json`);
const requestedSeoOgConcurrency = Number.parseInt(process.env.SEO_OG_CONCURRENCY || '', 10);
const defaultSeoOgConcurrency = 16;
export const seoOgConcurrency = Number.isFinite(requestedSeoOgConcurrency) && requestedSeoOgConcurrency > 0
  ? requestedSeoOgConcurrency
  : defaultSeoOgConcurrency;
const requestedSharpConcurrency = Number.parseInt(process.env.SEO_SHARP_CONCURRENCY || '', 10);
const defaultSharpConcurrency = 1;
export const sharpConcurrency = Number.isFinite(requestedSharpConcurrency) && requestedSharpConcurrency > 0
  ? requestedSharpConcurrency
  : defaultSharpConcurrency;
export const useMarkerRasterCache = process.env.SEO_MARKER_RASTER_CACHE !== '0';
export const SEO_STATE_VERSION = 1;
export const OG_RENDER_SIGNATURE_VERSION = 6;
export const OG_RENDER_RECIPE = 'dim-main-overlay-target-layer-labels-last-lossless-raw-badge-topmost';
export const FILE_FINGERPRINT_VERSION = 2;

function readJsonSync(file) {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function resolveDefaultOgUrlBase() {
  const config = readJsonSync(buildTarget === 'r2' ? R2_CONFIG_FILE : OSS_CONFIG_FILE);
  const buildConfig = config?.web?.build ?? {};
  const cdn = buildConfig.cdn;
  if (!cdn) return `${siteUrl}/seo/og/${buildTarget}`;

  const storage = buildTarget === 'r2'
    ? buildConfig.r2 ?? {}
    : buildConfig.oss ?? {};
  const { prefix } = resolveDeployPrefix({
    basePrefix: storage.prefix,
    channel: deployChannel,
    target: buildTarget,
    deployChannels: buildConfig.deployChannels,
  });
  return `${joinCdnPath(cdn, prefix)}/seo/og/${buildTarget}`;
}

export const seoOgUrlBase = (process.env.SEO_OG_URL_BASE || resolveDefaultOgUrlBase()).replace(/\/$/, '');
