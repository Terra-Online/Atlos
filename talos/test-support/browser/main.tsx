import { createRoot } from 'react-dom/client';
import { i18nInitPromise } from '@/locale';
import { fontLoader } from '@/locale/fontLoader';
import Components from './components';
import '@/styles/global.scss';

await i18nInitPromise;
await fontLoader();
createRoot(document.getElementById('root')!).render(<Components />);
