import { createHash, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { getProgressMarkerIndex, encodeProgressPoints, decodeProgressPoints } from './bitmap';
import { loadAllMarkers, SUBREGION_MARKS_MAP } from '@/data/marker';

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
afterAll(() => vi.unstubAllGlobals());

it('preserves every legacy bitmap position, hash and checksum without loading world rows', async () => {
    const current = await getProgressMarkerIndex();
    expect(Object.keys(SUBREGION_MARKS_MAP)).toEqual([]);
    expect(current.indexById.has('2800000983')).toBe(true);

    // Compute the reference from the old full-data path, independent of lookup
    // ordering. Numeric IDs keep their historical length + localeCompare sort.
    const legacyIds = [...new Set((await loadAllMarkers()).map((point) => String(point.id)).filter(Boolean))]
        .sort((a, b) => /^\d+$/.test(a) && /^\d+$/.test(b)
            ? a.length - b.length || a.localeCompare(b)
            : a.localeCompare(b));
    const hash = createHash('sha256').update(JSON.stringify({ schemaVersion: 1, mapId: 'endfield', points: legacyIds })).digest('hex');
    expect(current.pointIds).toEqual(legacyIds);
    expect(current.markerIndexHash).toBe(hash);

    const selected = [legacyIds[0], '2800000983', legacyIds[legacyIds.length - 1], legacyIds[0], 'not-a-point'];
    const bytes = new Uint8Array(Math.ceil(legacyIds.length / 8));
    for (const id of selected) {
        const index = legacyIds.indexOf(id);
        if (index >= 0) bytes[Math.floor(index / 8)] |= 1 << (index % 8);
    }
    // The existing wire checksum appends raw bytes directly after pointCount;
    // its metadata prefix has separators between fields, without a trailing one.
    const checksum = createHash('sha256').update(`bitmap-v1:1:${hash}:1:${legacyIds.length}`).update(bytes).digest('hex');
    const payload = await encodeProgressPoints(selected);
    expect(payload).toEqual({
        marker: Buffer.from(bytes).toString('base64'), checksum, markerIndexHash: hash,
        formatVersion: 1, bitsPerPoint: 1, pointCount: legacyIds.length,
    });
    expect(await decodeProgressPoints(payload.marker, payload.pointCount)).toEqual(legacyIds.filter((id) => selected.includes(id)));
});
