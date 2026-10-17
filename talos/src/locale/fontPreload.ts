import { getFontRegionForLocale } from '@/lib/i18n/lang';
import { readInitialLocale } from '@/lib/i18n/runtime';
import { fontLoader } from './fontLoader';

// Keep font requests independent of application initialization and rendering.
void fontLoader(document, getFontRegionForLocale(readInitialLocale()));
