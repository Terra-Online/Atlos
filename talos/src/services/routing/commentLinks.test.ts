import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('@/data/marker', () => ({
    MARKER_TYPE_DICT: {},
    findMarkerById: vi.fn(() => Promise.resolve({ id: '1', type: 'test', subregId: 'sub' })),
    findUniqueArchiveMarkerByType: vi.fn(),
}));
vi.mock('@/data/map', () => ({ REGION_DICT: { Valley_4: { subregions: ['sub'], initialZoom: 1 } } }));
vi.mock('@/store/region', () => ({
    default: { getState: () => ({ currentRegionKey: 'Valley_4', setCurrentRegion: vi.fn() }) },
}));
vi.mock('@/locale', () => ({ setLocale: vi.fn() }));
vi.mock('@/store/userGuide', () => ({ completeCurrentUserGuide: vi.fn() }));
vi.mock('@/store/marker', () => ({ useMarkerStore: { getState: () => ({}) } }));
vi.mock('@/services/map/navigation', () => ({
    navigateToSharedPoint: vi.fn(),
    navigateToSharedLocation: vi.fn(),
}));

import { applyUrlParams } from './apply';
import { generatePointShareUrl } from './share';
import { navigateToSharedPoint } from '@/services/map/navigation';
import { navigateToSharedLocation } from '@/services/map/navigation';
import { copyTextToClipboard } from '@/platform/clipboard';

beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
});

it('round trips a comment share URL into navigation', async () => {
    const url = new URL(generatePointShareUrl(
        { id: '1', type: 'test', subregId: 'sub' },
        { content: { kind: 'comment', id: 'reply/1' } },
    ));
    expect(url.searchParams.get('commentId')).toBe('reply/1');
    window.history.replaceState({}, '', url.pathname + url.search);

    await applyUrlParams();

    expect(navigateToSharedPoint).toHaveBeenCalledWith(expect.objectContaining({
        pointId: '1',
        content: { kind: 'comment', id: 'reply/1' },
    }));
    expect(window.location.search).toBe('');
});

it('retains image precedence when both targets are supplied', async () => {
    const url = new URL(generatePointShareUrl(
        { id: '1', type: 'test', subregId: 'sub' },
        { content: { kind: 'image', id: 'image' } },
    ));
    window.history.replaceState({}, '', `${url.pathname}${url.search}&commentId=comment`);

    await applyUrlParams();

    expect(navigateToSharedPoint).toHaveBeenCalledWith(expect.objectContaining({
        content: { kind: 'image', id: 'image' },
    }));
});

it('reports clipboard success and failure', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    expect(await copyTextToClipboard('link')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('link');
    writeText.mockRejectedValue(new Error('denied'));
    expect(await copyTextToClipboard('link')).toBe(false);
});

it('routes a valid regional coordinate only when no point target wins', async () => {
    window.history.replaceState({}, '', '/?r=Valley_4&c=1.25%2C2.5&z=2');
    await applyUrlParams();
    expect(navigateToSharedLocation).toHaveBeenCalledWith({
        regionKey: 'Valley_4',
        center: [1.25, 2.5],
        zoom: 2,
    });
    expect(window.location.search).toBe('');

    vi.clearAllMocks();
    window.history.replaceState({}, '', '/?r=Valley_4&c=1%2C2&x=0000001');
    await applyUrlParams();
    expect(navigateToSharedPoint).toHaveBeenCalled();
    expect(navigateToSharedLocation).not.toHaveBeenCalled();
});
