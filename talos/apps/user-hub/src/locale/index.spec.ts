import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { flush } from '../testSetup';
import {
    getCurrentLocale,
    i18nInitPromise,
    setLocale,
    translateUI,
    useTranslateUI,
} from './index';
import {
    getCurrentLocale as getMainLocale,
    i18nInitPromise as mainReady,
    setLocale as setMainLocale,
    translateUI as translateMainUI,
} from '@main/locale';

const { switchFontRegion } = vi.hoisted(() => ({
    switchFontRegion: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock('@main/locale/fontLoader', () => ({ switchFontRegion }));

afterEach(async () => {
    vi.restoreAllMocks();
    await setLocale('en-US');
});

it('switches app labels and Chinese font regions without changing the main catalog', async () => {
    await Promise.all([i18nInitPromise, mainReady]);
    await setMainLocale('en-US');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    const Label = () =>
        createElement('span', null, useTranslateUI()('userHub.tabs.profile'));
    try {
        await flush(() => root.render(createElement(Label)));
        expect(node.textContent).toBe('Personal info');
        await act(async () => {
            await setLocale('zh-TW');
        });
        expect(getCurrentLocale()).toBe('zh-HK');
        expect(node.textContent).toBe('個人資料');
        expect(switchFontRegion).toHaveBeenCalledWith('HK');
        expect(localStorage.getItem('talos:locale')).toBe('zh-HK');
        expect(document.documentElement.lang).toBe('zh-HK');
        expect(getMainLocale()).toBe('en-US');
        expect(translateMainUI('userHub.tabs.profile', 'absent')).toBe(
            'absent',
        );
        expect(translateMainUI('idcard.profile.userCenter')).toBe(
            'User center',
        );
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('uses the app English fallback for languages without a catalog and preserves placeholders', async () => {
    await i18nInitPromise;
    await setLocale('fr-FR');
    expect(getCurrentLocale()).toBe('fr-FR');
    expect(translateUI('userHub.tabs.contributions')).toBe('Content center');
    expect(translateUI('userHub.avatarChoice')).toBe('Avatar {index}');
    expect(translateUI('missing.key', 'missing')).toBe('missing');
});

it('still switches language when locale storage is unavailable', async () => {
    await i18nInitPromise;
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
        throw new Error('Storage unavailable');
    });
    await setLocale('zh-CN');
    expect(translateUI('userHub.tabs.contributions')).toBe('内容中心');
    expect(switchFontRegion).toHaveBeenCalledWith('CN');
});
