import { indexFontAssets } from '@main/lib/i18n/fontAssets';

const fontAssetUrlModules = import.meta.glob<string>(
    ['../assets/fonts/UD_ShinGo/*.woff2', '../assets/fonts/Harmony/*.woff2'],
    { eager: true, query: '?url', import: 'default' },
);

export const { getFontAssetUrl, getFontAssetUrls } = indexFontAssets(fontAssetUrlModules);
