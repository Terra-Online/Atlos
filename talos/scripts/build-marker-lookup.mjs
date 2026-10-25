import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEffectiveMarkers, loadMarkerShards, readManualOverrides } from './marker-data.mjs';
import { deduplicateMarkersByPositionAndType } from '../src/data/marker/deduplication.js';

/** Lookup indexes retain source shards, including points moved by an override. */
export const buildMarkerLookup = (markers, sourceById, typeMap) => {
    const subregions = [...new Set(sourceById.values())].sort();
    const points = Object.fromEntries([...sourceById].map(([id, source]) => [id, subregions.indexOf(source)]));
    const firstTypes = {};
    const archives = {};
    const moved = {};
    const representatives = {};
    for (const marker of markers) {
        const source = sourceById.get(marker.id);
        if (!source) throw new Error(`Missing source shard for marker ${marker.id}`);
        points[marker.id] = subregions.indexOf(source);
        if (marker.subregId !== source) moved[marker.id] = marker.subregId;
        firstTypes[marker.type] ??= marker.id;
        if (typeMap[marker.type]?.category.main === 'files') {
            if (!(marker.type in archives)) archives[marker.type] = marker.id;
            else if (archives[marker.type] !== marker.id) archives[marker.type] = null;
        }
    }
    // World counts have historically used the first point at each exact typed
    // position. All current duplicates belong to one source shard, so its row
    // order remains stable even when whole shards finish in a different order.
    // Fail a data check if that assumption changes instead of silently changing
    // which collected ID contributes to the existing world progress counters.
    const sourceAtPosition = new Map();
    for (const marker of markers) {
        const key = JSON.stringify([marker.type, marker.x, marker.y, marker.z]);
        const source = sourceById.get(marker.id);
        if (sourceAtPosition.has(key) && sourceAtPosition.get(key) !== source)
            throw new Error(`World count position spans source shards: ${marker.id}. Resolve its representative contract before rebuilding the lookup.`);
        sourceAtPosition.set(key, source);
    }
    for (const marker of deduplicateMarkersByPositionAndType(markers)) {
        if (!marker.type) continue;
        (representatives[marker.type] ??= []).push(marker.id);
    }
    return { subregions, points, firstTypes, archives, moved, representatives };
};

export const generateMarkerLookup = async (checkOnly = false) => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const output = path.join(root, 'src/data/marker/lookup.json');
    const shards = await loadMarkerShards();
    const sourceById = new Map(shards.flatMap(({ subregionId, pointIds }) => pointIds.map((id) => [id, subregionId])));
    for (const entry of await readManualOverrides()) {
        if (entry.op === 'add') sourceById.set(String(entry.id), entry.subregId);
        if (entry.op === 'delete') sourceById.delete(String(entry.id));
    }
    const typeMap = JSON.parse(await fs.readFile(path.join(root, 'src/data/marker/type.json'), 'utf8'));
    // Do not position-deduplicate: share links have always resolved all effective
    // IDs, while the renderer separately chooses its first visible representative.
    const markers = await loadEffectiveMarkers();
    const result = buildMarkerLookup(markers, sourceById, typeMap);
    const serialized = `${JSON.stringify(result)}\n`;
    if (checkOnly) {
        if (await fs.readFile(output, 'utf8') !== serialized)
            throw new Error('Marker lookup is stale. Run pnpm data marker-lookup.');
    } else await fs.writeFile(output, serialized);
    console.log(`[marker-lookup] ${checkOnly ? 'verified' : 'wrote'} ${Object.keys(result.points).length} point pointers`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
    await generateMarkerLookup(process.argv.includes('--check'));
