import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { ViewerApp, PanelProvider } from '@endfield-noclip/viewer/host';
import '@endfield-noclip/viewer/style.css';
import '@/styles/global.scss';
import './style.scss';
import './preview.css';
import { i18nInitPromise } from '@/locale';
import { Preview } from './preview';
import { readLaunch } from './route';

const BenchmarkRoute =
    import.meta.env.DEV && new URL(location.href).searchParams.has('benchmark')
        ? lazy(() => import('./route-inspection'))
        : null;

// Temporarily hide the viewer and point panels during route validation.
const HiddenPanel = () => null;

const root = createRoot(document.getElementById('root')!);
void i18nInitPromise.then(() => {
    try {
        const launch = readLaunch(
            new URL(location.href),
            import.meta.env.VITE_WORLD_CATALOG_URL as string | undefined,
        );
        root.render(
            <StrictMode>
                <PanelProvider component={HiddenPanel}>
                    <ViewerApp
                        filtersUrl={
                            import.meta.env.VITE_WORLD_FILTERS_URL as
                                | string
                                | undefined
                        }
                        overlay={(viewer, panelRoot) => (
                            <>
                                <Preview
                                    viewer={viewer}
                                    launch={launch}
                                    panelRoot={panelRoot}
                                />
                                {BenchmarkRoute && (
                                    <Suspense fallback={null}>
                                        <BenchmarkRoute
                                            viewer={viewer}
                                            panelRoot={panelRoot}
                                        />
                                    </Suspense>
                                )}
                            </>
                        )}
                    />
                </PanelProvider>
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
