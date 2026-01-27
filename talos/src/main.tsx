import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import App from './App.tsx';
import { fontLoader } from './utils/fontLoader.ts';
import { i18nInitPromise } from '@/locale';
import { loadLabelTool, loadLinkTool } from '@/devtools/loadDevTool';
import { applyUrlParams } from '@/utils/urlState';

async function bootstrap(){
    await i18nInitPromise;

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
