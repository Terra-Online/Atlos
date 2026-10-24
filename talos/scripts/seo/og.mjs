import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import fsSync from 'node:fs';
import {
  useMarkerRasterCache, WORK_IMAGE_WIDTH, WORK_IMAGE_HEIGHT, HARMONY_FONT_DIR, ROOT,
  LOCAL_FONT_DIR, sharpConcurrency, SAMPLE_IMAGE_WIDTH, TILE_IMAGE_SIZE, SAMPLE_IMAGE_HEIGHT,
  ITEM_DIR, MARKER_ICON_DIR, OG_RENDER_SIGNATURE_VERSION, OG_RENDER_RECIPE, buildTarget,
  defaultLocale, langKey, htmlLang, HARMONY_FONT_FILE, HARMONY_SC_FONT_FILE, HARMONY_TC_FONT_FILE,
  IMAGE_WIDTH, IMAGE_HEIGHT, MARKER_RENDER_SCALE, MAP_PATTERN_FILE, OBSERVATOR_LOGO_FILE,
  COINBASE_DISPLAY_FONT_FILE, UDSHINGO_HK_DB_FONT_FILE, ZILLA_SLAB_HIGHLIGHT_FONT_FILE,
  NOVECENTO_SLAB_BOLD_FONT_FILE, LEAFLET_TILE_SIZE, SAMPLE_TO_WORK_SCALE, WORK_IMAGE_CROP_TOP,
  CLIPS_DIR, useLegacyOgPipeline, seoOgConcurrency, SEO_STATE_VERSION, FILE_FINGERPRINT_VERSION,
  shouldForceImages, shouldForceAllImages,
} from './config.mjs';
import { pathExists } from './io.mjs';
import { escapeXmlAttribute, normalize, html } from './text.mjs';
import { resolveLabelTextWithFallback, markerToPixel } from './content.mjs';
import { hashSignature, fileFingerprint, collectFingerprints } from './state.mjs';

let sharp;
const renderCache = new Map();
const pathExistsCache = new Map();
const iconPathCache = new Map();

// Store in-flight promises too: concurrent points share the same render work.
function cachedRender(key, render) {
  if (!renderCache.has(key)) renderCache.set(key, render());
  return renderCache.get(key);
}

function markerIconInput(file, size, fit) {
  return cachedRender(`icon:${file}:${size}:${fit}`, () =>
    sharp(file).resize(size, size, { fit }).png().toBuffer());
}

function markerSvgInput(key, svg) {
  if (!useMarkerRasterCache) return Buffer.from(svg);
  return cachedRender(`marker-svg:${key}`, () =>
    sharp(Buffer.from(svg)).png().toBuffer());
}

function cachedPathExists(file) {
  if (!pathExistsCache.has(file)) {
    pathExistsCache.set(file, pathExists(file));
  }
  return pathExistsCache.get(file);
}

function workMapMask() {
  return cachedRender('mask:work', () => Buffer.from(`
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
  `));
}

function workMapMaskInput() {
  return cachedRender('mask:work:raster', () => sharp(workMapMask()).png().toBuffer());
}

function rawOptions(image) {
  return {
    width: image.info.width,
    height: image.info.height,
    channels: image.info.channels,
  };
}

function sharpFromRaw(image) {
  return sharp(image.data, { raw: rawOptions(image) });
}

async function toRaw(image) {
  return image.raw().toBuffer({ resolveWithObject: true });
}

export async function configureSharpFonts() {
  if (sharp) return;

  const fontconfigDir = path.resolve(os.tmpdir(), 'talos-seo-fontconfig');
  const fontconfigCacheDir = path.resolve(fontconfigDir, 'cache');
  const fontconfigFile = path.resolve(fontconfigDir, 'fonts.conf');
  await fs.mkdir(fontconfigCacheDir, { recursive: true });
  await fs.writeFile(fontconfigFile, `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${escapeXmlAttribute(HARMONY_FONT_DIR)}</dir>
  <dir>${escapeXmlAttribute(path.resolve(ROOT, 'src/assets/fonts_original/UD_ShinGo'))}</dir>
  <dir>${escapeXmlAttribute(path.resolve(ROOT, 'src/assets/fonts_original/Harmony'))}</dir>
  <dir>${escapeXmlAttribute(LOCAL_FONT_DIR)}</dir>
  <cachedir>${escapeXmlAttribute(fontconfigCacheDir)}</cachedir>
</fontconfig>
`);

  process.env.FONTCONFIG_FILE = fontconfigFile;
  process.env.FONTCONFIG_PATH = fontconfigDir;

  const sharpModule = await import('sharp');
  sharp = sharpModule.default;
  sharp.concurrency(sharpConcurrency);
}

