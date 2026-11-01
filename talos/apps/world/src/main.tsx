import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp } from '@endfield-noclip/viewer/host';
import '@endfield-noclip/viewer/style.css';
import '@/styles/global.scss';
import './style.scss';
import './preview.css';
import { i18nInitPromise } from '@/locale';
import { Preview } from './preview';
import { readLaunch } from './route';

const root = createRoot(document.getElementById('root')!);
void i18nInitPromise.then(() => {
    try {
        const launch = readLaunch(
            new URL(location.href),
            import.meta.env.VITE_WORLD_CATALOG_URL as string | undefined,
        );
        root.render(
            <StrictMode>
                <ViewerApp
                    overlay={(viewer, panelRoot) => (
                        <Preview
                            viewer={viewer}
                            launch={launch}
                            panelRoot={panelRoot}
                        />
                    )}
                />
            </StrictMode>,
        );
    } catch (error) {
        root.render(
            <main role='alert'>
                {error instanceof Error ? error.message : String(error)}
            </main>,
        );
    }
});
