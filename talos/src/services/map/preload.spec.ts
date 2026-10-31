import { afterEach, expect, it, vi } from 'vitest';
import { preloadMapTiles } from './preload';
import { getTileResourceUrl } from '@/services/assets/resource';
import { useLayerStore } from '@/store/layer';
import useViewState from '@/store/viewState';

afterEach(() => vi.restoreAllMocks());

it('preloads Wuling around its configured map coordinates without a pixel-basis offset', () => {
    const layer = useLayerStore.getState();
    const view = useViewState.getState();
    const requests = vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(() => {});
    try {
        useLayerStore.setState({ currentLayer: 'M', satellite: false });
        useViewState.setState({ viewStates: {} });
        const cancel = preloadMapTiles('Wuling');
        expect(requests.mock.calls.map(([url]) => url)).toEqual([
            '10_22', '11_22', '10_21', '11_21',
        ].map((tile) => getTileResourceUrl(`Wuling/2/${tile}.webp`)));
        cancel();
    } finally {
        useLayerStore.setState(layer, true);
        useViewState.setState(view, true);
    }
});
