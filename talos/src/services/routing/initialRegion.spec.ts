import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ region: 'Valley_4' }));
vi.mock('@/locale', () => ({ setLocale: vi.fn() }));
vi.mock('@/data/marker', () => ({
    MARKER_TYPE_DICT: {},
    findMarkerById: vi.fn(),
    findUniqueArchiveMarkerByType: vi.fn(),
    getMarkerSubregion: vi.fn((id: string) => Promise.resolve(id === '1' ? 'WL_4' : null)),
    getUniqueArchivePointId: vi.fn((type: string) => Promise.resolve(type === 'archive' ? '1' : null)),
}));
vi.mock('@/store/region', () => ({ default: { getState: () => ({ currentRegionKey: state.region }) } }));
vi.mock('@/store/userGuide', () => ({ completeCurrentUserGuide: vi.fn() }));
vi.mock('@/store/marker', () => ({ useMarkerStore: { getState: () => ({}) } }));
vi.mock('@/services/map/navigation', () => ({ navigateToSharedPoint: vi.fn(), navigateToSharedLocation: vi.fn() }));

import { resolveInitialRegion } from './apply';
import { findMarkerById, getMarkerSubregion } from '@/data/marker';
import { encodePointIdToken } from './pointToken';

beforeEach(() => { state.region = 'Valley_4'; vi.clearAllMocks(); });

it('uses persisted/default region rules without reading any point shard', async () => {
    expect(await resolveInitialRegion({ pathname: '/', search: '?r=WL' })).toBe('Wuling');
    state.region = 'Wuling';
    expect(await resolveInitialRegion({ pathname: '/', search: '?r=VL' })).toBe('Wuling');
    expect(getMarkerSubregion).not.toHaveBeenCalled();
});

it('honors point token, point id and unique archive destinations over a region parameter', async () => {
    for (const search of [`?r=VL&x=${encodePointIdToken('1')}`, '?r=VL&p=1', '?r=VL&type=archive'])
        expect(await resolveInitialRegion({ pathname: '/', search })).toBe('Wuling');
    expect(findMarkerById).not.toHaveBeenCalled();
    expect(state.region).toBe('Valley_4');
});

it('prepares explicit location destinations and safely ignores unknown point ids', async () => {
    state.region = 'Wuling';
    expect(await resolveInitialRegion({ pathname: '/', search: '?r=VL&c=1,2' })).toBe('Valley_4');
    expect(await resolveInitialRegion({ pathname: '/', search: '?r=VL&p=missing' })).toBe('Wuling');
    expect(await resolveInitialRegion({ pathname: '/', search: '?r=missing' })).toBe('Wuling');
});
