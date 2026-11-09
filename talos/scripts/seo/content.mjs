import path from 'node:path';
import { loadEffectiveMarkers } from '../marker-data.mjs';
import { deduplicateMarkersByPositionAndType } from '../../src/data/marker/deduplication.js';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { safeReaddir, safeReadJson, readJson } from './io.mjs';
import {
  LOCALE_DIR, REGION_LOCALE_DIR, FILES_TEXT_DIR, langKey, SITE_NAME, POINT_SHARE_SHORT_ORIGIN,
  siteUrl, seoOgUrlBase, INDEXABLE_MAIN_CATEGORIES, INDEXABLE_SUB_CATEGORIES, MARKER_TYPE_FILE,
  REGION_FILE, LABEL_FILE, defaultLocale, SEO_POINTS_OUT_DIR, seoOgOutputDir, seoTokens, seoLimit,
} from './config.mjs';
import { normalize } from './text.mjs';

// Keep the browser's standalone TS codec as the source of truth on Node 20.
const { outputText } = ts.transpileModule(
  await readFile(new URL('../../src/services/routing/pointToken.ts', import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } },
);
const { encodePointIdToken, decodePointIdToken } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

async function resolveLocaleJsonFile(dir, locale) {
  const effectiveLocale = locale === 'zh-HK' ? 'zh-TW' : locale;
  const files = (await safeReaddir(dir)).filter((file) => file.endsWith('.json'));
  const exact = files.find((file) => file.replace(/\.json$/i, '') === effectiveLocale);
  if (exact) return path.resolve(dir, exact);
  const lower = effectiveLocale.toLowerCase();
  const insensitive = files.find((file) => file.replace(/\.json$/i, '').toLowerCase() === lower);
  return insensitive ? path.resolve(dir, insensitive) : path.resolve(dir, `${effectiveLocale}.json`);
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

export function resolveLabelTextWithFallback(regionBundle, fallbackBundle, regionCode, label) {
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

function shouldIndexPoint(typeInfo, hasBody) {
  const main = typeInfo?.category?.main ?? '';
  const sub = typeInfo?.category?.sub ?? '';
  return hasBody || INDEXABLE_MAIN_CATEGORIES.has(main) || INDEXABLE_SUB_CATEGORIES.has(sub);
}

export function markerToPixel(marker, region) {
  const scale = 2 ** region.coordZoom;
  return {
    x: marker.pos[1] * scale,
    y: -marker.pos[0] * scale,
  };
}

export async function loadPoints() {
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

  return { markers, allMarkerTokens };
}
