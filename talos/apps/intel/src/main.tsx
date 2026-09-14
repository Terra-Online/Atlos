import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { i18nInitPromise as intelI18nInitPromise } from '@intel/locale';
import { i18nInitPromise as mainI18nInitPromise } from '@main/locale';
import './styles/global.scss';
import './styles/overrides.scss';

const root = document.getElementById('root');
if (!root) throw new Error('Intel root element is missing.');

const layoutFontsReady = Promise.all([
  document.fonts.load("500 1rem 'HMSans_EN'"),
  document.fonts.load("700 1rem 'HMSans_EN'"),
  document.fonts.load("500 1rem 'Novecento Medium'"),
  document.fonts.load("700 1rem 'Novecento DemiBold'"),
]).catch(() => undefined);

void Promise.all([intelI18nInitPromise, mainI18nInitPromise, layoutFontsReady]).then(() => {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
