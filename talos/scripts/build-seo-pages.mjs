import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  getDeployChannel,
  joinCdnPath,
  resolveDeployPrefix,
} from './release-channel.js';
import { enqueueSeoOgPublishChanges } from './seo-og-publish-queue.js';
import { loadEffectiveMarkers } from './marker-data.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const MARKER_TYPE_FILE = path.resolve(ROOT, 'src/data/marker/type.json');
const REGION_FILE = path.resolve(ROOT, 'src/data/map/region.json');
const R2_CONFIG_FILE = path.resolve(ROOT, 'config/config.r2.json');
const LABEL_FILE = path.resolve(ROOT, 'src/data/map/label/labels.json');
const LOCALE_DIR = path.resolve(ROOT, 'src/locale/data/game');
const REGION_LOCALE_DIR = path.resolve(ROOT, 'src/locale/data/region');
const FILES_TEXT_DIR = path.resolve(ROOT, 'public/files/text');
const CLIPS_DIR = path.resolve(ROOT, 'public/clips');
const ITEM_DIR = path.resolve(ROOT, 'src/assets/images/item');
const MARKER_ICON_DIR = path.resolve(ROOT, 'src/assets/images/marker');
const MAP_PATTERN_FILE = path.resolve(ROOT, 'src/assets/images/UI/map-pattern.svg');
const OBSERVATOR_LOGO_FILE = path.resolve(ROOT, 'src/assets/images/UI/observator_6.webp');
const FONT_DIR = path.resolve(ROOT, 'src/assets/fonts');
const HARMONY_FONT_DIR = path.resolve(FONT_DIR, 'Harmony');
const LOCAL_FONT_DIR = path.resolve(os.homedir(), 'Library/Fonts');
const HARMONY_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/Harmony/HMSans.ttf');
const HARMONY_SC_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/Harmony/HMSans_SC.ttf');
const HARMONY_TC_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/Harmony/HMSans_TC.ttf');
const THAI_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/Harmony/HMSans.ttf');
const UDSHINGO_HK_DB_FONT_FILE = path.resolve(ROOT, 'src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.ttf');
const COINBASE_DISPLAY_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Coinbase_Display-Regular-web-1.32.ttf');
const COINBASE_DISPLAY_BOLD_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Coinbase_Display-Bold-web-1.32.ttf');
const ZILLA_SLAB_HIGHLIGHT_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'ZillaSlabHighlight-Bold.ttf');
const NOVECENTO_SLAB_BOLD_FONT_FILE = path.resolve(LOCAL_FONT_DIR, 'Novecento Slab Bold.otf');
const PUBLIC_OUT_DIR = process.env.SEO_PUBLIC_OUT_DIR
  ? path.resolve(ROOT, process.env.SEO_PUBLIC_OUT_DIR)
  : path.resolve(ROOT, 'public');
const LEGACY_POINTS_OUT_DIR = path.resolve(PUBLIC_OUT_DIR, 'points');
const SEO_OUT_DIR = path.resolve(PUBLIC_OUT_DIR, 'seo');
const SEO_POINTS_ROOT_DIR = path.resolve(SEO_OUT_DIR, 'points');
const SEO_OG_OUT_DIR = path.resolve(SEO_OUT_DIR, 'og');
const DEFAULT_WORKER_PREVIEW_FILE = path.resolve(ROOT, 'oem-relink/src/seo-preview.generated.ts');
const OSS_CONFIG_FILE = path.resolve(ROOT, 'config/config.json');

const POINT_SHARE_SHORT_ORIGIN = 'https://oem.re';
const SITE_NAME = 'Open Endfield Map';
const IMAGE_WIDTH = 1200;
const IMAGE_HEIGHT = 630;
const WORK_IMAGE_WIDTH = 1200;
const WORK_IMAGE_HEIGHT = 800;
const WORK_IMAGE_CROP_TOP = Math.round((WORK_IMAGE_HEIGHT - IMAGE_HEIGHT) / 2);
const OG_SAMPLE_SCALE = 1.25;
const SAMPLE_IMAGE_WIDTH = Math.round(WORK_IMAGE_WIDTH * OG_SAMPLE_SCALE);
const SAMPLE_IMAGE_HEIGHT = Math.round(WORK_IMAGE_HEIGHT * OG_SAMPLE_SCALE);
const SAMPLE_TO_WORK_SCALE = WORK_IMAGE_WIDTH / SAMPLE_IMAGE_WIDTH;
const LEAFLET_TILE_SIZE = 200;
const TILE_IMAGE_SIZE = 500;
const MARKER_RENDER_SCALE = 2.5;
const SITEMAP_LIMIT = 45000;

const BASE62_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE62_BASE = BigInt(BASE62_ALPHABET.length);
const POINT_ID_PERMUTATION_MOD = 1n << 36n;
const POINT_ID_PERMUTATION_MULTIPLIER = 25214903917n;
const POINT_ID_PERMUTATION_OFFSET = 11n;
const POINT_ID_TOKEN_LENGTH = 7;
const POINT_TOKEN_PATTERN = /^[0-9a-zA-Z]{7}$/;
const POINT_HTML_FILE_PATTERN = /^[0-9a-zA-Z]{7}\.html$/;

const INDEXABLE_MAIN_CATEGORIES = new Set(['files']);
const INDEXABLE_SUB_CATEGORIES = new Set(['archives', 'boss', 'valuable', 'facility']);

let sharp;

const buildTarget = process.env.BUILD_TARGET === 'r2' ? 'r2' : 'oss';
const SEO_POINTS_OUT_DIR = path.resolve(SEO_POINTS_ROOT_DIR, buildTarget);
const deployChannel = getDeployChannel();
const defaultSiteUrl = buildTarget === 'r2'
  ? deployChannel === 'beta'
    ? 'https://beta.opendfieldmap.org'
    : 'https://opendfieldmap.org'
  : deployChannel === 'beta'
    ? 'https://beta.opendfieldmap.cn'
    : 'https://opendfieldmap.cn';
const siteUrl = (process.env.SEO_SITE_URL || defaultSiteUrl).replace(/\/$/, '');
const defaultLocale = process.env.SEO_LOCALE || (buildTarget === 'r2' ? 'en-US' : 'zh-CN');
const langKey = defaultLocale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
const htmlLang = defaultLocale.replace('_', '-');
const seoLimit = Number.parseInt(process.env.SEO_LIMIT || '', 10);
const seoTokens = (process.env.SEO_TOKENS || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);
const shouldGenerateImages = process.env.SEO_SKIP_IMAGES !== '1';
const shouldForceImages = process.env.SEO_FORCE_IMAGES === '1';
const shouldForceAllImages = process.env.SEO_FORCE_ALL_IMAGES === '1';
const shouldRefreshOgStateOnly = process.env.SEO_OG_REFRESH_STATE_ONLY === '1';
const shouldSkipPointFiles = process.env.SEO_SKIP_POINT_FILES === '1';
const shouldBuildImagesOnly = process.env.SEO_IMAGE_ONLY === '1';
const shouldBuildPreviewOnly = process.env.SEO_PREVIEW_ONLY === '1';
const shouldWriteWorkerPreview = shouldBuildPreviewOnly || process.env.SEO_WRITE_WORKER_PREVIEW === '1';
const workerPreviewFile = process.env.SEO_PREVIEW_OUTPUT_FILE
  ? path.resolve(ROOT, process.env.SEO_PREVIEW_OUTPUT_FILE)
  : DEFAULT_WORKER_PREVIEW_FILE;
