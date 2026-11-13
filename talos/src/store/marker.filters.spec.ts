import { afterEach, expect, it } from 'vitest';
import { MARKER_TYPE_DICT } from '@/data/marker';
import catalog from '@/data/marker/type.json';
import { commitMarkerFilter, useHistoryStore } from './history';
import { useMarkerStore } from './marker';

const initial = useMarkerStore.getState();
const history = useHistoryStore.getState();
const unavailable = Object.keys(catalog).find(key => !MARKER_TYPE_DICT[key])!;
const visible = ['aurylene', 'bounce_device'];

afterEach(() => {
    useMarkerStore.setState(initial, true);
    useHistoryStore.setState(history, true);
    localStorage.removeItem('marker-filter');
});

it('uses the exported type universe for every filter mutation, including the new facilities', () => {
    expect(unavailable).toBeTruthy();
    const store = useMarkerStore.getState();
    store.setFilter([visible[0], unavailable, 'unknown', visible[0]]);
    expect(useMarkerStore.getState().filter).toEqual([visible[0]]);
    store.switchFilter(unavailable);
    store.batchToggleFilter([visible[1], unavailable, visible[1]]);
    expect(useMarkerStore.getState().filter).toEqual(visible);
    store.setFilterKeys([unavailable, 'unknown'], true);
    expect(useMarkerStore.getState().filter).toEqual(visible);
    store.setFilterKeys([visible[0]], false);
    expect(useMarkerStore.getState().filter).toEqual([visible[1]]);
});

it('removes stale persisted filters while preserving real selections and saved highlights', async () => {
    localStorage.setItem('marker-filter', JSON.stringify({ state: {
        filter: [unavailable, visible[1], 'unknown', visible[1]], selectedPoints: ['saved-highlight'],
    }, version: 0 }));
    await useMarkerStore.persist.rehydrate();
    expect(useMarkerStore.getState().filter).toEqual([visible[1]]);
    expect(useMarkerStore.getState().selectedPoints).toEqual(['saved-highlight']);
});

it('records and replays only filter changes that actually belong to the visible universe', () => {
    useMarkerStore.getState().setFilter([]);
    useHistoryStore.getState().clear();
    expect(commitMarkerFilter('unavailable', { activate: [unavailable, 'unknown'] })).toBe(false);
    expect(useHistoryStore.getState().past).toHaveLength(0);
    expect(commitMarkerFilter('visible', { activate: [visible[0], unavailable] })).toBe(true);
    expect(useHistoryStore.getState().past[0]).toMatchObject({ activatedKeys: [visible[0]], deactivatedKeys: [] });
    useHistoryStore.getState().undo();
    expect(useMarkerStore.getState().filter).toEqual([]);
    useHistoryStore.getState().redo();
    expect(useMarkerStore.getState().filter).toEqual([visible[0]]);
});
