import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeArchiveContract } from '../apps/intel/src/data/archiveContract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTEL_SRC = path.resolve(ROOT, 'apps/intel/src');
const GENERATED = path.resolve(INTEL_SRC, 'data/generated');
const ICONS = path.resolve(INTEL_SRC, 'assets/archive-icons');
const GAME_LOCALES = path.resolve(INTEL_SRC, 'locale/data/game');
const MARKERS = path.resolve(ROOT, 'src/data/marker/data');
const LOCALES = ['de-DE', 'en-US', 'es-ES', 'fr-FR', 'id-ID', 'it-IT', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU', 'th-TH', 'vi-VN', 'zh-CN', 'zh-TW'];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const readJson = (file) => fs.readJson(path.resolve(file));
const contract = decodeArchiveContract(await readJson(path.resolve(GENERATED, 'archive_contract.json')));

const markerById = new Map();
for (const file of (await fs.readdir(MARKERS)).filter((name) => name.endsWith('.json'))) {
  const level = path.basename(file, '.json');
  for (const row of await readJson(path.resolve(MARKERS, file))) {
    markerById.set(String(row[0]), { level, type: String(row[5]) });
  }
}
for (const row of contract.filter((item) => item.acquisition.method === 'map')) {
  const marker = markerById.get(String(row.acquisition.pointId));
  assert(marker, `Map archive ${row.id} points to missing marker ${row.acquisition.pointId}.`);
  assert(marker.type === row.id, `Map archive ${row.id} points to marker type ${marker.type}.`);
}

const iconFiles = (await fs.readdir(ICONS)).filter((file) => file.endsWith('.webp'));
const iconKeys = new Set(contract.map((row) => row.iconKey));
assert(iconFiles.length === iconKeys.size, `Expected ${iconKeys.size} WebP icons, got ${iconFiles.length}.`);
for (const icon of iconKeys) assert(iconFiles.includes(`${icon}.webp`), `Missing bound icon ${icon}.webp.`);

const localeKeys = [];
for (const locale of LOCALES) {
  const values = await readJson(path.resolve(GAME_LOCALES, `${locale}.json`));
  localeKeys.push(Object.keys(values).sort());
  assert(JSON.stringify(Object.keys(values.category ?? {}).sort()) === JSON.stringify(['collection', 'digital', 'document', 'media', 'paper', 'report']), `Intel category keys are invalid for ${locale}.`);
  assert(JSON.stringify(Object.keys(values.group ?? {}).sort()) === JSON.stringify(['central', 'intel', 'media']), `Intel group keys are invalid for ${locale}.`);
  for (const row of contract) {
    assert(typeof values[row.id] === 'string' && values[row.id].trim(), `Missing archive title ${row.id} for ${locale}.`);
  }
}
assert(localeKeys.every((keys) => JSON.stringify(keys) === JSON.stringify(localeKeys[0])), 'Intel game locale key sets do not match.');

const staleFiles = ['archive_acquisition_contract.json', 'archive_acquisition_contract.schema.json', 'archive_display_contract.json', 'archive_point_links.json', 'archive_icon_bindings.json', 'manifest.json'];
for (const file of staleFiles) assert(!(await fs.pathExists(path.resolve(GENERATED, file))), `Stale generated file remains: ${file}`);

console.log(`[validate-intel-data] ${contract.length} archive rows, ${contract.filter((row) => row.acquisition.method === 'map').length} map joins, ${iconKeys.size} icons, ${LOCALES.length} locales`);