const workerPreviewFormat = process.env.SEO_PREVIEW_FORMAT === 'json' ? 'json' : 'ts';
const hasExplicitPointScope = seoTokens.length > 0 || (Number.isFinite(seoLimit) && seoLimit > 0);
const shouldWriteAllPointFiles = process.env.SEO_WRITE_ALL_POINT_FILES === '1' || shouldForceAllImages;
const shouldForcePointFiles = process.env.SEO_FORCE_POINT_FILES === '1';
const shouldWritePointFiles = !shouldBuildImagesOnly && !shouldBuildPreviewOnly && !shouldSkipPointFiles && (hasExplicitPointScope || shouldWriteAllPointFiles);
const shouldBuildPointImages = shouldGenerateImages && (shouldBuildImagesOnly || hasExplicitPointScope || shouldForceImages || shouldForceAllImages);
const seoOgOutputDir = process.env.SEO_OG_OUTPUT_DIR
  ? path.resolve(ROOT, process.env.SEO_OG_OUTPUT_DIR)
  : path.resolve(SEO_OG_OUT_DIR, buildTarget);
const SEO_CACHE_DIR = path.resolve(ROOT, '.cache/seo');
const SEO_PAGE_STATE_FILE = path.resolve(SEO_CACHE_DIR, `pages-${buildTarget}-${defaultLocale}.json`);
const SEO_OG_STATE_FILE = path.resolve(SEO_CACHE_DIR, `og-${buildTarget}-${defaultLocale}.json`);
const requestedSeoOgConcurrency = Number.parseInt(process.env.SEO_OG_CONCURRENCY || '', 10);
const defaultSeoOgConcurrency = 12;
const seoOgConcurrency = Number.isFinite(requestedSeoOgConcurrency) && requestedSeoOgConcurrency > 0
  ? requestedSeoOgConcurrency
  : defaultSeoOgConcurrency;
const SEO_STATE_VERSION = 1;
const OG_RENDER_SIGNATURE_VERSION = 4;
const OG_RENDER_RECIPE = 'dim-main-overlay-target-layer-labels-last';
const FILE_FINGERPRINT_VERSION = 2;

const fileFingerprintCache = new Map();

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

const seoOgUrlBase = (process.env.SEO_OG_URL_BASE || resolveDefaultOgUrlBase()).replace(/\/$/, '');

const seoUi = langKey === 'zh'
  ? {
      openMap: '打开地图集',
    }
  : {
      openMap: 'Open in OEM',
    };

const html = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const xml = html;

const normalize = (value) => String(value ?? '')
  .replace(/\s+/g, ' ')
  .replace(/\u0000/g, ' ')
  .trim();

const escapeXmlAttribute = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

