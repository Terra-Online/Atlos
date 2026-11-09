import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DomainBanner from './domain';
import { MetaHelper } from '@/pages/MetaHelper';
import FavPOI from '@/pages/favPOI/favPOI';
import { useUiPrefsStore } from '@/store/uiPrefs';

const state = vi.hoisted(() => ({ locale: 'en-US', title: 'Map title', description: 'Map description', fetch: vi.fn(),
    t: (key: string): string => key === 'meta.title' ? state.title : key === 'meta.description' ? state.description : key }));
vi.mock('@/locale', () => ({ useLocale: () => state.locale, useTranslateUI: () => state.t }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
const prefs = useUiPrefsStore.getState();
const head = document.head.innerHTML;
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('fetch', state.fetch); state.locale = 'en-US'; state.title = 'Map title'; state.description = 'Map description';
    useUiPrefsStore.setState({ isUserGuideOpen: false, isAnnouncementOpen: false, announcementFlowReady: true });
    localStorage.removeItem('domain-prefs'); window.history.replaceState(null, '', '/?domain=org');
    state.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ country_code: 'CN' }) });
});
afterEach(() => { cleanup(); document.head.innerHTML = head; useUiPrefsStore.setState(prefs, true); localStorage.removeItem('domain-prefs'); window.history.replaceState(null, '', '/'); document.documentElement.removeAttribute('data-theme'); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const flush = async () => act(async () => { await Promise.resolve(); });

it('waits for the guide and announcements, recommends the alternate domain and persists only a completed dismissal', async () => {
    useUiPrefsStore.setState({ isUserGuideOpen: true, announcementFlowReady: false }); render(<DomainBanner />);
    expect(state.fetch).not.toHaveBeenCalled();
    act(() => { useUiPrefsStore.setState({ isUserGuideOpen: false, announcementFlowReady: true, isAnnouncementOpen: true }); });
    expect(state.fetch).not.toHaveBeenCalled();
    act(() => { useUiPrefsStore.setState({ isAnnouncementOpen: false }); }); await flush();
    expect(screen.getByText('domain.cn')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(localStorage.getItem('domain-prefs')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(JSON.parse(localStorage.getItem('domain-prefs')!)).toEqual({ dismissed: true, expiresAt: Date.now() + 30 * 86400_000 });
    expect(screen.queryByText('domain.cn')).toBeNull();
});

it.each(['dismissed', 'matched', 'unavailable', 'unknown'] as const)('does not show a recommendation for %s', async (mode) => {
    if (mode === 'dismissed') localStorage.setItem('domain-prefs', JSON.stringify({ dismissed: true, expiresAt: Date.now() + 10000 }));
    if (mode === 'matched') state.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ country_code: 'US' }) });
    if (mode === 'unavailable') { state.fetch.mockRejectedValue(new Error('offline')); vi.spyOn(console, 'warn').mockImplementation(() => {}); }
    if (mode === 'unknown') window.history.replaceState(null, '', '/');
    render(<DomainBanner />); await flush();
    expect(screen.queryByRole('button')).toBeNull();
    if (mode === 'dismissed' || mode === 'unknown') expect(state.fetch).not.toHaveBeenCalled();
});

it('expires an old dismissal and recommends the international domain for a non-China visitor on cn', async () => {
    window.history.replaceState(null, '', '/?domain=cn'); localStorage.setItem('domain-prefs', JSON.stringify({ dismissed: true, expiresAt: Date.now() - 1 }));
    state.fetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ country_code: 'US' }) }); render(<DomainBanner />); await flush();
    expect(localStorage.getItem('domain-prefs')).toBeNull(); expect(screen.getByText('domain.org')).toBeTruthy();
});

it('updates locale metadata without duplicating name tags and preserves unrelated head elements', () => {
    const og = document.createElement('meta'); og.setAttribute('property', 'og:title'); document.head.append(og);
    const unrelated = document.createElement('meta'); unrelated.name = 'theme-color'; unrelated.content = '#fff'; document.head.append(unrelated);
    const view = render(<><MetaHelper /><FavPOI /></>);
    expect(document.title).toBe('Map title'); expect(document.documentElement.lang).toBe('en-US'); expect(og.content).toBe('Map title');
    state.locale = 'zh-CN'; state.title = '地图'; state.description = '说明'; view.rerender(<><MetaHelper /><FavPOI /></>);
    expect(document.title).toBe('地图'); expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe('说明');
    expect(unrelated.content).toBe('#fff'); expect(view.container.children).toHaveLength(0);
});
