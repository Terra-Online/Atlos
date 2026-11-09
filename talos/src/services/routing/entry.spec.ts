import { beforeEach, expect, it } from 'vitest';
import { useLayerStore } from '@/store/layer';
import { applyMapEntry } from './entry';

beforeEach(() => useLayerStore.setState({ satellite: false, currentLayer: 'B2' }));

it.each(['satellite.oem.re', 'satellite.opendfieldmap.org', 'satellite.opendfieldmap.cn'])(
    'opens %s on satellite ground even with a persisted standard floor', (hostname) => {
        applyMapEntry({ hostname, pathname: '/' });
        expect(useLayerStore.getState()).toMatchObject({ satellite: true, currentLayer: 'M' });
    },
);

it.each(['/satellite', '/satellite/', '/satellite/0oGIf3b/'])(
    'opens the %s SPA path in satellite mode', (pathname) => {
        applyMapEntry({ hostname: 'opendfieldmap.org', pathname });
        expect(useLayerStore.getState()).toMatchObject({ satellite: true, currentLayer: 'M' });
    },
);

it('leaves ordinary entries and lookalike names on their saved mode', () => {
    for (const location of [
        { hostname: 'opendfieldmap.cn', pathname: '/' },
        { hostname: 'satellite.opendfieldmap.org.example.com', pathname: '/' },
        { hostname: 'localhost', pathname: '/satellite-other' },
    ]) {
        applyMapEntry(location);
        expect(useLayerStore.getState()).toMatchObject({ satellite: false, currentLayer: 'B2' });
    }
    useLayerStore.setState({ satellite: true });
    applyMapEntry({ hostname: 'opendfieldmap.org', pathname: '/' });
    expect(useLayerStore.getState().satellite).toBe(true);
});