function getOgTileOffsets() {
  // The window spans three tile widths horizontally and two vertically.
  // One extra candidate per axis handles arbitrary marker-to-tile alignment;
  // the previous ranges added a full empty tile on both sides.
  const offsets = [];
  const xCount = Math.ceil(SAMPLE_IMAGE_WIDTH / TILE_IMAGE_SIZE) + 1;
  const yCount = Math.ceil(SAMPLE_IMAGE_HEIGHT / TILE_IMAGE_SIZE) + 1;
  for (let y = 0; y < yCount; y += 1) {
    for (let x = 0; x < xCount; x += 1) {
      offsets.push([
        -SAMPLE_IMAGE_WIDTH / 2 + x * TILE_IMAGE_SIZE,
        -SAMPLE_IMAGE_HEIGHT / 2 + y * TILE_IMAGE_SIZE,
      ]);
    }
  }
  return offsets;
}

function tileSuffixForTier(tier) {
  const rounded = Math.trunc(tier);
  if (rounded === 0) return '';
  return `_${rounded < 0 ? 'b' : 'l'}${Math.abs(rounded)}`;
}

async function resolveIconPath(typeInfo) {
  const key = typeInfo.icon ?? typeInfo.key;
  const cacheKey = `${key}:${typeInfo.key}`;
  if (iconPathCache.has(cacheKey)) return iconPathCache.get(cacheKey);
  const result = (async () => {
    const candidates = [
      path.resolve(ITEM_DIR, `${key}.webp`),
      path.resolve(MARKER_ICON_DIR, `${key}.webp`),
      path.resolve(ITEM_DIR, `${typeInfo.key}.webp`),
      path.resolve(MARKER_ICON_DIR, `${typeInfo.key}.webp`),
    ];
    for (const candidate of candidates) {
      if (await cachedPathExists(candidate)) return candidate;
    }
    return null;
  })();
  iconPathCache.set(cacheKey, result);
  return result;
}

export async function buildOgSignature(point, sharedFingerprints) {
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

export async function buildFallbackOgSignature(point, sharedFingerprints) {
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
  return { width, height, input: Buffer.from(`
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
  `) };
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
    const frameSvg = `
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
      </svg>
    `;
    const inputs = [{
      input: await markerSvgInput(`frame:${tierLabel}`, frameSvg),
      left: Math.round(framedMarkerCenter.x - size / 2),
      top: Math.round(framedMarkerCenter.y - size / 2),
    }];
    if (iconPath) {
      inputs.push({
        input: await markerIconInput(iconPath, Math.round(imageSize), 'cover'),
        left: Math.round(framedMarkerCenter.x - imageSize / 2),
        top: Math.round(framedMarkerCenter.y - imageSize / 2),
      });
    }
    if (tierLabel) {
      inputs.push({
        input: await markerSvgInput(`framed-badge:${tierLabel}`, `
          <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="${3.125 * scale}" flood-color="#000000" flood-opacity="0.85"/>
            </filter>
            <rect x="${badgeLeft}" y="${badgeTop}" width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${tierBadge.background}" filter="url(#shadow)"/>
            <text x="${badgeLeft + badgeWidth / 2}" y="${badgeTop + badgeHeight * 0.74}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${11 * scale}" font-weight="800" fill="${tierBadge.color}">${html(tierLabel)}</text>
          </svg>
        `),
        left: Math.round(framedMarkerCenter.x - size / 2),
        top: Math.round(framedMarkerCenter.y - size / 2),
      });
    }
    return inputs;
  }

  const imageSize = Math.round(50 * MARKER_RENDER_SCALE);
  const inputs = [];
  if (iconPath) {
    inputs.push({
      input: await markerIconInput(iconPath, imageSize, 'contain'),
      left: Math.round(markerCenter.x - imageSize / 2),
      top: Math.round(markerCenter.y - imageSize / 2),
    });
  } else {
    const fallbackSize = Math.round(18 * MARKER_RENDER_SCALE);
    inputs.push({
      input: await markerSvgInput(
        `fallback:${fallbackSize}`,
        `<svg width="${fallbackSize}" height="${fallbackSize}" viewBox="0 0 ${fallbackSize} ${fallbackSize}" xmlns="http://www.w3.org/2000/svg"><rect width="${fallbackSize}" height="${fallbackSize}" fill="rgb(248,248,248)"/></svg>`,
      ),
      left: Math.round(markerCenter.x - fallbackSize / 2),
      top: Math.round(markerCenter.y - fallbackSize / 2),
    });
  }
  if (tierLabel) {
    const badgeWidth = Math.round(Math.max(18, 8 + tierLabel.length * 8) * MARKER_RENDER_SCALE);
    const badgeHeight = Math.round(16 * MARKER_RENDER_SCALE);
    inputs.push({
      input: await markerSvgInput(
        `badge:${tierLabel}`,
        `<svg width="${badgeWidth}" height="${badgeHeight}" viewBox="0 0 ${badgeWidth} ${badgeHeight}" xmlns="http://www.w3.org/2000/svg"><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="${1 * MARKER_RENDER_SCALE}" stdDeviation="${2 * MARKER_RENDER_SCALE}" flood-color="#000000" flood-opacity="0.65"/></filter><rect width="${badgeWidth}" height="${badgeHeight}" rx="${badgeHeight / 2}" fill="${tierBadge.background}" filter="url(#shadow)"/><text x="${badgeWidth / 2}" y="${badgeHeight * 0.74}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${11 * MARKER_RENDER_SCALE}" font-weight="800" fill="${tierBadge.color}">${html(tierLabel)}</text></svg>`,
      ),
      left: Math.round(markerCenter.x + imageSize / 2 - badgeWidth / 2),
      top: Math.round(markerCenter.y - imageSize / 2),
    });
  }
  return inputs;
}

