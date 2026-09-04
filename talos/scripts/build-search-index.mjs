import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadEffectiveMarkers } from './marker-data.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const MARKER_TYPE_FILE = path.resolve(ROOT, 'src/data/marker/type.json')
const REGION_FILE = path.resolve(ROOT, 'src/data/map/region.json')
const LOCALE_DIR = path.resolve(ROOT, 'src/locale/data/game')
const FILES_TEXT_DIR = path.resolve(ROOT, 'public/files/text')
const OUT_DIR = path.resolve(ROOT, 'public/search/docs')

const LANGS = [
  'de-DE',
  'en-US',
  'es-ES',
  'fr-FR',
  'id-ID',
  'it-IT',
  'ja-JP',
  'ko-KR',
  'pt-BR',
  'ru-RU',
  'th-TH',
  'vi-VN',
  'zh-CN',
  'zh-HK',
  // Keep zh-TW docs for compatibility with legacy deep links and worker callers.
  'zh-TW',
]

const BODY_LOCALE_MAP = {
  'zh-HK': 'zh-TW',
}

const ALIAS_LOCALE_MAP = {
  'zh-HK': 'zh-TW',
}

const DOC_VERSION = 5
const DOC_FIELDS = [
  'docId',
  'pointId',
  'typeKey',
  'typeMain',
  'title',
  'aliases',
  'binderTokens',
  'binderDisplay',
  'regionKey',
  'subregionId',
  'body',
  'cjk',
]

const normalizeBinderKey = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/(^_|_$)/g, '')

const normalize = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\u0000/g, ' ')
    .trim()

const joinUniqueNormalized = (...parts) => {
  const seen = new Set()
  const merged = []
  for (const part of parts) {
    const clean = normalize(part)
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(clean)
  }
  return merged.join(' ')
}

const makeCjkField = (...inputs) => {
  const text = normalize(inputs.filter(Boolean).join(' '))
  if (!text) return ''
  const chars = Array.from(text).filter((ch) => /[\u3400-\u9fff]/.test(ch))
  if (!chars.length) return ''
  return chars.join(' ')
}

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw)
}

async function safeReadDir(dir) {
  try {
    return await fs.readdir(dir)
  } catch {
    return []
  }
}

async function loadTypeMap() {
  const typeJson = await readJson(MARKER_TYPE_FILE)
  if (!typeJson || typeof typeJson !== 'object') {
    throw new Error('Invalid marker type map')
  }
  return typeJson
}

async function loadSubregionRegionMap() {
  const regionJson = await readJson(REGION_FILE)
  if (!regionJson || typeof regionJson !== 'object') {
    throw new Error('Invalid region map')
  }

  const map = new Map()
  Object.entries(regionJson).forEach(([regionKey, value]) => {
    if (!value || typeof value !== 'object') return
    const subregions = value.subregions
    if (!Array.isArray(subregions)) return
    subregions.forEach((subregId) => {
      if (typeof subregId === 'string' && subregId) {
        map.set(subregId, regionKey)
      }
    })
  })

  return map
}

async function loadMarkers(typeMap) {
  const all = []
  const markers = await loadEffectiveMarkers({ typeMap })
  for (const marker of markers) {
    const { id: markerId, type: typeId, subregId: subregionId, pos: position } = marker
    const hasPos = Array.isArray(position) && position.length >= 2 && position.every((value) => typeof value === 'number' && Number.isFinite(value))
    if (!typeId || !markerId || !typeMap[typeId] || !subregionId || !hasPos) continue
    all.push({ markerId, typeId, subregionId, x: position[0], y: position[1] })
  }
  return all
}