async function configureSharpFonts() {
  if (sharp) return;

  const fontconfigDir = path.resolve(os.tmpdir(), 'talos-seo-fontconfig');
  const fontconfigCacheDir = path.resolve(fontconfigDir, 'cache');
  const fontconfigFile = path.resolve(fontconfigDir, 'fonts.conf');
  await fs.mkdir(fontconfigCacheDir, { recursive: true });
  await fs.writeFile(fontconfigFile, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${escapeXmlAttribute(HARMONY_FONT_DIR)}</dir>
  <dir>${escapeXmlAttribute(path.resolve(FONT_DIR, 'UD_ShinGo'))}</dir>
  <dir>${escapeXmlAttribute(LOCAL_FONT_DIR)}</dir>
  <cachedir>${escapeXmlAttribute(fontconfigCacheDir)}</cachedir>
</fontconfig>
`);

  process.env.FONTCONFIG_FILE = fontconfigFile;
  process.env.FONTCONFIG_PATH = fontconfigDir;

  const sharpModule = await import('sharp');
  sharp = sharpModule.default;
}

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function safeReadJson(file, fallback = null) {
  try {
    return await readJson(file);
  } catch {
    return fallback;
  }
}

async function safeReaddir(dir) {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function fileFingerprint(file) {
  if (!file) return 'missing';
  if (!fileFingerprintCache.has(file)) {
    fileFingerprintCache.set(file, (async () => {
      const relativePath = path.relative(ROOT, file);
      try {
        const contents = await fs.readFile(file);
        const digest = crypto.createHash('sha256').update(contents).digest('hex');
        return `${relativePath}:sha256:${digest}`;
      } catch {
        return `${relativePath}:missing`;
      }
    })());
  }
  return fileFingerprintCache.get(file);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return value.map((item) => stableJson(item));
  }
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = stableJson(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function hashSignature(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex');
}

async function collectFingerprints(files) {
  const entries = await Promise.all(files.map(async (file) => [path.relative(ROOT, file), await fileFingerprint(file)]));
  return Object.fromEntries(entries);
}

async function resolveLocaleJsonFile(dir, locale) {
  const effectiveLocale = locale === 'zh-HK' ? 'zh-TW' : locale;
  const files = (await safeReaddir(dir)).filter((file) => file.endsWith('.json'));
  const exact = files.find((file) => file.replace(/\.json$/i, '') === effectiveLocale);
  if (exact) return path.resolve(dir, exact);
  const lower = effectiveLocale.toLowerCase();
  const insensitive = files.find((file) => file.replace(/\.json$/i, '').toLowerCase() === lower);
  return insensitive ? path.resolve(dir, insensitive) : path.resolve(dir, `${effectiveLocale}.json`);
}

const modInverse = (a, mod) => {
  let t = 0n;
  let newT = 1n;
  let r = mod;
  let newR = ((a % mod) + mod) % mod;
  while (newR !== 0n) {
    const quotient = r / newR;
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  if (r !== 1n) throw new Error('Point token permutation multiplier is not invertible');
  return ((t % mod) + mod) % mod;
};

const POINT_ID_PERMUTATION_INVERSE = modInverse(
  POINT_ID_PERMUTATION_MULTIPLIER,
  POINT_ID_PERMUTATION_MOD,
);

function encodeBase62(value) {
  if (value === 0n) return '0';
  let num = value;
  let encoded = '';
  while (num > 0n) {
    const remainder = Number(num % BASE62_BASE);
    encoded = BASE62_ALPHABET[remainder] + encoded;
    num /= BASE62_BASE;
  }
  return encoded;
}

function decodeBase62(encoded) {
  let value = 0n;
  for (const ch of encoded) {
    const index = BASE62_ALPHABET.indexOf(ch);
    if (index < 0) return null;
    value = value * BASE62_BASE + BigInt(index);
  }
  return value;
}

function encodePointIdToken(pointId) {
  if (!/^\d+$/.test(pointId)) return null;
  const id = BigInt(pointId);
  if (id < 0n || id >= POINT_ID_PERMUTATION_MOD) return null;
  const obfuscated = (id * POINT_ID_PERMUTATION_MULTIPLIER + POINT_ID_PERMUTATION_OFFSET) % POINT_ID_PERMUTATION_MOD;
  return encodeBase62(obfuscated).padStart(POINT_ID_TOKEN_LENGTH, '0');
}

function decodePointIdToken(token) {
  if (token.length !== POINT_ID_TOKEN_LENGTH) return null;
  const encoded = token.replace(/^0+/, '') || '0';
  const obfuscated = decodeBase62(encoded);
  if (obfuscated === null || obfuscated < 0n || obfuscated >= POINT_ID_PERMUTATION_MOD) return null;
  const decoded = ((obfuscated - POINT_ID_PERMUTATION_OFFSET + POINT_ID_PERMUTATION_MOD) % POINT_ID_PERMUTATION_MOD);
  const id = (decoded * POINT_ID_PERMUTATION_INVERSE) % POINT_ID_PERMUTATION_MOD;
  return id.toString();
}

function subregionRegionMap(regionMap) {
  const map = new Map();
  for (const [regionKey, region] of Object.entries(regionMap)) {
    for (const subregionId of region.subregions ?? []) {
      map.set(subregionId, regionKey);
    }
  }
  return map;
}

async function loadMarkers(typeMap) {
  return (await loadEffectiveMarkers({ typeMap })).filter((marker) => typeMap[marker.type]);
}

function deduplicateMarkersByPositionAndType(markers) {
  const seen = new Set();
  return markers.filter((marker) => {
    const key = JSON.stringify([marker.type, marker.x, marker.y, marker.z]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadLocaleLabels(locale) {
  const data = await safeReadJson(await resolveLocaleJsonFile(LOCALE_DIR, locale), {});
  return data?.markerType?.key && typeof data.markerType.key === 'object'
    ? data.markerType.key
    : {};
}

async function loadRegionLocale(locale) {
  return safeReadJson(await resolveLocaleJsonFile(REGION_LOCALE_DIR, locale), {});
}

async function loadBodyTypes(locale) {
  const dir = path.resolve(FILES_TEXT_DIR, locale === 'zh-HK' ? 'zh-TW' : locale);
  const files = (await safeReaddir(dir)).filter((file) => file.endsWith('.json'));
  const bodyTypes = new Set();
  for (const file of files) {
    bodyTypes.add(file.replace(/\.json$/i, ''));
  }
  return bodyTypes;
}

function mapRegionKeyToLocaleCode(regionKey) {
  if (regionKey === 'Valley_4') return 'VL';
  if (regionKey === 'Wuling') return 'WL';
  if (regionKey === 'Dijiang') return 'DJ';
  if (regionKey === 'Weekraid_1') return 'ES';
  return null;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function detectRegionStructure(regionBundle, regionCode) {
  const subNode = regionBundle?.[regionCode]?.sub;
  if (isObject(subNode) && isObject(subNode.site) && typeof subNode.name === 'string') {
    return 'flat';
  }
  return 'nested';
}

function resolveRegionName(regionBundle, regionCode) {
  const name = regionBundle?.[regionCode]?.main;
  return typeof name === 'string' ? normalize(name) : '';
}

function resolveRegionNameWithFallback(regionBundle, fallbackBundle, regionCode) {
  return resolveRegionName(regionBundle, regionCode) || resolveRegionName(fallbackBundle, regionCode);
}

function resolveLabelText(regionBundle, regionCode, label) {
  const subNode = regionBundle?.[regionCode]?.sub;
  if (!isObject(subNode)) return '';
  const structure = detectRegionStructure(regionBundle, regionCode);
  let value;
  if (structure === 'flat') {
    value = label.type === 'sub'
      ? subNode.name
      : subNode.site?.[label.site];
  } else {
    const scopedSub = subNode[label.sub];
    if (!isObject(scopedSub)) return '';
    value = label.type === 'sub'
      ? scopedSub.name
      : scopedSub.site?.[label.site];
  }
  return typeof value === 'string' ? normalize(value) : '';
}

function resolveLabelTextWithFallback(regionBundle, fallbackBundle, regionCode, label) {
  return resolveLabelText(regionBundle, regionCode, label) || resolveLabelText(fallbackBundle, regionCode, label);
}

function labelsByRegion(labelData) {
  const result = new Map();
  for (const [regionCode, region] of Object.entries(labelData?.regions ?? {})) {
    const labels = Object.values(region?.labels ?? {});
    result.set(regionCode, labels);
  }
  return result;
}

function distanceSquared(a, b) {
  const dx = a.x - b[0];
  const dy = a.y - b[1];
  return dx * dx + dy * dy;
}

function nearestTranslatedLabel(labels, regionBundle, fallbackBundle, regionCode, centerPixel, preferredType) {
  let best = null;
  for (const label of labels) {
    if (preferredType && label.type !== preferredType) continue;
    const text = resolveLabelTextWithFallback(regionBundle, fallbackBundle, regionCode, label);
    if (!text) continue;
    const distance = distanceSquared(centerPixel, label.point);
    if (!best || distance < best.distance) {
      best = { text, distance };
    }
  }
  return best?.text ?? '';
}

function resolvePointPlace(point, labelRegions, regionBundle, fallbackBundle) {
  const regionCode = mapRegionKeyToLocaleCode(point.regionKey);
  if (!regionCode) return { regionName: '', siteName: '', subName: '' };
  const labels = labelRegions.get(regionCode) ?? [];
  const centerPixel = markerToPixel(point.marker, point.region);
  return {
    regionName: resolveRegionNameWithFallback(regionBundle, fallbackBundle, regionCode),
    siteName: nearestTranslatedLabel(labels, regionBundle, fallbackBundle, regionCode, centerPixel, 'site'),
    subName: nearestTranslatedLabel(labels, regionBundle, fallbackBundle, regionCode, centerPixel, 'sub'),
  };
}

function resolvePointPlaceText(place) {
  return [place.regionName, place.subName, place.siteName].filter(Boolean).join(langKey === 'zh' ? '-' : ' / ');
}

function resolveEnglishPointPlaceText(place) {
  const nearby = [place.siteName, place.subName].filter(Boolean).join(', ');
  if (nearby && place.regionName) return `${nearby} in ${place.regionName}`;
  return nearby || place.regionName || '';
}

function resolveDocumentTitle(point) {
  const closestPlace = point.place.siteName || point.place.subName || point.place.regionName;
  if (langKey === 'zh') {
    return `${[point.title, closestPlace].filter(Boolean).join('-')}｜终末地地图集`;
  }
  const titleParts = [point.title, closestPlace].filter(Boolean);
  return `${titleParts.join(' - ')} - ${SITE_NAME}`;
}

function pointShareUrl(token) {
  return `${POINT_SHARE_SHORT_ORIGIN}/${encodeURIComponent(token)}`;
}

function spaPointUrl(token) {
  return `${siteUrl}/?x=${encodeURIComponent(token)}`;
}

function pointPageUrl(token) {
  return `${siteUrl}/${encodeURIComponent(token)}/`;
}

function pointOgUrl(token) {
  return `${seoOgUrlBase}/${encodeURIComponent(token)}.jpg`;
}

function getOgTileOffsets() {
  const offsets = [];
  for (let y = -SAMPLE_IMAGE_HEIGHT / 2 - TILE_IMAGE_SIZE; y <= SAMPLE_IMAGE_HEIGHT / 2 + TILE_IMAGE_SIZE; y += TILE_IMAGE_SIZE) {
    for (let x = -SAMPLE_IMAGE_WIDTH / 2 - TILE_IMAGE_SIZE; x <= SAMPLE_IMAGE_WIDTH / 2 + TILE_IMAGE_SIZE; x += TILE_IMAGE_SIZE) {
      offsets.push([x, y]);
    }
  }
  return offsets;
}

function shouldIndexPoint(typeInfo, hasBody) {
  const main = typeInfo?.category?.main ?? '';
  const sub = typeInfo?.category?.sub ?? '';
  return hasBody || INDEXABLE_MAIN_CATEGORIES.has(main) || INDEXABLE_SUB_CATEGORIES.has(sub);
}

function markerToPixel(marker, region) {
  const scale = 2 ** region.maxZoom;
  return {
    x: marker.pos[1] * scale,
    y: -marker.pos[0] * scale,
  };
}

function tileSuffixForTier(tier) {
  const rounded = Math.trunc(tier);
  if (rounded === 0) return '';
  return `_${rounded < 0 ? 'b' : 'l'}${Math.abs(rounded)}`;
}

async function resolveIconPath(typeInfo) {
  const key = typeInfo.icon ?? typeInfo.key;
  const candidates = [
    path.resolve(ITEM_DIR, `${key}.webp`),
    path.resolve(MARKER_ICON_DIR, `${key}.webp`),
    path.resolve(ITEM_DIR, `${typeInfo.key}.webp`),
    path.resolve(MARKER_ICON_DIR, `${typeInfo.key}.webp`),
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function buildHtmlSignature(point) {
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

async function buildOgSignature(point, sharedFingerprints) {
  const iconPath = await resolveIconPath(point.typeInfo);
  const tilePaths = buildTilePathsForPoint(point);
  const labelRows = (point.mapLabels ?? [])
    .filter((label) => label.type === 'site')
    .map((label) => ({
      type: label.type,
      sub: label.sub,
      site: label.site,
      point: label.point,
      text: resolveLabelTextWithFallback(point.regionLocale, point.fallbackRegionLocale, point.regionCode, label),
    }))
    .filter((label) => label.text);

  return hashSignature({
    version: OG_RENDER_SIGNATURE_VERSION,
    recipe: OG_RENDER_RECIPE,
    target: buildTarget,
    locale: defaultLocale,
    langKey,
    htmlLang,
    mode: 'rendered',
    point: {
      token: point.token,
      markerId: point.marker.id,
      markerTier: point.marker.tier,
      markerType: point.marker.type,
      title: point.title,
      documentTitle: point.documentTitle,
      description: point.description,
      regionKey: point.regionKey,
      regionMaxZoom: point.region.maxZoom,
      typeKey: point.typeInfo.key,
      typeIcon: point.typeInfo.icon ?? null,
      noFrame: Boolean(point.typeInfo.noFrame),
      place: point.place,
      labels: labelRows,
    },
    tiles: tilePaths.reduce((acc, file, index) => {
      acc[index] = file;
      return acc;
    }, {}),
    fingerprints: {
      shared: sharedFingerprints,
      icon: await fileFingerprint(iconPath),
      tiles: await collectFingerprints(tilePaths),
    },
  });
}

async function buildFallbackOgSignature(point, sharedFingerprints) {
  const iconPath = await resolveIconPath(point.typeInfo);
  return hashSignature({
    version: OG_RENDER_SIGNATURE_VERSION,
    recipe: OG_RENDER_RECIPE,
    target: buildTarget,
    locale: defaultLocale,
    langKey,
    htmlLang,
    mode: 'fallback',
    point: {
      token: point.token,
      markerId: point.marker.id,
      markerTier: point.marker.tier,
      markerType: point.marker.type,
      title: point.title,
      documentTitle: point.documentTitle,
      description: point.description,
      regionKey: point.regionKey,
      regionMaxZoom: point.region.maxZoom,
      typeKey: point.typeInfo.key,
      typeIcon: point.typeInfo.icon ?? null,
      noFrame: Boolean(point.typeInfo.noFrame),
      place: point.place,
    },
    fingerprints: {
      shared: sharedFingerprints,
      icon: await fileFingerprint(iconPath),
    },
  });
}

function markerTierLabel(tierValue) {
  const tier = Math.trunc(tierValue);
  if (tier === 0) return '';
  return `${tier < 0 ? 'B' : 'L'}${Math.abs(tier)}`;
}

function markerTierBadgeStyle(tierLabel) {
  if (tierLabel === 'L1') return { background: 'rgb(253,255,149)', color: 'rgb(51,51,51)' };
  if (tierLabel === 'L2') return { background: 'rgb(255,229,36)', color: 'rgb(51,51,51)' };
  if (tierLabel === 'L3') return { background: 'rgb(255,139,56)', color: 'rgb(51,51,51)' };
  if (tierLabel === 'B1') return { background: 'rgb(50,98,201)', color: 'rgb(248,248,248)' };
  if (tierLabel === 'B2') return { background: 'rgb(29,72,189)', color: 'rgb(248,248,248)' };
  if (tierLabel === 'B3') return { background: 'rgb(52,39,188)', color: 'rgb(248,248,248)' };
  if (tierLabel === 'B4') return { background: 'rgb(67,29,190)', color: 'rgb(248,248,248)' };
  return { background: 'rgb(255,196,40)', color: 'rgb(51,51,51)' };
}

function escapeSvgText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function svgFontFace(name, file) {
  return `@font-face{font-family:'${name}';src:url('${pathToFileURL(file).href}') format('truetype');font-weight:100 900;font-style:normal;}`;
}

function labelFontFamily() {
  return langKey === 'zh'
    ? "'HarmonyOS Sans SC','HarmonyOS Sans TC','HarmonyOS Sans',sans-serif"
    : "'HarmonyOS Sans','HarmonyOS Sans SC','HarmonyOS Sans TC',sans-serif";
}

function svgFontFaceIfExists(name, file, weight = 400) {
  if (!fsSync.existsSync(file)) return '';
  const ext = path.extname(file).toLowerCase();
  const format = ext === '.otf' ? 'opentype' : 'truetype';
  return `@font-face{font-family:'${name}';src:url('${pathToFileURL(file).href}') format('${format}');font-weight:${weight};font-style:normal;}`;
}

function estimateLabelTextWidth(text, fontSize, letterSpacing) {
  let width = 0;
  for (const char of text) {
    if (/\s/.test(char)) {
      width += fontSize * 0.34;
    } else if (/[\u2E80-\u9FFF]/.test(char)) {
      width += fontSize * 1.06;
    } else if (/[A-Z]/.test(char)) {
      width += fontSize * 0.74;
    } else if (/[a-z0-9]/.test(char)) {
      width += fontSize * 0.62;
    } else {
      width += fontSize * 0.5;
    }
  }
  return width + Math.max(0, text.length - 1) * letterSpacing;
}

function splitWordByWidth(word, maxWidth, fontSize, letterSpacing) {
  if (estimateLabelTextWidth(word, fontSize, letterSpacing) <= maxWidth) return [word];

  const segments = [];
  let current = '';
  for (const char of word) {
    const next = current + char;
    if (current && estimateLabelTextWidth(next, fontSize, letterSpacing) > maxWidth) {
      segments.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) segments.push(current);
  return segments;
}

function labelTextLines(text, options) {
  const {
    fontSize,
    letterSpacing,
    maxTextWidth,
    maxLines,
  } = options;
  const normalizedText = normalize(text);
  if (estimateLabelTextWidth(normalizedText, fontSize, letterSpacing) <= maxTextWidth) {
    return [normalizedText];
  }

  if (/\s/.test(normalizedText)) {
    const lines = [];
    let current = '';
    for (const word of normalizedText.split(/\s+/)) {
      for (const segment of splitWordByWidth(word, maxTextWidth, fontSize, letterSpacing)) {
        const next = current ? `${current} ${segment}` : segment;
        if (current && estimateLabelTextWidth(next, fontSize, letterSpacing) > maxTextWidth) {
          lines.push(current);
          current = segment;
        } else {
          current = next;
        }
      }
    }
    if (current) lines.push(current);
    return lines.slice(0, maxLines);
  }
  return splitWordByWidth(normalizedText, maxTextWidth, fontSize, letterSpacing).slice(0, maxLines);
}

function labelSvg(text, labelType = 'site') {
  const isSub = labelType === 'sub';
  const baseFontSize = isSub ? 30 : 26;
  const minFontSize = isSub ? 24 : 20;
  const fontWeight = isSub ? 700 : 560;
  const minWidth = isSub ? 250 : 236;
  const maxWidth = isSub ? 380 : 430;
  const horizontalPadding = isSub ? 64 : 76;
  const verticalPadding = isSub ? 30 : 32;
  const letterSpacing = isSub ? -0.2 : -0.5;
  const rawText = isSub ? text : text.toUpperCase();
  const maxLines = isSub ? 3 : 4;
  let fontSize = baseFontSize;
  let maxTextWidth = maxWidth - horizontalPadding;
  let lines = labelTextLines(rawText, {
    fontSize,
    letterSpacing,
    maxTextWidth,
    maxLines,
  });

  while (
    fontSize > minFontSize
    && lines.some((line) => estimateLabelTextWidth(line, fontSize, letterSpacing) > maxTextWidth)
  ) {
    fontSize -= 1;
    lines = labelTextLines(rawText, {
      fontSize,
      letterSpacing,
      maxTextWidth,
      maxLines,
    });
  }

  const longestLineWidth = Math.max(
    ...lines.map((line) => estimateLabelTextWidth(line, fontSize, letterSpacing)),
    0,
  );
  const width = Math.min(maxWidth, Math.max(minWidth, Math.ceil(longestLineWidth + horizontalPadding)));
  const lineHeight = Math.round(fontSize * 1.04);
  const height = Math.max(70, lines.length * lineHeight + verticalPadding);
  const yStart = (height - (lines.length - 1) * lineHeight) / 2 + fontSize * 0.34;
  const tspans = lines.map((line, index) =>
    `<tspan x="${width / 2}" y="${yStart + index * lineHeight}">${escapeSvgText(line)}</tspan>`,
  ).join('');
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
  <style>
    ${svgFontFace('HarmonyOS Sans', HARMONY_FONT_FILE)}
    ${svgFontFace('HarmonyOS Sans SC', HARMONY_SC_FONT_FILE)}
    ${svgFontFace('HarmonyOS Sans TC', HARMONY_TC_FONT_FILE)}
    ${svgFontFace('HMSans_EN', HARMONY_FONT_FILE)}
    ${svgFontFace('HMSans', HARMONY_SC_FONT_FILE)}
    text {
      font-family: ${labelFontFamily()};
      font-size: ${fontSize}px;
      font-weight: ${fontWeight};
      letter-spacing: ${letterSpacing}px;
    }
  </style>

  <filter id="labelShadow" x="-80%" y="-80%" width="260%" height="260%">
    <feDropShadow dx="1" dy="1" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.9"/>
    <feDropShadow dx="0" dy="0" stdDeviation="1.6" flood-color="#333333" flood-opacity="0.9"/>
  </filter>
</defs>

<text
  text-anchor="middle"
  fill="rgb(242, 242, 235)"
  stroke="rgb(45, 45, 45)"
  stroke-width="2"
  stroke-linejoin="round"
  paint-order="stroke fill"
  filter="url(#labelShadow)"
>
  ${tspans}
</text>
    </svg>
  `);
}

