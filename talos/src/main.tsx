import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import './styles/global.scss';
import MapPage from './pages/MapPage';

import { fontLoader } from './locale/fontLoader.ts';
import { i18nInitPromise, preloadMapFonts } from '@/locale';
import { loadDevTools } from '@/devtools/loadDevTool';
import { applyUrlParams, resolveInitialRegion, parseUrlState } from '@/services/routing';
import { loadRegionMarkers } from '@/data/marker';
import { preloadMapTiles } from '@/services/map/preload';
import { REGION_DICT } from '@/data/map';
import { getInitialNavigationView, prepareInitialNavigation } from '@/services/map/navigation';

const enforceLocalhostHost = (): boolean => {
    if (typeof window === 'undefined') return false;
    if (window.location.hostname !== '127.0.0.1') return false;

    const url = new URL(window.location.href);
    url.hostname = 'localhost';
    window.location.replace(url.toString());
    return true;
};

async function bootstrap(){
    if (enforceLocalhostHost()) return;

    // Data and the expected view's original tiles should not wait for UI font
    // registration. Share queries resolve their small index before warming a
    // region; they must not accidentally download the persisted/default one.
    const region = resolveInitialRegion(window.location);
    const resources = region.then((regionId) => {
        void loadRegionMarkers(regionId).catch(() => undefined);
        const state = parseUrlState(window.location);
        if (!state.pointId && !state.pointToken && !state.typeKey) {
            preloadMapTiles(regionId, state.coordinate && state.regionKey === regionId
                ? { lat: state.coordinate[0], lng: state.coordinate[1], zoom: state.zoom ?? REGION_DICT[regionId].initialZoom }
                : undefined);
        }
        return regionId;
    });
    await i18nInitPromise;

    // Apply URL parameters to set initial state
    await applyUrlParams();
    await prepareInitialNavigation().catch((error: unknown) => console.warn('Initial navigation preparation unavailable:', error));
    const initial = getInitialNavigationView();
    if (initial?.kind === 'point') preloadMapTiles(initial.regionId, initial.view);

    await fontLoader();
    // The first visible map labels and controls use complete native fonts.
    // Resource downloads above have been progressing during this preparation.
    await preloadMapFonts(await resources).catch((error: unknown) => console.warn('Initial map fonts unavailable:', error));

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
    createRoot(document.getElementById('root')).render(<MapPage />);

    loadDevTools();

    /*
     **Lazyapp now temporarily disabled due to actually it's unnecessary for current resource scale.
        createRoot(document.getElementById('root')).render(<LazyApp />);
    */
}

void bootstrap();
