import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import App from './App.tsx';
import { fontLoader } from './utils/fontLoader.ts';
import { i18nInitPromise } from '@/locale';
import { maybeLoadLabelTool } from '@/devtools/loadDevTool';

async function bootstrap(){
    await i18nInitPromise;

    fontLoader();

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
    createRoot(document.getElementById('root')).render(<App />);

    void maybeLoadLabelTool();

    /*
     **Lazyapp now temporarily disabled due to actually it's unnecessary for current resource scale.
        createRoot(document.getElementById('root')).render(<LazyApp />);
    */
}

void bootstrap();