async function markerCompositeInputs(point, iconPath) {
  const framedMarker = !point.typeInfo.noFrame;
  const tierLabel = markerTierLabel(point.marker.tier);
  const tierBadge = markerTierBadgeStyle(tierLabel);
  const markerCenter = point.overlayCenter ?? { x: IMAGE_WIDTH / 2, y: IMAGE_HEIGHT / 2 };
  if (framedMarker) {
    const scale = MARKER_RENDER_SCALE;
    const size = Math.round(64 * scale);
    const imageSize = 32 * scale;
    const iconSize = 28 * scale;
    const frameLeft = (size - imageSize) / 2;
    const frameTop = (size - imageSize) / 2;
    const circleLeft = frameLeft + (imageSize - iconSize) / 2;
    const circleTop = frameTop + (imageSize - iconSize) / 2;
    const circleCenter = circleLeft + iconSize / 2;
    const fillRadius = iconSize / 2;
    const selectedGoldRadius = fillRadius + 3 * scale;
    const selectedOuterRadius = fillRadius + 7 * scale;
    const outlineWidth = 2 * scale;
    const pointerHalf = 5 * scale;
    const pointerHeight = 7 * scale;
    const pointerTop = frameTop + imageSize + 4 * scale;
    const badgeWidth = Math.max(16 * scale, (10 + tierLabel.length * 8) * scale);
    const badgeHeight = 16 * scale;
    const badgeRight = frameLeft + imageSize + 0.45 * 16 * scale;
    const badgeLeft = badgeRight - badgeWidth;
    const badgeTop = frameTop - 0.45 * 16 * scale;
    const framedMarkerCenter = {
      x: markerCenter.x,
      y: markerCenter.y - imageSize / 2,
    };
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
        <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="${3.125 * scale}" flood-color="#000000" flood-opacity="0.85"/>
        </filter>
        <circle
          cx="${circleCenter}"
          cy="${circleCenter}"
          r="${selectedOuterRadius}"
          fill="none"
          stroke="rgb(248,248,248)"
          stroke-width="${outlineWidth}"
        />
        <circle
          cx="${circleCenter}"
          cy="${circleCenter}"
          r="${selectedGoldRadius}"
          fill="none"
          stroke="rgb(255,196,40)"
          stroke-width="${outlineWidth}"
        />
        <circle
          cx="${circleCenter}"
          cy="${circleCenter}"
          r="${fillRadius}"
          fill="rgb(248,248,248)"
          filter="url(#shadow)"
        />
        <path
          d="M ${circleCenter - pointerHalf} ${pointerTop} L ${circleCenter + pointerHalf} ${pointerTop} L ${circleCenter} ${pointerTop + pointerHeight} Z"
          fill="rgb(255,196,40)"
          filter="url(#shadow)"
        />
        ${tierLabel ? `<rect x="${badgeLeft}" y="${badgeTop}" width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${tierBadge.background}" filter="url(#shadow)"/>
        <text x="${badgeLeft + badgeWidth / 2}" y="${badgeTop + badgeHeight * 0.74}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${11 * scale}" font-weight="800" fill="${tierBadge.color}">${html(tierLabel)}</text>` : ''}
      </svg>
    `;
    const inputs = [{
      input: Buffer.from(svg),
      left: Math.round(framedMarkerCenter.x - size / 2),
      top: Math.round(framedMarkerCenter.y - size / 2),
    }];
    if (iconPath) {
      inputs.push({
        input: await sharp(iconPath).resize(Math.round(imageSize), Math.round(imageSize), { fit: 'cover' }).png().toBuffer(),
        left: Math.round(framedMarkerCenter.x - imageSize / 2),
        top: Math.round(framedMarkerCenter.y - imageSize / 2),
      });
    }
    return inputs;
  }

  const imageSize = Math.round(50 * MARKER_RENDER_SCALE);
  const inputs = [];
  if (iconPath) {
    inputs.push({
      input: await sharp(iconPath)
        .resize(imageSize, imageSize, { fit: 'contain' })
        .png()
        .toBuffer(),
      left: Math.round(markerCenter.x - imageSize / 2),
      top: Math.round(markerCenter.y - imageSize / 2),
    });
  } else {
    const fallbackSize = Math.round(18 * MARKER_RENDER_SCALE);
    inputs.push({
      input: Buffer.from(`<svg width="${fallbackSize}" height="${fallbackSize}" viewBox="0 0 ${fallbackSize} ${fallbackSize}" xmlns="http://www.w3.org/2000/svg"><rect width="${fallbackSize}" height="${fallbackSize}" fill="rgb(248,248,248)"/></svg>`),
      left: Math.round(markerCenter.x - fallbackSize / 2),
      top: Math.round(markerCenter.y - fallbackSize / 2),
    });
  }
  if (tierLabel) {
    const badgeWidth = Math.round(Math.max(18, 8 + tierLabel.length * 8) * MARKER_RENDER_SCALE);
    const badgeHeight = Math.round(16 * MARKER_RENDER_SCALE);
    inputs.push({
      input: Buffer.from(`<svg width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}" xmlns="http://www.w3.org/2000/svg"><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${1 * MARKER_RENDER_SCALE}" stdDeviation="${2 * MARKER_RENDER_SCALE}" flood-color="#000000" flood-opacity="0.65"/></filter><rect width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${tierBadge.background}" filter="url(#shadow)"/><text x="${badgeWidth / 2}" y="${badgeHeight * 0.74}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${11 * MARKER_RENDER_SCALE}" font-weight="800" fill="${tierBadge.color}">${html(tierLabel)}</text></svg>`),
      left: Math.round(markerCenter.x + imageSize / 2 - badgeWidth / 2),
      top: Math.round(markerCenter.y - imageSize / 2),
    });
  }
  return inputs;
}

