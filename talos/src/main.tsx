import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import App from './App.tsx';
import { fontLoader } from './utils/fontLoader.ts';
import { i18nInitPromise } from '@/locale';
import { loadLabelTool, loadLinkTool } from '@/devtools/loadDevTool';
import { applyUrlParams } from '@/utils/urlState';
import { useUserRecordStore } from '@/store/userRecord';
import { useMarkerStore } from '@/store/marker';

async function bootstrap(){
    await i18nInitPromise;

    // After migration updates localStorage, force stores to re-read from the
    // now-migrated localStorage. Without this, stores hydrated with old string
    // IDs during module evaluation (sync) and would overwrite the migration
    // (async) on the next set() call.
    await useUserRecordStore.persist.rehydrate();
    await useMarkerStore.persist.rehydrate();

    // 應用URL參數（語言、篩選器、區域）
    await applyUrlParams();

    fontLoader();

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
    createRoot(document.getElementById('root')).render(<App />);

    void loadLabelTool();
    void loadLinkTool();

    /*
     **Lazyapp now temporarily disabled due to actually it's unnecessary for current resource scale.
        createRoot(document.getElementById('root')).render(<LazyApp />);
    */
}

void bootstrap();