async function loadLocaleAlias(locale) {
  const effective = ALIAS_LOCALE_MAP[locale] ?? locale
  const file = path.resolve(LOCALE_DIR, `${effective}.json`)
  try {
    const data = await readJson(file)
    if (data && typeof data === 'object') {
      const markerType = data.markerType
      const markerTypeKey = markerType && typeof markerType === 'object' ? markerType.key : null
      const fileCtgr = markerType && typeof markerType === 'object' ? markerType.FileCtgr : null
      const researchId = markerType && typeof markerType === 'object' ? markerType.researchId : null
      const drop = markerType && typeof markerType === 'object' ? markerType.drop : null
      if (markerTypeKey && typeof markerTypeKey === 'object') {
        return {
          markerTypeKey,
          fileCtgr: fileCtgr && typeof fileCtgr === 'object' ? fileCtgr : {},
          researchId: researchId && typeof researchId === 'object' ? researchId : {},
          drop: drop && typeof drop === 'object' ? drop : {},
        }
      }
    }
    return { markerTypeKey: {}, fileCtgr: {}, researchId: {}, drop: {} }
  } catch {
    return { markerTypeKey: {}, fileCtgr: {}, researchId: {}, drop: {} }
  }
}

async function loadAllLocaleAlias() {
  const map = new Map()
  for (const locale of LANGS) {
    map.set(locale, await loadLocaleAlias(locale))
  }
  return map
}

async function loadBodyText(locale) {
  const effective = BODY_LOCALE_MAP[locale] ?? locale
  const dir = path.resolve(FILES_TEXT_DIR, effective)
  const files = (await safeReadDir(dir)).filter((f) => f.endsWith('.json'))

  const byType = new Map()
  for (const file of files) {
    const key = file.replace(/\.json$/i, '')
    let text = ''
    try {
      const data = await readJson(path.resolve(dir, file))
      if (Array.isArray(data)) {
        text = normalize(data.join(' '))
      } else if (typeof data === 'string') {
        text = normalize(data)
      } else if (data && typeof data === 'object') {
        const parts = []
        for (const v of Object.values(data)) {
          if (typeof v === 'string') parts.push(v)
          if (Array.isArray(v)) parts.push(v.join(' '))
        }
        text = normalize(parts.join(' '))
      }
    } catch {
      text = ''
    }

    if (text) byType.set(key, text)
  }

  return byType
}

function getBodyForType(typeId, localeBodyMap, enBodyMap) {
  const localized = localeBodyMap.get(typeId)
  if (localized) return localized

  const english = enBodyMap.get(typeId)
  if (english) return english

  return ''
}

function compactDoc(doc) {
  return DOC_FIELDS.map((field) => doc[field] ?? '')
}

