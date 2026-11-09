import { beforeEach, expect, it, vi } from 'vitest';
import lookup from './lookup.json';

beforeEach(() => vi.resetModules());

it('loads only the owning source shard for a shared point and reuses that result', async () => {
    const markers = await import('./index');
    const id = '2100500004';
    const point = await markers.findMarkerById(id);
    expect(point?.id).toBe(id);
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual(['VL_1']);
    expect(await markers.findMarkerById(id)).toBe(point);
});

it('rejects missing points and ambiguous archive types without loading map data', async () => {
    const markers = await import('./index');
    const ambiguous = Object.keys(lookup.archives).find((key) => (lookup.archives as Record<string, string | null>)[key] === null);
    expect(await markers.findMarkerById('not-a-point')).toBeNull();
    expect(await markers.findMarkerById('__proto__')).toBeNull();
    expect(await markers.findUniqueArchiveMarkerByType(ambiguous ?? '__proto__')).toBeNull();
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual([]);
});

it('resolves a startup region from the index before fetching point rows', async () => {
    const markers = await import('./index');
    expect(await markers.getMarkerSubregion('2100500004')).toBe('VL_1');
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual([]);
});

it('preserves legacy lookups for source rows without a registered marker type', async () => {
    const markers = await import('./index');
    const point = await markers.findMarkerById('2800000983');
    expect(point?.id).toBe('2800000983');
    expect(point?.type).toBe('');
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual(['VL_7']);
});

it('resolves a unique archive and a demonstration type without requesting the world', async () => {
    const markers = await import('./index');
    const type = Object.keys(lookup.archives).find((key) => (lookup.archives as Record<string, string | null>)[key] !== null)!;
    const point = await markers.findUniqueArchiveMarkerByType(type);
    expect(point?.type).toBe(type);
    expect(await markers.findFirstMarkerByType(type)).toBe(point);
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toHaveLength(1);
});
