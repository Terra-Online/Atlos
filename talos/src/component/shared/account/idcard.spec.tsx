import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import IDCard from './idcard';
import { useAuthStore } from '@/store/auth';
import { translate as t } from '../testFixtures';
import { OEM_AUTH_DISMISS_EVENT } from './authEvents';
import { installResizeObserver } from '../../../../test-support/browser';

const api = vi.hoisted(() => ({ refresh: vi.fn(), save: vi.fn(), logout: vi.fn() }));
vi.mock('@/services/auth', async (original) => ({ ...await original<typeof import('@/services/auth')>(), updateProfileNickname: api.save, logoutUser: api.logout }));
vi.mock('@/services/auth/sessionLifecycle', () => ({ refreshSessionUser: api.refresh, startSessionRefresh: () => () => {} }));
vi.mock('@/locale', async () => ({ ...(await import('../testFixtures')).localeFixture, getCurrentLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/component/shared/sync/ProgressSyncHost', () => ({ default: () => null }));

beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); installResizeObserver();
    useAuthStore.getState().clearSessionUser();
    api.refresh.mockResolvedValue(null);
    api.save.mockResolvedValue({ uid: '42', nickname: 'New_name', avatar: 2 });
    api.logout.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('opens registration for a new guest and reports auth dismissal without navigating away', async () => {
    const dismiss = vi.fn();
    window.addEventListener(OEM_AUTH_DISMISS_EVENT, dismiss);
    try {
        render(<IDCard />);
        await act(async () => {});
        expect(screen.queryByRole('dialog')).toBeNull();
        const path = window.location.pathname;
        fireEvent.click(screen.getByRole('button', { name: 'Open profile dialog' }));
        expect(screen.getByRole('dialog', { name: t('idcard.auth.register') })).toBeTruthy();
        expect(window.location.pathname).toBe(path);
        fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
        expect(dismiss).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(OEM_AUTH_DISMISS_EVENT, dismiss); }
});

it('opens the profile from the main avatar, sanitizes the editable name, and persists it through the real auth controller', async () => {
    useAuthStore.getState().setSessionUser({ uid: '42', nickname: 'Explorer', avatar: 2 });
    render(<IDCard />);
    await act(async () => {});
    const path = window.location.pathname;
    fireEvent.click(screen.getByRole('button', { name: 'Open profile dialog' }));
    expect(screen.getByRole('dialog', { name: t('idcard.profile.title') })).toBeTruthy();
    expect(window.location.pathname).toBe(path);
    expect(screen.getByRole('button', { name: t('idcard.profile.avatarHint') })).toBeTruthy();
    const name = screen.getByRole<HTMLInputElement>('textbox');
    fireEvent.change(name, { target: { value: 'New_ name!' } });
    expect(name.value).toBe('New_name');
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.save') }));
    await act(async () => {});
    expect(api.save).toHaveBeenCalledWith('New_name', 2);
    expect(useAuthStore.getState().sessionUser?.nickname).toBe('New_name');
    expect(screen.getByText('New_name')).toBeTruthy();
});
