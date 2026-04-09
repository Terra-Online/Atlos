import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import App from './App.tsx';

import { fontLoader } from './locale/fontLoader.ts';
import { i18nInitPromise } from '@/locale';
import { loadDevTools } from '@/devtools/loadDevTool';
import { applyUrlParams } from '@/utils/urlState';
import { useUserRecordStore } from '@/store/userRecord';
import { useMarkerStore } from '@/store/marker';

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

    await i18nInitPromise;

    // After migration updates localStorage, force stores to re-read from the
    // now-migrated localStorage. Without this, stores hydrated with old string
    // IDs during module evaluation (sync) and would overwrite the migration
    // (async) on the next set() call.
    await useUserRecordStore.persist.rehydrate();
    await useMarkerStore.persist.rehydrate();

    // Apply URL parameters to set initial state
    await applyUrlParams();

    fontLoader();

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
    createRoot(document.getElementById('root')).render(<App />);

    loadDevTools();

    /*
     **Lazyapp now temporarily disabled due to actually it's unnecessary for current resource scale.
        createRoot(document.getElementById('root')).render(<LazyApp />);
    */
}

void bootstrap();
