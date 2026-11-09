import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LanguageModal from './language';
import { getCurrentLocale, i18nInitPromise, setLocale, SUPPORTED_LANGS } from '@/locale';
import { deferred, translate as t } from '../testFixtures';
import { installResizeObserver } from '../../../../test-support/browser';

const fonts = vi.hoisted(() => ({ region: vi.fn(), manifests: vi.fn(), switch: vi.fn().mockResolvedValue(undefined), runs: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/locale/fontLoader', () => ({
    preloadFontRegion: fonts.region, preloadFontManifests: fonts.manifests,
    preloadFontRuns: fonts.runs, switchFontRegion: fonts.switch,
    registerFontRegion: () => ({ update: () => {}, stop: () => {} }),
}));
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);

beforeEach(async () => {
    installResizeObserver();
    fonts.switch.mockResolvedValue(undefined);
    await i18nInitPromise;
    await setLocale('en-US');
    vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('lists every supported locale as a radio and warms intent without changing the committed locale', async () => {
    const prepare = vi.fn().mockResolvedValue({});
    const warmFonts = vi.fn();
    render(<LanguageModal open onClose={vi.fn()} prepareLocale={prepare} preloadFonts={warmFonts} />);
    expect(screen.getAllByRole('radio')).toHaveLength(SUPPORTED_LANGS.length);
    expect(screen.getByRole('radio', { checked: true }).getAttribute('aria-label')).toBe(t('language.names.en-US'));
    expect(fonts.manifests).toHaveBeenCalledOnce();
    expect(fonts.region).not.toHaveBeenCalled();
    const row = screen.getByRole('radio', { name: t('language.names.ja-JP') });
    fireEvent.mouseEnter(row);
    fireEvent.focus(row);
    await act(async () => {});
    expect(prepare.mock.calls.filter(([lang]) => lang === 'ja-JP')).toHaveLength(2); // initial CJK catalog warmup plus row intent
    expect(warmFonts).toHaveBeenCalledWith('ja-JP');
    expect(getCurrentLocale()).toBe('en-US');
});

it('commits shared and app catalogs together and calls onSelected only for the winning choice', async () => {
    const japanese = deferred<{ language: string }>();
    const chinese = deferred<{ language: string }>();
    const prepare = vi.fn((lang: string) => lang === 'ja-JP' ? japanese.promise : lang === 'zh-CN' ? chinese.promise : Promise.resolve({ language: lang }));
    const commit = vi.fn();
    const selected = vi.fn();
    render(<LanguageModal open onClose={vi.fn()} prepareLocale={prepare} commitLocale={commit} onSelected={selected} />);
    fireEvent.click(screen.getByRole('radio', { name: t('language.names.ja-JP') }));
    fireEvent.click(screen.getByRole('radio', { name: t('language.names.zh-CN') }));
    expect(getCurrentLocale()).toBe('en-US');
    expect(commit).not.toHaveBeenCalled();
    await act(async () => { chinese.resolve({ language: 'zh-CN' }); await chinese.promise; });
    await waitFor(() => expect(getCurrentLocale()).toBe('zh-CN'));
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('zh-CN', { language: 'zh-CN' });
    expect(selected).toHaveBeenCalledOnce();
    expect(selected).toHaveBeenCalledWith('zh-CN');
    await act(async () => { japanese.resolve({ language: 'ja-JP' }); await japanese.promise; });
    expect(getCurrentLocale()).toBe('zh-CN');
    expect(selected).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
});

it('keeps the old language after preparation fails and allows retrying the same row', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const prepare = vi.fn().mockResolvedValue({}).mockImplementationOnce(() => Promise.resolve({}));
    const selected = vi.fn();
    render(<LanguageModal open onClose={vi.fn()} prepareLocale={prepare} commitLocale={vi.fn()} onSelected={selected} />);
    prepare.mockRejectedValueOnce(new Error('app catalog unavailable'));
    fireEvent.click(screen.getByRole('radio', { name: t('language.names.ja-JP') }));
    await act(async () => {});
    await waitFor(() => expect(console.warn).toHaveBeenCalled());
    expect(getCurrentLocale()).toBe('en-US');
    expect(selected).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: t('language.names.ja-JP') }));
    await waitFor(() => expect(getCurrentLocale()).toBe('ja-JP'));
    expect(selected).toHaveBeenCalledWith('ja-JP');
});

it('does not switch when the already selected locale is clicked', () => {
    const selected = vi.fn();
    render(<LanguageModal open onClose={vi.fn()} onSelected={selected} />);
    fireEvent.click(screen.getByRole('radio', { checked: true }));
    expect(fonts.switch).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
});

it('treats a failed intent prefetch as optional and can still select that locale afterward', async () => {
    const prepare = vi.fn().mockResolvedValue({});
    render(<LanguageModal open onClose={vi.fn()} prepareLocale={prepare} />);
    prepare.mockRejectedValueOnce(new Error('prefetch offline'));
    act(() => screen.getByRole('radio', { name: t('language.names.de-DE') }).focus());
    await act(async () => {});
    expect(prepare).toHaveBeenCalledWith('de-DE');
    expect(getCurrentLocale()).toBe('en-US');
    fireEvent.click(screen.getByRole('radio', { name: t('language.names.de-DE') }));
    await waitFor(() => expect(getCurrentLocale()).toBe('de-DE'));
});

it('uses the latest app callbacks when the picker receives updated integration props', () => {
    const oldFonts = vi.fn();
    const newFonts = vi.fn();
    const oldPrepare = vi.fn().mockResolvedValue({});
    const newPrepare = vi.fn().mockResolvedValue({});
    const view = render(<LanguageModal open onClose={vi.fn()} preloadFonts={oldFonts} prepareLocale={oldPrepare} />);
    view.rerender(<LanguageModal open onClose={vi.fn()} preloadFonts={newFonts} prepareLocale={newPrepare} />);
    newPrepare.mockClear();
    act(() => screen.getByRole('radio', { name: t('language.names.de-DE') }).focus());
    expect(newFonts).toHaveBeenCalledWith('de-DE');
    expect(oldFonts).not.toHaveBeenCalled();
    expect(newPrepare).toHaveBeenCalledWith('de-DE');
});