function buildMarkerDocs(markers, typeMap, alias, enAlias, localeBodyMap, enBodyMap, subregionRegionMap) {
  const docs = []
  const stats = {
    total: 0,
    withBody: 0,
    skippedInvalidType: 0,
  }

  for (const marker of markers) {
    const typeInfo = typeMap[marker.typeId]
    const typeKey = String(marker.typeId)
    if (!typeInfo || !typeKey) {
      stats.skippedInvalidType += 1
      continue
    }

    const typeMain = normalize(typeInfo?.category?.main ?? '')
    const title = normalize(alias.markerTypeKey?.[typeKey] ?? typeInfo?.name ?? typeKey)
    const englishTitle = normalize(enAlias.markerTypeKey?.[typeKey] ?? '')

    const fileCtgrRaw = normalize(typeInfo?.ctgr ?? '')
    const fileCtgrKey = normalizeBinderKey(fileCtgrRaw)
    const fileCtgrLabel = normalize(alias.fileCtgr?.[fileCtgrKey] ?? fileCtgrRaw)
    const englishFileCtgrLabel = normalize(enAlias.fileCtgr?.[fileCtgrKey] ?? '')

    const researchRaw = normalize(typeInfo?.rsch ?? '')
    const researchKey = normalizeBinderKey(researchRaw)
    const researchLabel = normalize(alias.researchId?.[researchKey] ?? researchRaw)
    const englishResearchLabel = normalize(enAlias.researchId?.[researchKey] ?? '')

    const dropRaw = normalize(typeInfo?.drop ?? '')
    const dropKey = normalizeBinderKey(dropRaw)
    const dropLabel = normalize(alias.drop?.[dropKey] ?? dropRaw)
    const englishDropLabel = normalize(enAlias.drop?.[dropKey] ?? '')

    const binderTokens = joinUniqueNormalized(
      fileCtgrRaw,
      fileCtgrKey,
      fileCtgrLabel,
      englishFileCtgrLabel,
      researchRaw,
      researchKey,
      researchLabel,
      englishResearchLabel,
      dropRaw,
      dropKey,
      dropLabel,
      englishDropLabel,
    )

    const binderDisplay = researchLabel || fileCtgrLabel || dropLabel || ''
    const aliases = joinUniqueNormalized(
      typeKey,
      typeInfo?.name ?? '',
      title,
      englishTitle,
      fileCtgrRaw,
      fileCtgrLabel,
      englishFileCtgrLabel,
      researchRaw,
      researchLabel,
      englishResearchLabel,
      dropRaw,
      dropLabel,
      englishDropLabel,
    )
    const body = getBodyForType(marker.typeId, localeBodyMap, enBodyMap)
    const cjk = makeCjkField(title, aliases, body)
    const regionKey = String(subregionRegionMap.get(marker.subregionId) ?? 'Valley_4')

    docs.push({
      docId: `${marker.markerId}@@${marker.subregionId}`,
      pointId: marker.markerId,
      typeKey,
      typeMain,
      title,
      aliases,
      binderTokens,
      binderDisplay,
      regionKey,
      subregionId: marker.subregionId,
      body,
      cjk,
    })

    stats.total += 1
    if (body) stats.withBody += 1
  }

  return { docs, stats }
}

async function build() {
  await fs.mkdir(OUT_DIR, { recursive: true })

  const typeMap = await loadTypeMap()
  const subregionRegionMap = await loadSubregionRegionMap()
  const markers = await loadMarkers(typeMap)
  const allAlias = await loadAllLocaleAlias()
  const enAlias = allAlias.get('en-US') ?? { markerTypeKey: {}, fileCtgr: {}, researchId: {}, drop: {} }

  const enBodyByType = await loadBodyText('en-US')
  const localizedBodyMap = new Map()
  localizedBodyMap.set('en-US', enBodyByType)

  for (const locale of LANGS) {
    if (locale === 'en-US') continue
    localizedBodyMap.set(locale, await loadBodyText(locale))
  }

  const indexManifest = {
    version: DOC_VERSION,
    locales: [],
    builtAt: new Date().toISOString(),
  }

  for (const locale of LANGS) {
    const alias = allAlias.get(locale) ?? {}
    const localeBody = localizedBodyMap.get(locale) ?? new Map()
    const { docs, stats } = buildMarkerDocs(
      markers,
      typeMap,
      alias,
      enAlias,
      localeBody,
      enBodyByType,
      subregionRegionMap,
    )

    const file = path.resolve(OUT_DIR, `${locale}.json`)
    const serializedDocs = JSON.stringify(docs.map(compactDoc))
    const revision = createHash('sha256').update(serializedDocs).digest('hex').slice(0, 16)
    await fs.writeFile(file, serializedDocs, 'utf8')

    indexManifest.locales.push({
      locale,
      file: `${locale}.json`,
      revision,
      format: 'array',
      fields: DOC_FIELDS,
      stats,
    })

    console.log(
      `[search-index:${locale}] docs=${stats.total}, withBody=${stats.withBody}, skippedInvalidType=${stats.skippedInvalidType}`,
    )
  }

  await fs.writeFile(path.resolve(OUT_DIR, 'index.json'), JSON.stringify(indexManifest), 'utf8')
  console.log(`[search-index] wrote ${LANGS.length} locale files to public/search/docs`) 
}

build().catch((err) => {
  console.error('[search-index] build failed')
  console.error(err)
  process.exitCode = 1
})
