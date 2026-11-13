import { expect, it } from 'vitest';
import catalog from './type.json';
import { getMarkerIds, getWorldMarkerTypes, loadAllMarkers, MARKER_TYPE_DICT, MARKER_TYPE_TREE, WORLD_TYPE_COUNT_MAP } from './index';

it('exposes the same type universe through the catalog, point loaders and statistics', async () => {
    const markers = await loadAllMarkers();
    const actualTypes = [...new Set(markers.map(marker => marker.type))].sort();
    expect(Object.keys(MARKER_TYPE_DICT).sort()).toEqual(actualTypes);
    expect(Object.values(MARKER_TYPE_TREE).flat().map(type => type.key).sort()).toEqual(actualTypes);
    expect(Object.keys(WORLD_TYPE_COUNT_MAP).sort()).toEqual(actualTypes);
    expect(Object.keys(catalog).length).toBeGreaterThan(actualTypes.length);
    expect(Object.values(WORLD_TYPE_COUNT_MAP).every(count => count > 0)).toBe(true);
    expect(Boolean(MARKER_TYPE_DICT.bounce_device.noFrame)).toBe(false);
    expect(Boolean(MARKER_TYPE_DICT.vortex.noFrame)).toBe(false);

    const counted = await getWorldMarkerTypes();
    expect([...new Set(counted.values())].sort()).toEqual(actualTypes);
    // Historical raw records retain bitmap positions without becoming selectable points.
    const rawIds = await getMarkerIds();
    const storedIds = new Set(rawIds);
    const pointIds = new Set(markers.map(marker => marker.id));
    expect(rawIds.length).toBeGreaterThan(pointIds.size);
    expect(markers.every(marker => storedIds.has(marker.id))).toBe(true);
    expect([...counted.keys()].every(id => pointIds.has(id))).toBe(true);
});
