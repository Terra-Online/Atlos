import fs from 'node:fs/promises';
import path from 'node:path';
import { applyMarkerOverrides, validateManualOverrides } from '../src/data/marker/overrides.js';

export const MARKER_DIR = path.resolve(process.cwd(), 'src/data/marker/data');
export const MANUAL_OVERRIDE_FILE = path.resolve(process.cwd(), 'src/data/marker/manual/overrides.json');

const normalizeRawMarker = (raw, subregionId) => {
  const marker = Array.isArray(raw)
    ? { id: raw[0], z: raw[1], x: raw[2], y: raw[3], tier: raw[4], type: raw[5] }
    : raw;
  if (!marker || marker.id == null || marker.type == null) return null;
  const z = marker.z ?? marker.pos?.[0] ?? 0;
  const x = marker.x ?? marker.pos?.[1] ?? 0;
  const y = marker.y ?? marker.pos?.[2] ?? 0;
  return {
    id: String(marker.id), z, x, y, tier: marker.tier ?? 0,
    pos: [z, x], subregId: marker.subregId ?? subregionId, type: String(marker.type),
  };
};

export const readManualOverrides = async () =>
  JSON.parse(await fs.readFile(MANUAL_OVERRIDE_FILE, 'utf8'));

export const loadRawMarkers = async () => {
  const entries = [];
  for (const file of (await fs.readdir(MARKER_DIR)).filter((name) => name.endsWith('.json')).sort()) {
    const subregionId = file.replace(/\.json$/, '');
    const rows = JSON.parse(await fs.readFile(path.join(MARKER_DIR, file), 'utf8'));
    for (const raw of rows) {
      const marker = normalizeRawMarker(raw, subregionId);
      if (marker) entries.push(marker);
    }
  }
  return entries;
};

export const loadEffectiveMarkers = async ({ typeMap, subregionIds } = {}) => {
  const entries = await loadRawMarkers();
  const document = await readManualOverrides();
  const effectiveTypeMap = typeMap ?? JSON.parse(await fs.readFile(path.resolve(process.cwd(), 'src/data/marker/type.json'), 'utf8'));
  const effectiveSubregionIds = subregionIds ?? new Set(
    Object.values(JSON.parse(await fs.readFile(path.resolve(process.cwd(), 'src/data/map/region.json'), 'utf8')))
      .flatMap((region) => region.subregions ?? []),
  );
  validateManualOverrides(document, entries, effectiveTypeMap, effectiveSubregionIds);
  return applyMarkerOverrides(entries, document);
};
