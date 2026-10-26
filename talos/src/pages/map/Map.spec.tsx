import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MapView from './Map';
import { mapFixture } from '../../../test-support/pages';
import styles from './Map.module.scss';
import type L from 'leaflet';

const state = vi.hoisted(() => ({ map: null as L.Map | null, over: false, measure: vi.fn(), ready: vi.fn() }));
vi.mock('./useMap', () => ({ useMap: () => ({ map: state.map, currentRegion: 'Valley_4' }) }));
vi.mock('./useLabel', () => ({ useLabel: () => {} }));
vi.mock('./useLink', () => ({ useLink: () => ({ linkTooltipElement: null }) }));
vi.mock('./usePreview', () => ({ UsePreview: () => ({ PreviewElement: null }) }));
vi.mock('./behaviorOverlay/useBehaviorOverlay', () => ({ useBehaviorOverlay: () => {} }));
vi.mock('./behaviorOverlay/useMapSupplements', () => ({ useMapSupplements: () => null }));
vi.mock('./behaviorOverlay/SupplementTooltip', () => ({ default: () => null }));
vi.mock('./MapContextMenu', () => ({ default: () => null }));
vi.mock('@/services/map/core/mapOverdrag', () => ({ toMapBounds: () => ({}), isMapOverdragged: () => { state.measure(); return state.over; } }));
let fixture: ReturnType<typeof mapFixture>;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); fixture = mapFixture(); state.map = fixture.map; state.over = false; });
afterEach(() => { cleanup(); fixture.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('publishes readiness, coalesces map motion and clears overdrag or pending frames at gesture boundaries', () => {
    const view = render(<MapView onMapReady={state.ready} />); expect(state.ready).toHaveBeenCalledExactlyOnceWith(fixture.map);
    const host = view.container.querySelector('#map')!;
    state.over = true; act(() => { fixture.map.fire('drag'); fixture.map.fire('move'); });
    expect(state.measure).not.toHaveBeenCalled(); act(() => { vi.advanceTimersToNextFrame(); });
    expect(state.measure).toHaveBeenCalledOnce(); expect(host.classList.contains(styles.overdrag)).toBe(true);
    act(() => { fixture.map.fire('zoomstart'); }); expect(host.classList.contains(styles.overdrag)).toBe(false);
    act(() => { fixture.map.fire('drag'); fixture.map.fire('dragend'); vi.advanceTimersToNextFrame(); }); expect(state.measure).toHaveBeenCalledOnce();
    view.unmount(); act(() => { fixture.map.fire('drag'); vi.advanceTimersToNextFrame(); }); expect(state.measure).toHaveBeenCalledOnce();
});
