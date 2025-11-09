import { createRoot } from 'react-dom/client';
//import LazyApp from '@/LazyApp.tsx';
import App from './App.tsx';
import { fontLoader } from './utils/fontLoader.ts';

fontLoader();

// @ts-expect-error root must be found otherwise it will definitely cannot show anything
createRoot(document.getElementById('root')).render(<App />);

/*
 **Lazyapp now temporarily disabled due to actually it's unnecessary for current resource scale.
    createRoot(document.getElementById('root')).render(<LazyApp />);
*/