import { useMemo } from 'react';
import { create } from 'zustand';
import { loadAllMarkers } from '@/data/marker';
import { getActivePoints, useUserRecord, useUserRecordStore } from './userRecord';

const empty: ReadonlyMap<string, boolean> = new Map();
const usePreview = create<{ owner: symbol | null; overrides: ReadonlyMap<string, boolean> }>(() => ({
    owner: null,
    overrides: empty,
}));
let request = 0;

export function beginGuideProgress(): symbol {
    const owner = Symbol('guide');
    ++request;
    usePreview.setState({ owner, overrides: empty });
    return owner;
}

export function endGuideProgress(owner: symbol): void {
    if (usePreview.getState().owner !== owner) return;
    ++request;
    usePreview.setState({ owner: null, overrides: empty });
}

/** Demo writes belong to the current walkthrough; later actions supersede earlier loads. */
export async function previewGuideProgress(type: string, collected: boolean, signal?: AbortSignal): Promise<void> {
    const { owner } = usePreview.getState();
    if (!owner || signal?.aborted) return;
    const currentRequest = ++request;
    const markers = await loadAllMarkers();
    if (signal?.aborted || usePreview.getState().owner !== owner || request !== currentRequest) return;
    const overrides = new Map(usePreview.getState().overrides);
    for (const marker of markers) {
        if (marker.type === type) overrides.set(marker.id, collected);
    }
    usePreview.setState({ overrides });
}

// Map renderers read membership repeatedly. Keep each immutable pair's result
// stable so the existing marker/count caches do not rebuild per marker.
const cache = new WeakMap<string[], WeakMap<ReadonlyMap<string, boolean>, string[]>>();
function displayPoints(points: string[], overrides: ReadonlyMap<string, boolean>): string[] {
    if (!overrides.size) return points;
    let previews = cache.get(points);
    if (!previews) { previews = new WeakMap(); cache.set(points, previews); }
    const cached = previews.get(overrides);
    if (cached) return cached;
    const displayed = new Set(points);
    for (const [id, collected] of overrides) {
        if (collected) displayed.add(id);
        else displayed.delete(id);
    }
    const result = [...displayed];
    previews.set(overrides, result);
    return result;
}

/** Display only: persistence, export, undo and cloud sync keep reading userRecord. */
export function useDisplayedPointProgress(): string[] {
    const points = useUserRecord();
    const overrides = usePreview((state) => state.overrides);
    return useMemo(() => displayPoints(points, overrides), [points, overrides]);
}

export function getDisplayedPointProgress(): string[] {
    return displayPoints(getActivePoints(), usePreview.getState().overrides);
}

export function useDisplayedPointCollected(id?: string): boolean {
    const collected = useUserRecordStore((state) => id ? state.activePoints.includes(id) : false);
    const preview = usePreview((state) => id ? state.overrides.get(id) : undefined);
    return preview ?? collected;
}
