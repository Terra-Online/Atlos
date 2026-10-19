import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const sourcePath = 'talos/src/locale/data/ui/en-US.json'
const localeDir = resolve(root, 'talos/src/locale/data/ui')
const outputDir = resolve(root, '.crowdin-seed')
const outputLocaleDir = resolve(outputDir, 'talos/src/locale/data/ui')
const configPath = resolve(root, '.crowdin-seed.yml')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readGitJson(revision, path) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${revision}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }))
  } catch {
    return null
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function collectNewPaths(current, previous, path = [], result = []) {
  if (!isObject(current)) {
    if (previous === undefined) result.push(path)
    return result
  }

  for (const [key, value] of Object.entries(current)) {
    const nextPath = [...path, key]
    const previousValue = isObject(previous) ? previous[key] : undefined
    collectNewPaths(value, previousValue, nextPath, result)
  }

  return result
}

function getAtPath(value, path) {
  return path.reduce((current, key) => current?.[key], value)
}

function setAtPath(target, path, value) {
  let current = target
  for (const key of path.slice(0, -1)) {
    current[key] ??= {}
    current = current[key]
  }
  current[path.at(-1)] = value
}

function parseKeyPath(value) {
  return value.split('.').map((part) => part.trim()).filter(Boolean)
}

function writeOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, { flag: 'a' })
  }
}

const currentSource = readJson(resolve(root, sourcePath))
const eventBase = process.env.BASE_SHA
const requestedBase = eventBase && !/^0+$/.test(eventBase) ? eventBase : 'HEAD^'
const requestedSource = readGitJson(requestedBase, sourcePath)
const baseRevision = requestedSource ? requestedBase : 'HEAD^'
const previousSource = requestedSource ?? readGitJson(baseRevision, sourcePath)

if (!previousSource) {
  writeOutput('has_new_keys', 'false')
  throw new Error(`Unable to read the previous source file at ${baseRevision}; refusing to upload a full locale baseline.`)
}

const newPaths = collectNewPaths(currentSource, previousSource)
const explicitPaths = (process.env.SEED_KEYS ?? '')
  .split(',')
  .map(parseKeyPath)
  .filter((path) => path.length > 0 && getAtPath(currentSource, path) !== undefined)
const seedPaths = [...new Map(
  [...newPaths, ...explicitPaths].map((path) => [path.join('.'), path]),
).values()]

rmSync(outputDir, { recursive: true, force: true })
rmSync(configPath, { force: true })

if (seedPaths.length === 0) {
  writeOutput('has_new_keys', 'false')
  console.log('No new source keys; skipping seeded translation upload.')
  process.exit(0)
}

mkdirSync(outputLocaleDir, { recursive: true })
writeFileSync(resolve(outputLocaleDir, 'en-US.json'), `${JSON.stringify(currentSource, null, 2)}\n`)
const localeFiles = readdirSync(localeDir).filter((file) => file.endsWith('.json') && file !== 'en-US.json')
let uploadedFiles = 0

for (const file of localeFiles) {
  const locale = readJson(resolve(localeDir, file))
  const seed = {}
  for (const path of seedPaths) {
    const value = getAtPath(locale, path)
    if (value !== undefined) setAtPath(seed, path, value)
  }

  if (Object.keys(seed).length === 0) continue
  writeFileSync(resolve(outputLocaleDir, file), `${JSON.stringify(seed, null, 2)}\n`)
  uploadedFiles += 1
}

if (uploadedFiles === 0) {
  writeOutput('has_new_keys', 'false')
  console.log(`Found ${seedPaths.length} source key(s), but no locale contains a seed value.`)
  process.exit(0)
}

const config = `"project_id_env": "CROWDIN_PROJECT_ID"
"api_token_env": "CROWDIN_PERSONAL_TOKEN"
"base_path": ".crowdin-seed"
"preserve_hierarchy": true

export_languages:
  - ar
  - de
  - el
  - es-ES
  - fr
  - hi
  - id
  - it
  - ja
  - ko
  - ms
  - pl
  - pt-BR
  - ru
  - sv-SE
  - th
  - tr
  - uk
  - vi
  - zh-CN
  - zh-HK

files:
  - source: /${sourcePath}
    translation: /talos/src/locale/data/ui/%locale%.json
    excluded_target_languages:
      - la-LA
    languages_mapping:
      locale:
        ar: ar-SA
        de: de-DE
        el: el-GR
        fr: fr-FR
        hi: hi-IN
        id: id-ID
        it: it-IT
        ja: ja-JP
        ko: ko-KR
        ms: ms-MY
        pl: pl-PL
        ru: ru-RU
        th: th-TH
        tr: tr-TR
        uk: uk-UA
        vi: vi-VN
`

writeFileSync(configPath, config)
writeOutput('has_new_keys', 'true')
console.log(`Prepared ${uploadedFiles} locale seed file(s) for ${seedPaths.length} source key(s).`)