async function createMapPatternBackground() {
  const patternTileSize = 100;
  const patternSvg = await fs.readFile(MAP_PATTERN_FILE);
  const patternTile = await sharp({
    create: {
      width: patternTileSize,
      height: patternTileSize,
      channels: 4,
      background: { r: 17, g: 17, b: 17, alpha: 1 },
    },
  })
    .composite([{
      input: await sharp(patternSvg)
        .resize(patternTileSize, patternTileSize, { fit: 'fill' })
        .tint({ r: 51, g: 51, b: 51 })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: WORK_IMAGE_WIDTH,
      height: WORK_IMAGE_HEIGHT,
      channels: 4,
      background: { r: 17, g: 17, b: 17, alpha: 1 },
    },
  })
    .composite([{ input: patternTile, tile: true, left: 0, top: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}

async function createMapPatternSampleBackground() {
  const patternTileSize = 100;
  const patternSvg = await fs.readFile(MAP_PATTERN_FILE);
  const patternTile = await sharp({
    create: {
      width: patternTileSize,
      height: patternTileSize,
      channels: 4,
      background: { r: 17, g: 17, b: 17, alpha: 1 },
    },
  })
    .composite([{
      input: await sharp(patternSvg)
        .resize(patternTileSize, patternTileSize, { fit: 'fill' })
        .tint({ r: 51, g: 51, b: 51 })
        .png()
        .toBuffer(),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: SAMPLE_IMAGE_WIDTH,
      height: SAMPLE_IMAGE_HEIGHT,
      channels: 4,
      background: { r: 17, g: 17, b: 17, alpha: 1 },
    },
  })
    .composite([{ input: patternTile, tile: true, left: 0, top: 0 }])
    .webp({ quality: 82 })
    .toBuffer();
}

async function applyWorkMapMask(buffer) {
  const overlay = Buffer.from(`
    <svg width="${WORK_IMAGE_WIDTH}" height="${WORK_IMAGE_HEIGHT}" viewBox="0 0 ${WORK_IMAGE_WIDTH} ${WORK_IMAGE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mask" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#000000" stop-opacity="0"/>
          <stop offset="0.48" stop-color="#000000" stop-opacity="0.08"/>
          <stop offset="1" stop-color="#000000" stop-opacity="0.58"/>
        </linearGradient>
      </defs>
      <rect width="${WORK_IMAGE_WIDTH}" height="${WORK_IMAGE_HEIGHT}" fill="url(#mask)"/>
    </svg>
  `);
  return sharp(buffer)
    .composite([{ input: overlay, left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function brandCompositeInput() {
  if (!(await pathExists(OBSERVATOR_LOGO_FILE))) return null;
  const logoHeight = 96;
  const logoInput = await sharp(OBSERVATOR_LOGO_FILE)
    .resize({ height: logoHeight, fit: 'contain' })
    .png()
    .toBuffer();
  const logoMetadata = await sharp(logoInput).metadata();
  const logoWidth = logoMetadata.width ?? logoHeight;
  const gap = 10;
  const textWidth = langKey === 'zh' ? 270 : 410;
  const width = textWidth + gap + logoWidth;
  const height = logoHeight;
  const titleFontFamily = langKey === 'zh' ? 'UDShinGo_HK_DB' : 'Coinbase Display';
  const titleFontSize = langKey === 'zh' ? 43 : 38;
  const titleY = langKey === 'zh' ? 84 : 82;
  const poweredBoxWidth = 156;
  const poweredX = width - logoWidth - gap - poweredBoxWidth;
  const poweredCenterX = poweredX + poweredBoxWidth / 2;
  const titleAnchorX = width - logoWidth - gap + (langKey === 'zh' ? 3 : 2);
  const svg = Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <style>
          ${svgFontFaceIfExists('Coinbase Display', COINBASE_DISPLAY_FONT_FILE, 400)}
          ${svgFontFaceIfExists('UDShinGo_HK_DB', UDSHINGO_HK_DB_FONT_FILE, 700)}
          ${svgFontFaceIfExists('Zilla Slab Highlight', ZILLA_SLAB_HIGHLIGHT_FONT_FILE, 700)}
          ${svgFontFaceIfExists('Novecento slab', NOVECENTO_SLAB_BOLD_FONT_FILE, 700)}
          .powered {
            font-family: 'Zilla Slab Highlight', 'Novecento slab', serif;
            font-size: 25px;
            font-weight: 700;
            letter-spacing: 0.2px;
          }
          .title {
            font-family: '${titleFontFamily}', ${langKey === 'zh' ? "'HarmonyOS Sans TC','HarmonyOS Sans SC'" : "'Coinbase Display'"}, sans-serif;
            font-size: ${titleFontSize}px;
            font-weight: ${langKey === 'zh' ? 700 : 400};
            filter: url(#titleShadow);
            letter-spacing: -0.02em;
            font-feature-settings: "ss01" 1, "ss02" 1;
          }
        </style>
        <filter id="titleShadow" x="-35%" y="-90%" width="170%" height="290%">
          <feDropShadow dx="0" dy="3" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.95"/>
          <feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#000000" flood-opacity="0.9"/>
          <feDropShadow dx="1" dy="1" stdDeviation="1.1" flood-color="#000000" flood-opacity="0.85"/>
        </filter>
      </defs>
      <text class="powered" x="${poweredCenterX - 4}" y="37" text-anchor="middle" fill="rgb(248,248,248)" xml:space="preserve">&#8201;POWERED&#8201;BY&#8201;</text>
      ${langKey === 'zh'
        ? `<text class="title" x="${titleAnchorX}" y="${titleY}" text-anchor="end">
            <tspan fill="rgb(248,248,248)">終末地</tspan><tspan fill="rgb(255,196,40)">地圖集</tspan>
          </text>`
        : `<text class="title" x="${titleAnchorX}" y="${titleY}" text-anchor="end" fill="rgb(248,248,248)">Open Endfield Map</text>`}
    </svg>
  `);
  const textInput = await sharp(svg).png().toBuffer();
  const input = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: textInput, left: 0, top: 0 },
      { input: logoInput, left: width - logoWidth, top: 0 },
    ])
    .png()
    .toBuffer();
  return {
    input,
    left: IMAGE_WIDTH - width - 48,
    top: IMAGE_HEIGHT - height - 36,
  };
}

function markerToTileImagePixel(marker, region, tileZoom) {
  const maxZoomPixel = markerToPixel(marker, region);
  const leafletScale = 2 ** (region.maxZoom - tileZoom);
  const tileImageScale = TILE_IMAGE_SIZE / LEAFLET_TILE_SIZE;
  return {
    x: (maxZoomPixel.x / leafletScale) * tileImageScale,
    y: (maxZoomPixel.y / leafletScale) * tileImageScale,
  };
}

function maxZoomPixelToTileImagePixel(pixel, region, tileZoom) {
  const leafletScale = 2 ** (region.maxZoom - tileZoom);
  const tileImageScale = TILE_IMAGE_SIZE / LEAFLET_TILE_SIZE;
  return {
    x: (pixel[0] / leafletScale) * tileImageScale,
    y: (pixel[1] / leafletScale) * tileImageScale,
  };
}

function tileImagePixelToSamplePixel(pixel, centerPixel) {
  return {
    x: SAMPLE_IMAGE_WIDTH / 2 + pixel.x - centerPixel.x,
    y: SAMPLE_IMAGE_HEIGHT / 2 + pixel.y - centerPixel.y,
  };
}

function samplePixelToWorkPixel(pixel) {
  return {
    x: pixel.x * SAMPLE_TO_WORK_SCALE,
    y: pixel.y * SAMPLE_TO_WORK_SCALE,
  };
}

function tileImagePixelToWorkPixel(pixel, centerPixel) {
  return samplePixelToWorkPixel(tileImagePixelToSamplePixel(pixel, centerPixel));
}

function workPixelToOgPixel(pixel) {
  return {
    x: pixel.x,
    y: pixel.y - WORK_IMAGE_CROP_TOP,
  };
}

function tileImagePixelToOgPixel(pixel, centerPixel) {
  return workPixelToOgPixel(tileImagePixelToWorkPixel(pixel, centerPixel));
}

function getOgTileZoom(region) {
  return Math.min(3, region.maxZoom);
}

async function addTileComposite(composites, regionKey, tileZoom, centerPixel, sourceTier, offsetX, offsetY, suffixOverride) {
  const tileX = Math.floor((centerPixel.x + offsetX) / TILE_IMAGE_SIZE);
  const tileY = Math.floor((centerPixel.y + offsetY) / TILE_IMAGE_SIZE);
  const suffix = suffixOverride ?? tileSuffixForTier(sourceTier);
  const tilePath = path.resolve(CLIPS_DIR, regionKey, String(tileZoom), `${tileX}_${tileY}${suffix}.webp`);
  if (!(await pathExists(tilePath))) return false;
  const left = Math.round(SAMPLE_IMAGE_WIDTH / 2 + tileX * TILE_IMAGE_SIZE - centerPixel.x);
  const top = Math.round(SAMPLE_IMAGE_HEIGHT / 2 + tileY * TILE_IMAGE_SIZE - centerPixel.y);
  composites.push({ input: tilePath, left, top });
  return true;
}

async function labelCompositeInputs(point, centerPixel, tileZoom) {
  const inputs = [];
  const labels = point.mapLabels ?? [];
  for (const label of labels) {
    if (label.type !== 'site') continue;
    const text = resolveLabelTextWithFallback(point.regionLocale, point.fallbackRegionLocale, point.regionCode, label);
    if (!text) continue;
    const labelPixel = maxZoomPixelToTileImagePixel(label.point, point.region, tileZoom);
    const { x, y } = tileImagePixelToOgPixel(labelPixel, centerPixel);
    const input = labelSvg(text, label.type);
    const metadata = await sharp(input).metadata();
    const width = metadata.width ?? 141;
    const height = metadata.height ?? 44;
    if (
      x - width / 2 < 0
      || x + width / 2 > IMAGE_WIDTH
      || y + height / 2 < 0
      || y - height / 2 > IMAGE_HEIGHT
    ) {
      continue;
    }
    inputs.push({
      input,
      left: Math.round(x - width / 2),
      top: Math.round(y - height / 2),
    });
  }
  return inputs;
}

async function generateOgImage(point) {
  const region = point.region;
  const tileZoom = getOgTileZoom(region);
  const centerPixel = markerToTileImagePixel(point.marker, region, tileZoom);
  const markerCenter = tileImagePixelToOgPixel(centerPixel, centerPixel);
  const mainTileComposites = [];
  const layerTileComposites = [];
  const offsets = getOgTileOffsets();
  const suffix = tileSuffixForTier(point.marker.tier);
  for (const [x, y] of offsets) {
    await addTileComposite(mainTileComposites, point.regionKey, tileZoom, centerPixel, 0, x, y, '');
    if (suffix) {
      await addTileComposite(layerTileComposites, point.regionKey, tileZoom, centerPixel, point.marker.tier, x, y);
    }
  }

  const mapTileComposites = suffix
    ? [{
        input: await sharp({
          create: {
            width: SAMPLE_IMAGE_WIDTH,
            height: SAMPLE_IMAGE_HEIGHT,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          },
        })
          .composite(mainTileComposites)
          .modulate({ brightness: 0.5 })
          .png()
          .toBuffer(),
        left: 0,
        top: 0,
      }, ...layerTileComposites]
    : mainTileComposites;

  const sampleBackgroundBuffer = await sharp(await createMapPatternSampleBackground())
    .composite(mapTileComposites)
    .jpeg({ quality: 90 })
    .toBuffer();
  const workBackgroundBuffer = await sharp(sampleBackgroundBuffer)
    .resize(WORK_IMAGE_WIDTH, WORK_IMAGE_HEIGHT, { fit: 'fill' })
    .jpeg({ quality: 90 })
    .toBuffer();
  const iconPath = await resolveIconPath(point.typeInfo);
  const logoInput = await brandCompositeInput();
  const labelInputs = await labelCompositeInputs(point, centerPixel, tileZoom);
  const markerInputs = await markerCompositeInputs({ ...point, overlayCenter: markerCenter }, iconPath);
  const maskedWorkBuffer = await applyWorkMapMask(workBackgroundBuffer);
  const croppedBuffer = await sharp(maskedWorkBuffer)
    .composite([...labelInputs, ...markerInputs])
    .extract({
      left: 0,
      top: WORK_IMAGE_CROP_TOP,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  const outputBuffer = await sharp(croppedBuffer)
    .composite(logoInput ? [logoInput] : [])
    .jpeg({ quality: 80 })
    .toBuffer();
  await fs.writeFile(point.ogImagePath, outputBuffer);
}

async function generateFallbackOgImage(point) {
  const iconPath = await resolveIconPath(point.typeInfo);
  const logoInput = await brandCompositeInput();
  const markerInputs = await markerCompositeInputs(point, iconPath);
  const maskedWorkBuffer = await applyWorkMapMask(await createMapPatternBackground());
  const croppedBackground = await sharp(maskedWorkBuffer)
    .composite(markerInputs)
    .extract({
      left: 0,
      top: WORK_IMAGE_CROP_TOP,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    })
    .jpeg({ quality: 90 })
    .toBuffer();
  const outputBuffer = await sharp(croppedBackground)
    .composite(logoInput ? [logoInput] : [])
    .jpeg({ quality: 80 })
    .toBuffer();
  await fs.writeFile(point.ogImagePath, outputBuffer);
}

function buildPointHtml(point) {
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

function buildSitemap(urls) {
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

function buildSitemapIndex(files) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${files.map((file) => `  <sitemap><loc>${xml(`${siteUrl}/${file}`)}</loc></sitemap>`).join('\n')}
</sitemapindex>
`;
}

function buildRobots() {
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

async function writePreviewFile(points) {
  await fs.mkdir(path.dirname(workerPreviewFile), { recursive: true });
  if (workerPreviewFormat === 'json') {
    await fs.writeFile(workerPreviewFile, `${JSON.stringify(previewData(points), null, 2)}\n`);
    return;
  }
  await fs.writeFile(workerPreviewFile, previewTs(points));
}

async function loadBuildState(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SEO_STATE_VERSION || typeof parsed.entries !== 'object') return { version: SEO_STATE_VERSION, entries: {} };
    return parsed;
  } catch {
    return { version: SEO_STATE_VERSION, entries: {} };
  }
}

async function writeBuildState(file, state) {
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  const temporaryFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.writeFile(temporaryFile, contents);
    await fs.rename(temporaryFile, file);
  } finally {
    await fs.rm(temporaryFile, { force: true });
  }
}

function mergeScopedBuildState(previousState, nextState, activeTokens) {
  if (!hasExplicitPointScope) return nextState;
  const retainedEntries = Object.fromEntries(
    Object.entries(previousState.entries ?? {})
      .filter(([token]) => activeTokens.has(token)),
  );
  return {
    ...nextState,
    entries: {
      ...retainedEntries,
      ...nextState.entries,
    },
  };
}

async function pruneStaleFiles(dir, extension, activeTokens, previousTokens) {
  const staleTokens = [...previousTokens].filter((token) => !activeTokens.has(token));
  await Promise.all(staleTokens.map(async (token) => {
    const file = path.resolve(dir, `${token}${extension}`);
    try {
      await fs.rm(file, { force: true });
    } catch {
      // ignore
    }
  }));
}

async function removeLegacyFlatPointFiles() {
  const files = await safeReaddir(SEO_POINTS_ROOT_DIR);
  await Promise.all(files
    .filter((file) => POINT_HTML_FILE_PATTERN.test(file))
    .map((file) => fs.rm(path.resolve(SEO_POINTS_ROOT_DIR, file), { force: true })));
}

function buildTilePathsForPoint(point) {
  const region = point.region;
  const tileZoom = getOgTileZoom(region);
  const centerPixel = markerToTileImagePixel(point.marker, region, tileZoom);
  const suffix = tileSuffixForTier(point.marker.tier);
  const offsets = getOgTileOffsets();
  return offsets.flatMap(([x, y]) => {
    const tileX = Math.floor((centerPixel.x + x) / TILE_IMAGE_SIZE);
    const tileY = Math.floor((centerPixel.y + y) / TILE_IMAGE_SIZE);
    const main = path.resolve(CLIPS_DIR, point.regionKey, String(tileZoom), `${tileX}_${tileY}.webp`);
    if (!suffix) return [main];
    const layer = path.resolve(CLIPS_DIR, point.regionKey, String(tileZoom), `${tileX}_${tileY}${suffix}.webp`);
    return [main, layer];
  });
}

async function generateOgImagesInParallel(points, onGenerated) {
  if (points.length === 0) return;

  const workerCount = Math.min(seoOgConcurrency, points.length);
  let nextIndex = 0;
  let completed = 0;

  console.log(`[seo] generating point images in parallel: concurrency=${workerCount}`);

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < points.length) {
      const point = points[nextIndex];
      nextIndex += 1;
      await generateOgImage(point);
      completed += 1;
      const completedCount = completed;
      if (completedCount === points.length || completedCount % 250 === 0) {
        console.log(`[seo] generated ${completedCount}/${points.length} point images`);
      }
      await onGenerated?.(point, completedCount);
    }
  });

  await Promise.all(workers);
}

async function buildOgWorklist(points, sharedOgFingerprints, previousOgState) {
  const worklist = [];
  const nextState = {
    version: SEO_STATE_VERSION,
    fingerprintVersion: FILE_FINGERPRINT_VERSION,
    renderVersion: OG_RENDER_SIGNATURE_VERSION,
    entries: {},
  };
  for (const point of points) {
    const signature = await buildOgSignature(point, sharedOgFingerprints);
    nextState.entries[point.token] = { signature };
    if (
      shouldForceImages
      || shouldForceAllImages
      || previousOgState.entries?.[point.token]?.signature !== signature
      || !(await pathExists(point.ogImagePath))
    ) {
      worklist.push(point);
    }
  }
  return { worklist, nextState };
}

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

  const [
    typeMap,
    regionMap,
    labelData,
    localeLabels,
    fallbackLabels,
    regionLocale,
    fallbackRegionLocale,
    localeBodyTypes,
    fallbackBodyTypes,
  ] = await Promise.all([
    readJson(MARKER_TYPE_FILE),
    readJson(REGION_FILE),
    safeReadJson(LABEL_FILE, { regions: {} }),
    loadLocaleLabels(defaultLocale),
    loadLocaleLabels('en-US'),
    loadRegionLocale(defaultLocale),
    loadRegionLocale('en-US'),
    loadBodyTypes(defaultLocale),
    loadBodyTypes('en-US'),
  ]);
  const regionBySubregion = subregionRegionMap(regionMap);
  const labelRegions = labelsByRegion(labelData);
  const labels = localeLabels;
  const bodyTypes = new Set([...fallbackBodyTypes, ...localeBodyTypes]);

  let markers = deduplicateMarkersByPositionAndType(await loadMarkers(typeMap));
  markers = markers
    .map((marker) => {
      const token = encodePointIdToken(marker.id);
      const decoded = token ? decodePointIdToken(token) : null;
      const typeInfo = typeMap[marker.type];
      const regionKey = regionBySubregion.get(marker.subregId);
      if (!token || decoded !== marker.id || !typeInfo || !regionKey || !regionMap[regionKey]) return null;
      const title = normalize(labels[marker.type] ?? fallbackLabels[marker.type] ?? typeInfo.name ?? marker.type);
      const hasBody = bodyTypes.has(marker.type);
      const basePoint = {
        marker,
        regionKey,
        region: regionMap[regionKey],
      };
      const place = resolvePointPlace(basePoint, labelRegions, regionLocale, fallbackRegionLocale);
      const placeText = resolvePointPlaceText(place);
      const englishPlaceText = resolveEnglishPointPlaceText(place);
      const description = langKey === 'zh'
        ? `${placeText ? `位于${placeText}附近的` : ''}${title}。在 Open Endfield Map 中查看该点位附近地图与交互式导航。`
        : `${title}${englishPlaceText ? ` near ${englishPlaceText}.` : '.'} Get more info and interactive navigation on Open Endfield Map.`;
      const canonicalUrl = pointPageUrl(token);
      const ogImageUrl = pointOgUrl(token);
      const regionCode = mapRegionKeyToLocaleCode(regionKey);
      const documentTitle = resolveDocumentTitle({ title, place });
      return {
        marker,
        token,
        title,
        documentTitle,
        description,
        regionKey,
        region: regionMap[regionKey],
        regionCode,
        regionLocale,
        fallbackRegionLocale,
        mapLabels: regionCode ? labelRegions.get(regionCode) ?? [] : [],
        place,
        typeInfo,
        hasBody,
        indexable: shouldIndexPoint(typeInfo, hasBody),
        canonicalUrl,
        ogImageUrl,
        spaUrl: spaPointUrl(token),
        shareUrl: pointShareUrl(token),
        htmlPath: path.resolve(SEO_POINTS_OUT_DIR, `${token}.html`),
        ogImagePath: path.resolve(seoOgOutputDir, `${token}.jpg`),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.token.localeCompare(b.token));

  const allMarkerTokens = new Set(markers.map((point) => point.token));

  if (seoTokens.length > 0) {
    const tokenSet = new Set(seoTokens);
    markers = markers.filter((point) => tokenSet.has(point.token));
  }

  if (Number.isFinite(seoLimit) && seoLimit > 0) {
    markers = markers.slice(0, seoLimit);
  }

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
