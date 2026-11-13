import { afterEach, expect, it, vi } from 'vitest';
import type { Viewer } from '@endfield-noclip/viewer/host';
import {
    displayOptions,
    readView,
    writeView,
    type SavedView,
} from './view-storage';

// The validator uses current option types as its schema, not renderer internals.
const defaults = {
    sky: true,
    exposure: 0,
    budgetMiB: 768,
    tonemapper: 'game',
    debugView: 'lit',
    hlodTiers: [true, true, true],
    environmentPin: null,
    depthOfField: false,
    aperture: 32,
    focusDistance: 10,
} satisfies Partial<Viewer['options']>;
const view: SavedView = {
    version: 1,
    route: '/0vQEA7m',
    release: 'release',
    scene: 'scene',
    level: 'level',
    subregion: 'DJ_1',
    tier: 1,
    position: [12, 34, 56],
    yaw: 1.2,
    pitch: -0.3,
    fovY: 0.4,
    speed: 80,
    options: { sky: false, exposure: 1 },
};
afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
});

it('round-trips the full view without changing unrelated storage or rewriting unchanged state', () => {
    localStorage.setItem('atlos-layer-storage', 'unchanged');
    const write = vi.spyOn(localStorage, 'setItem');
    writeView(view);
    writeView(view);
    expect(write).toHaveBeenCalledTimes(1);
    expect(readView(defaults)).toEqual(view);
    expect(localStorage.getItem('atlos-layer-storage')).toBe('unchanged');
});

it('rejects corrupt, unsupported and unsafe camera records', () => {
    for (const patch of [
        { version: 2 },
        { position: [1, 2] },
        { fovY: 0 },
        { speed: -1 },
        { route: '//other.test/' },
        { pitch: 10 },
    ]) {
        localStorage.setItem(
            'world-view',
            JSON.stringify({ ...view, ...patch }),
        );
        expect(readView(defaults)).toBeNull();
    }
    localStorage.setItem('world-view', '{');
    expect(readView(defaults)).toBeNull();
});

it('keeps valid display options but excludes scene overrides and malformed values', () => {
    expect(
        displayOptions(
            {
                sky: false,
                exposure: 2,
                budgetMiB: 64,
                tonemapper: ['game'],
                debugView: 'unknown',
                hlodTiers: [true, false],
                environmentPin: 9,
                environmentEnabled: { 1: false },
                extra: true,
            },
            defaults,
        ),
    ).toEqual({ sky: false, exposure: 2, budgetMiB: 64 });
});

it('tolerates inaccessible storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
    });
    expect(readView(defaults)).toBeNull();
    expect(() => writeView(view)).not.toThrow();
});

it('persists photography in the existing view record and rejects invalid lens values', () => {
    const options = { depthOfField: true, aperture: 1.4, focusDistance: 12.5 };
    writeView({ ...view, options });
    expect(readView(defaults)?.options).toEqual(options);
    expect(
        displayOptions(
            { depthOfField: 'true', aperture: 0, focusDistance: Infinity },
            defaults,
        ),
    ).toEqual({});
    expect(
        displayOptions({ aperture: 32, focusDistance: 10000 }, defaults),
    ).toEqual({ aperture: 32, focusDistance: 10000 });
    expect(
        displayOptions({ aperture: 33, focusDistance: -1 }, defaults),
    ).toEqual({});
});
