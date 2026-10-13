import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { i18nInitPromise as mainI18nInitPromise } from '@main/locale';
import { i18nInitPromise } from '@hub/locale';
import '@hub/styles/global.scss';

const root = document.getElementById('root');
if (!root) throw new Error('User hub root is missing.');

const layoutFontsReady = Promise.all([
    document.fonts.load("500 1rem 'HMSans_EN'"),
    document.fonts.load("700 1rem 'HMSans_EN'"),
    document.fonts.load("500 1rem 'Novecento Medium'"),
    document.fonts.load("700 1rem 'Novecento DemiBold'"),
]).catch(() => undefined);

void Promise.all([i18nInitPromise, mainI18nInitPromise, layoutFontsReady]).then(
    () => {
        createRoot(root).render(
            <StrictMode>
                <App />
            </StrictMode>,
        );
    },
);