function createMapPatternBackground() {
  return cachedRender('pattern:work', renderMapPatternBackground);
}

function createMapPatternRaw() {
  return cachedRender('pattern:work:raw', async () =>
    toRaw(sharp(await createMapPatternBackground())));
}

async function renderMapPatternBackground() {
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

function createMapPatternSampleBackground() {
  return cachedRender('pattern:sample', renderMapPatternSampleBackground);
}

function createMapPatternSampleRaw() {
  return cachedRender('pattern:sample:raw', async () =>
    toRaw(sharp(await createMapPatternSampleBackground())));
}

async function renderMapPatternSampleBackground() {
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
  return sharp(buffer)
    .composite([{ input: await workMapMaskInput(), left: 0, top: 0 }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

function brandCompositeInput() {
  return cachedRender('brand', renderBrandCompositeInput);
}

async function renderBrandCompositeInput() {
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
  if (!(await cachedPathExists(tilePath))) return false;
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
    const { input, width, height } = await cachedRender(
      `label:${label.type}:${text}`, () => labelSvg(text, label.type),
    );
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

async function generateLegacyOgImage(point) {
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

async function generateLegacyFallbackOgImage(point) {
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

export async function generateOgImage(point) {
  if (useLegacyOgPipeline) return generateLegacyOgImage(point);

  const region = point.region;
  const tileZoom = getOgTileZoom(region);
  const centerPixel = markerToTileImagePixel(point.marker, region, tileZoom);
  const markerCenter = tileImagePixelToOgPixel(centerPixel, centerPixel);
  const mainTileComposites = [];
  const layerTileComposites = [];
  const suffix = tileSuffixForTier(point.marker.tier);
  for (const [x, y] of getOgTileOffsets()) {
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

  const iconPath = await resolveIconPath(point.typeInfo);
  const logoInput = await brandCompositeInput();
  const labelInputs = await labelCompositeInputs(point, centerPixel, tileZoom);
  const markerInputs = await markerCompositeInputs({ ...point, overlayCenter: markerCenter }, iconPath);
  // Keep the tile stage lossless. The old pipeline encoded this intermediate
  // as JPEG before resizing and masking, which compounded image loss.
  const samplePattern = await createMapPatternSampleRaw();
  const sampleBackground = await toRaw(sharpFromRaw(samplePattern)
    .composite(mapTileComposites)
  );
  const workBackground = await toRaw(sharpFromRaw(sampleBackground)
    .resize(WORK_IMAGE_WIDTH, WORK_IMAGE_HEIGHT, { fit: 'fill' }));
  const maskedWork = await toRaw(sharpFromRaw(workBackground)
    .composite([{ input: await workMapMaskInput(), left: 0, top: 0 }])
  );
  const cropped = await toRaw(sharpFromRaw(maskedWork)
    .composite([...labelInputs, ...markerInputs])
    .extract({
      left: 0,
      top: WORK_IMAGE_CROP_TOP,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    }));
  let pipeline = sharpFromRaw(cropped);
  if (logoInput) pipeline = pipeline.composite([logoInput]);
  await fs.writeFile(point.ogImagePath, await pipeline.jpeg({ quality: 80 }).toBuffer());
}

export async function generateFallbackOgImage(point) {
  if (useLegacyOgPipeline) return generateLegacyFallbackOgImage(point);

  const iconPath = await resolveIconPath(point.typeInfo);
  const logoInput = await brandCompositeInput();
  const markerInputs = await markerCompositeInputs(point, iconPath);
  const workPattern = await createMapPatternRaw();
  const maskedWork = await toRaw(sharpFromRaw(workPattern)
    .composite([{ input: await workMapMaskInput(), left: 0, top: 0 }])
  );
  const cropped = await toRaw(sharpFromRaw(maskedWork)
    .composite(markerInputs)
    .extract({
      left: 0,
      top: WORK_IMAGE_CROP_TOP,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
    }));
  let pipeline = sharpFromRaw(cropped);
  if (logoInput) pipeline = pipeline.composite([logoInput]);
  await fs.writeFile(point.ogImagePath, await pipeline.jpeg({ quality: 80 }).toBuffer());
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

export async function generateOgImagesInParallel(points, onGenerated) {
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

export async function buildOgWorklist(points, sharedOgFingerprints, previousOgState) {
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
