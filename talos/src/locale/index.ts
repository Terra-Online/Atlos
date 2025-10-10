import { create } from 'zustand';
import LOGGER from '@/utils/log';
import ALP from 'accept-language-parser';
import { preloadFonts, getFontUrlsForRegion } from '@/utils/fontCache';

// New i18n structure
// divided into `ui` and `game` namespaces
export interface II18nBundle {
    game: Record<string, any>; // Game stuff(point, category, etc)
    ui: Record<string, any>; // UI components text
}

export const SUPPORTED_LANGS = ['en-us', 'ja-JP', 'ko-KR', 'zh-cn', 'zh-tw'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = 'talos:locale';

// Map locale to font region
const localeToFontRegion = (locale: Lang): 'CN' | 'HK' | 'JP' => {
    if (locale === 'zh-cn') return 'CN';
    if (locale === 'zh-tw') return 'HK';
    if (locale === 'ja-JP') return 'JP';
    return 'HK'; // Default to HK for other locales
};

// Convert our internal locale to a proper BCP-47 tag for <html lang>
const toBCP47 = (locale: Lang): string => {
    const [lang, region] = locale.split('-');
    return region ? `${lang}-${region.toUpperCase()}` : lang;
};

const normalizeLang = (lang?: string): Lang => {
    const language = lang || navigator.language || 'en-US';
    // try to pick a supported lang
    const picked = ALP.pick([...SUPPORTED_LANGS], language);
    return (picked as Lang) || 'en-us';
};

const getStoredLocale = (): Lang | null => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return null;
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return saved ? normalizeLang(saved) : null;
    } catch {
        return null;
    }
};

const getLanguage = () => getStoredLocale() || normalizeLang();

const deepGet = (obj: any, path: string) =>
    path
        .split('.')
        .reduce((acc: any, k: string) => (acc && acc[k] !== undefined ? acc[k] : ''), obj);

// Worker-based loading with fallback
let worker: Worker | null = null;

// Initialize worker if supported
if (typeof Worker !== 'undefined') {
    try {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
        LOGGER.warn('Failed to initialize i18n worker, falling back to main thread:', error);
    }
}

const useI18nStore = create<{
    locale: Lang;
    data: II18nBundle;
    t: <T = string>(key: string) => T;
}>(() => ({
    locale: getLanguage(),
    data: { game: {}, ui: {} },
    t: <T = string>(key: string) => {
        const { data } = useI18nStore.getState();
        // Forcedly require explicit namespace: ui.xxx / game.xxx
        if (key.startsWith('ui.') || key.startsWith('game.')) {
            return deepGet(data, key) as T;
        }
        // No namespace, warn in log and return empty string
        LOGGER.warnOnce(
            `i18n:no-namespace:${key}`,
            'i18n key without namespace, please use ui.* or game.* explicitly:',
            key,
        );
        return '' as unknown as T;
    },
}));

async function loadJSON(path: string) {
    try {
        const mod: any = await import(/* @vite-ignore */ path);
        return mod.default ?? mod;
    } catch (_e) {
        return {};
    }
}

// Load locale data using Worker (with fallback)
async function loadWithWorker(locale: Lang): Promise<II18nBundle> {
    return new Promise((resolve, reject) => {
        if (!worker) {
            reject(new Error('Worker not available'));
            return;
        }

        const handleMessage = (e: MessageEvent) => {
            if (e.data.locale !== locale) return; // Ignore messages for other locales
            
            worker?.removeEventListener('message', handleMessage);
            
            if (e.data.type === 'success') {
                resolve({
                    ui: e.data.ui as Record<string, any>,
                    game: e.data.game as Record<string, any>,
                });
            } else if (e.data.type === 'error') {
                reject(new Error(e.data.error));
            }
        };

        worker.addEventListener('message', handleMessage);
        worker.postMessage({ type: 'load', locale });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            worker?.removeEventListener('message', handleMessage);
            reject(new Error('Worker timeout'));
        }, 10000);
    });
}

async function loadAndSet(locale: Lang) {
    let ui: any;
    let game: any;

    // Preload fonts for this locale in parallel
    const fontRegion = localeToFontRegion(locale);
    const fontUrls = getFontUrlsForRegion(fontRegion);
    const fontPreloadPromise = preloadFonts(fontUrls).catch(err => 
        LOGGER.warn('Font preload failed:', err)
    );

    // Try worker first, fall back to main thread
    try {
        if (worker) {
            const data = await loadWithWorker(locale);
            ui = data.ui;
            game = data.game;
        } else {
            throw new Error('Worker not available');
        }
    } catch (error) {
        LOGGER.warn('Worker loading failed, falling back to main thread:', error);
        [ui, game] = await Promise.all([
            loadJSON(`./data/ui/${locale}.json`),
            loadJSON(`./data/game/${locale}.json`),
        ]);
    }

    useI18nStore.setState({ locale, data: { game, ui } });
    
    // Wait for font preloading to complete before updating UI
    await fontPreloadPromise;
    
    // Sync document language tag for :lang() or [lang] based styles/fonts switching
    try {
        if (typeof document !== 'undefined') {
            const htmlLang = toBCP47(locale);
            document.documentElement.setAttribute('lang', htmlLang);
        }
    } catch {
        // ignore envs without document
    }
}

async function init() {
    const locale = getLanguage();
    await loadAndSet(locale);
}
void init();

export const useTranslate = () => {
    const { t } = useI18nStore();
    return t;
};

// package namespace functions
export const useTranslateUI = () => {
    const t = useTranslate();
    return (k: string) => t(`ui.${k}`);
};
export const useTranslateGame = () => {
    const t = useTranslate();
    return (k: string) => t(`game.${k}`);
};

export const useLocale = () => useI18nStore((s) => s.locale);

export async function setLocale(lang: string) {
    const normalized = normalizeLang(lang) as Lang;
    await loadAndSet(normalized);
    try {
        if (typeof window !== 'undefined' && 'localStorage' in window) {
            window.localStorage.setItem(STORAGE_KEY, normalized);
        }
    } catch {
        // ignore storage errors (e.g., Safari private mode)
    }
}
