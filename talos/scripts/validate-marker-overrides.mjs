import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEffectiveMarkers, loadRawMarkers, readManualOverrides } from './marker-data.mjs';
import { validateManualOverrides } from '../src/data/marker/overrides.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (file) => JSON.parse(await fs.readFile(path.resolve(ROOT, file), 'utf8'));
const typeMap = await readJson('src/data/marker/type.json');
const regions = await readJson('src/data/map/region.json');
const subregionIds = new Set(Object.values(regions).flatMap((region) => region.subregions ?? []));
const document = await readManualOverrides();
const effectiveMarkers = await loadEffectiveMarkers({ typeMap, subregionIds });
const rawMarkers = await loadRawMarkers();
validateManualOverrides(document, rawMarkers, typeMap, subregionIds);

const manualReadme = await fs.readFile(path.resolve(ROOT, 'src/data/marker/manual/README.md'), 'utf8');
const changeLogStart = manualReadme.indexOf('| ID | Operation | Reason | Source | Updated at |');
if (changeLogStart < 0) throw new Error('Manual marker README is missing the change log table.');
const changeLogRows = manualReadme
  .slice(changeLogStart)
  .split('\n')
  .slice(2)
  .map((line) => line.trim())
  .filter((line) => line.startsWith('|') && !/^\|\s*-+/.test(line));
const changeLog = new Map();
for (const [index, row] of changeLogRows.entries()) {
  const columns = row.split('|').slice(1, -1).map((column) => column.trim());
  if (columns.length !== 5) throw new Error(`README change log row ${index + 1} must have five columns.`);
  const [id, operation, reason, source, updatedAt] = columns;
  const normalizedId = id.replace(/^`|`$/g, '');
  const normalizedOperation = operation.replace(/^`|`$/g, '');
  const normalizedSource = source.replace(/^\[.*\]\((.+)\)$/, '$1');
  const normalizedDate = updatedAt.replace(/^`|`$/g, '');
  if (!normalizedId || !normalizedOperation || !reason || !normalizedSource || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
    throw new Error(`README change log row ${index + 1} has missing or invalid metadata.`);
  }
  if (changeLog.has(normalizedId)) throw new Error(`Duplicate README change log ID: ${normalizedId}`);
  changeLog.set(normalizedId, { operation: normalizedOperation });
}
for (const entry of document) {
  const id = String(entry.id ?? '');
  const metadata = changeLog.get(id);
  if (!metadata) throw new Error(`Override ${id} is missing from the README change log.`);
  if (metadata.operation !== (entry.op ?? 'update')) throw new Error(`README operation mismatch for override ${id}.`);
}
for (const id of changeLog.keys()) {
  if (!document.some((entry) => String(entry.id ?? '') === id)) {
    throw new Error(`README change log contains stale marker ID: ${id}`);
  }
}
const counts = document.reduce((result, entry) => {
  const operation = entry.op ?? 'update';
  result[operation] = (result[operation] ?? 0) + 1;
  return result;
}, {});
console.log(`[marker-overrides] updates=${counts.update ?? 0} deletes=${counts.delete ?? 0} adds=${counts.add ?? 0}`);
console.log(`[marker-overrides] effective markers=${effectiveMarkers.length}`);
console.log('[marker-overrides] validation passed');
