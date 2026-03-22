import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT = path.resolve(__dirname, '..')

const MARKER_DIR = path.resolve(ROOT, 'src/data/marker/data')
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
  'tr-TR',
  'vi-VN',
  'zh-CN',
  'zh-HK',
  // Keep zh-TW docs for compatibility with legacy deep links and worker callers.
  'zh-TW',
]

const BODY_LOCALE_MAP = {
  'zh-HK': 'zh-TW',
}

const DOC_VERSION = 2

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
  const files = (await safeReadDir(MARKER_DIR)).filter((f) => f.endsWith('.json'))
  const all = []

  for (const file of files) {
    const json = await readJson(path.resolve(MARKER_DIR, file))
    if (!Array.isArray(json)) continue

    for (const marker of json) {
      if (!marker || typeof marker !== 'object') continue
      const typeId = String(marker.type ?? '')
      const markerId = String(marker.id ?? '')
      const position = marker.pos ?? {}
      const hasPos =
        Array.isArray(position) &&
        position.length >= 2 &&
        typeof position[0] === 'number' &&
        Number.isFinite(position[0]) &&
        typeof position[1] === 'number' &&
        Number.isFinite(position[1])
      const subregionId = String(marker.subregId ?? '')

      if (!typeId || !markerId || !typeMap[typeId] || !subregionId || !hasPos) {
        continue
      }

      all.push({
        markerId,
        typeId,
        subregionId,
        x: position[0],
        y: position[1],
      })
    }
  }

  return all
}

async function loadLocaleAlias(locale) {
  const file = path.resolve(LOCALE_DIR, `${locale}.json`)
  try {
    const data = await readJson(file)
    if (data && typeof data === 'object') {
      const markerType = data.markerType
      const markerTypeKey = markerType && typeof markerType === 'object' ? markerType.key : null
      if (markerTypeKey && typeof markerTypeKey === 'object') {
        return markerTypeKey
      }
    }
    return {}
  } catch {
    return {}
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

function buildMultilingualAliasMap(allAlias, typeMap) {
  const byType = new Map()

  for (const typeKey of Object.keys(typeMap)) {
    const set = new Set()
    const baseName = normalize(typeMap[typeKey]?.name ?? '')
    if (baseName) set.add(baseName)

    for (const locale of LANGS) {
      const alias = allAlias.get(locale) ?? {}
      const label = normalize(alias[typeKey] ?? '')
      if (label) set.add(label)
    }

    byType.set(typeKey, Array.from(set).join(' '))
  }

  return byType
}

function buildMarkerDocs(markers, typeMap, alias, localeBodyMap, enBodyMap, subregionRegionMap, multilingualAliasMap) {
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
    const title = normalize(alias[typeKey] ?? typeInfo?.name ?? typeKey)
    const aliases = joinUniqueNormalized(
      typeKey,
      typeInfo?.name ?? '',
      title,
      multilingualAliasMap.get(typeKey) ?? '',
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
  const multilingualAliasMap = buildMultilingualAliasMap(allAlias, typeMap)

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
      localeBody,
      enBodyByType,
      subregionRegionMap,
      multilingualAliasMap,
    )

    const file = path.resolve(OUT_DIR, `${locale}.json`)
    await fs.writeFile(file, JSON.stringify(docs), 'utf8')

    indexManifest.locales.push({
      locale,
      file: `${locale}.json`,
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
