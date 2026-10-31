import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import UIOverlay from './UIOverlay';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useAuthStore } from '@/store/auth';
import type { NotificationLiveUpdate, NotificationUnreadCounts } from '@/services/notifications/client';
import { installResizeObserver } from '../../../test-support/browser';
type PanelProps = { open: boolean; onClose: () => void; liveUpdate?: NotificationLiveUpdate | null; syncVersion?: number };
const state = vi.hoisted(() => ({ mobile: false, pip: false, suppress: false, unread: false, checked: true, subscribe: vi.fn(), unsubscribe: vi.fn(), account: vi.fn(), initTheme: vi.fn(), cleanupTheme: vi.fn(), toggleTheme: vi.fn(), t: (key: string) => key,
    live: null as { onReady: (counts: NotificationUnreadCounts) => void; onUpdate: (update: NotificationLiveUpdate) => void; onOpen: () => void } | null }));
vi.mock('@/locale', () => ({ useTranslateUI: () => state.t, useLocale: () => 'en-US' }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update: () => {}, stop: () => {} }) }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: state.mobile }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppPictureInPicture: () => ({ active: state.pip }), useAppDocument: () => document }));
vi.mock('@/platform/theme', () => ({ initTheme: state.initTheme, cleanupTheme: state.cleanupTheme, toggleTheme: state.toggleTheme }));
vi.mock('@/component/shared/account/authEvents', () => ({ openOemAccountModal: state.account }));
vi.mock('@/services/routing', () => ({ shouldSuppressInitialAutoOverlays: () => state.suppress }));
vi.mock('./useAnnFlow', async () => {
    const { useState } = await import('react');
    return { useAnnouncementFlow: () => { const [unread, setUnread] = useState(state.unread); return { announcements: [], hasUnreadAnnouncement: unread, setHasUnreadAnnouncement: setUnread, announcementChecked: state.checked }; } };
});
vi.mock('@/services/notifications/client', () => ({ subscribeNotificationLive: (callbacks: NonNullable<typeof state.live>) => { state.live = callbacks; state.subscribe(); return state.unsubscribe; } }));
vi.mock('@/component/shared/language/language', () => ({ default: ({ open, onClose }: PanelProps) => open ? <section role="dialog" aria-label="Language"><button onClick={onClose}>Close language</button></section> : null }));
vi.mock('@/pages/notify/notify', () => ({ default: ({ open, onClose, syncVersion }: PanelProps) => open ? <section role="dialog" aria-label="Notifications" data-sync={syncVersion}><button onClick={onClose}>Close notifications</button></section> : null }));
vi.mock('@/pages/settings/settings', () => ({ default: ({ open, onClose }: PanelProps) => open ? <section role="dialog" aria-label="Settings"><button onClick={onClose}>Close settings</button></section> : null }));
vi.mock('@/pages/announcement/announcement', () => ({ default: ({ open, onClose }: PanelProps) => open ? <section role="dialog" aria-label="Announcements"><button onClick={onClose}>Close announcements</button></section> : null }));
vi.mock('@/pages/regSwitch/regSwitch', () => ({ RegionContainer: () => <div data-testid="region-control" /> }));
vi.mock('@/pages/layerSwitch/layerSwitch', () => ({ LayerSwitch: () => null }));
vi.mock('@/pages/locator', () => ({ LocatorButton: ({ variant }: { variant: string }) => <div data-testid={`locator-${variant}`} /> }));
vi.mock('@/pages/detail/detail', () => ({ Detail: () => <div data-testid="desktop-detail" /> }));
vi.mock('@/pages/filterList/filterList.desktop', () => ({ default: () => <div data-testid="desktop-filter-list" /> }));
vi.mock('@/pages/scopeIndicator/ScopeIndicator', () => ({ default: () => null }));
vi.mock('@/pages/scale/scale', () => ({ default: () => null }));
const prefs = useUiPrefsStore.getState(), auth = useAuthStore.getState();
beforeEach(() => { vi.clearAllMocks(); installResizeObserver(); state.mobile = false; state.pip = false; state.suppress = false; state.unread = false; state.checked = true; state.live = null; useUiPrefsStore.setState({ isUserGuideOpen: false, announcementFlowReady: false }); useAuthStore.setState({ sessionUser: null }); });
afterEach(() => { cleanup(); useUiPrefsStore.setState(prefs, true); useAuthStore.setState(auth, true); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const click = async (name: string) => act(async () => { fireEvent.click(screen.getByRole('button', { name })); await Promise.resolve(); });

it('opens panels through real headbar controls, clears them on UI hide and keeps the visibility control available', async () => {
    const toggle = vi.fn(); const view = render(<UIOverlay isSidebarOpen onToggleUI={toggle} />);
    await click('headbar.language'); expect(screen.getByRole('dialog', { name: 'Language' })).toBeTruthy();
    await click('headbar.settings'); expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    view.rerender(<UIOverlay isSidebarOpen visible={false} onToggleUI={toggle} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    const hide = screen.getByRole('button', { name: /headbar.hideUI/ }); fireEvent.click(hide); expect(toggle).toHaveBeenCalledOnce();
    expect(screen.getByTestId('desktop-detail').closest('[inert]')).toBeTruthy();
    view.rerender(<UIOverlay isSidebarOpen visible={false} showVisibilityControl={false} />);
    expect(screen.queryByRole('button', { name: /headbar.hideUI/ })).toBeNull();
});

it('waits for detailed guide readiness before automatically opening an unread announcement once', async () => {
    state.unread = true; useUiPrefsStore.setState({ isUserGuideOpen: true });
    const view = render(<UIOverlay isSidebarOpen={false} userGuideReady={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    view.rerender(<UIOverlay isSidebarOpen={false} userGuideReady />); expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => { useUiPrefsStore.getState().setIsUserGuideOpen(false); await Promise.resolve(); });
    expect(screen.getByRole('dialog', { name: 'Announcements' })).toBeTruthy();
    expect(useUiPrefsStore.getState().isAnnouncementOpen).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close announcements' }));
    expect(useUiPrefsStore.getState()).toMatchObject({ isAnnouncementOpen: false, announcementFlowReady: true });
    view.rerender(<UIOverlay isSidebarOpen={false} userGuideReady />); expect(screen.queryByRole('dialog')).toBeNull();
});

it('suppresses initial auto panels on shared links while retaining explicit announcement intent and PiP restrictions', async () => {
    state.suppress = true; state.unread = true; const view = render(<UIOverlay isSidebarOpen={false} userGuideReady />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(useUiPrefsStore.getState().announcementFlowReady).toBe(true);
    await click('headbar.announcement'); expect(screen.getByRole('dialog', { name: 'Announcements' })).toBeTruthy();
    state.pip = true; view.rerender(<UIOverlay isSidebarOpen={false} userGuideReady />);
    for (const name of ['headbar.auth', 'headbar.help', 'headbar.announcement']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
});

it('moves notification subscriptions with accounts, drops old callbacks and cleans the active subscription on unmount', async () => {
    useAuthStore.setState({ sessionUser: { uid: 'a', nickname: 'A' } }); const view = render(<UIOverlay isSidebarOpen={false} />);
    const old = state.live!; act(() => { old.onReady({ system: 1, community: 2, total: 3 }); });
    expect(view.container.querySelector('[data-badge="notify"]')).toBeTruthy();
    act(() => { useAuthStore.setState({ sessionUser: null }); });
    expect(state.unsubscribe).toHaveBeenCalledOnce();
    act(() => { old.onReady({ system: 1, community: 2, total: 3 }); });
    expect(view.container.querySelector('[data-badge="notify"]')).toBeNull();
    act(() => { useAuthStore.setState({ sessionUser: { uid: 'b', nickname: 'B' } }); });
    expect(state.subscribe).toHaveBeenCalledTimes(2); act(() => { state.live!.onOpen(); });
    await click('headbar.notification'); expect(screen.getByRole('dialog', { name: 'Notifications' }).getAttribute('data-sync')).toBe('1');
    view.unmount(); expect(state.unsubscribe).toHaveBeenCalledTimes(2); expect(state.cleanupTheme).toHaveBeenCalledOnce();
});

it('renders a mobile locator without duplicating the desktop detail and filter strip', () => {
    state.mobile = true; render(<UIOverlay isSidebarOpen />);
    expect(screen.getByTestId('locator-mobile')).toBeTruthy(); expect(screen.queryByTestId('locator-desktop')).toBeNull();
    expect(screen.queryByTestId('desktop-detail')).toBeNull(); expect(screen.queryByTestId('desktop-filter-list')).toBeNull();
});
