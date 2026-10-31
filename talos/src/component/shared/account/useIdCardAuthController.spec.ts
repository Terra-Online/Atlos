import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import { useIdCardAuthController } from '@/component/shared/account/useIdCardAuthController';
import { openOemAccountModal, openOemAuthModal } from '@/component/shared/account/authEvents';

const mocks = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), exchange: vi.fn(), refresh: vi.fn(), save: vi.fn(), logout: vi.fn(), pause: vi.fn(() => vi.fn()) }));
vi.mock('@/services/auth', async (original) => ({
    ...await original<typeof import('@/services/auth')>(),
    registerWithEmail: mocks.register, loginWithEmail: mocks.login, exchangeAuthCode: mocks.exchange,
    updateProfileNickname: mocks.save, logoutUser: mocks.logout,
}));
vi.mock('@/locale', () => ({ getCurrentLocale: () => 'en' }));
vi.mock('@/services/auth/sessionLifecycle', () => ({
    refreshSessionUser: mocks.refresh, startSessionRefresh: () => vi.fn(), pauseSessionRefresh: mocks.pause,
}));

const user = { uid: '100771AB', nickname: 'ProviderName', email: 'new@example.test' };
const values = { email: 'new@example.test', password: 'Password123', repeatPassword: 'Password123', verificationCode: '123456' };

describe('authentication completion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
        window.history.replaceState({}, '', '/');
        useAuthStore.getState().clearSessionUser();
        mocks.register.mockReset().mockResolvedValue(undefined);
        mocks.login.mockReset().mockResolvedValue(undefined);
        mocks.exchange.mockReset();
        mocks.refresh.mockReset().mockResolvedValue(null);
        mocks.pause.mockClear();
        mocks.save.mockReset().mockResolvedValue({ ...user, nickname: 'Changed' });
        mocks.logout.mockReset().mockResolvedValue(undefined);
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); });

    it('opens the same profile as the avatar and follows session changes', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser({ ...user, avatar: 3 }));
        act(() => openOemAccountModal());
        expect(result.current.profileOpen).toBe(true);
        expect(result.current.open).toBe(false);
        expect(result.current.profileName).toBe(user.nickname);
        expect(result.current.profileAvatar).toBe(3);

        act(() => {
            result.current.setProfileOpen(false);
            useAuthStore.getState().clearSessionUser();
        });
        act(() => openOemAccountModal());
        expect(result.current.profileOpen).toBe(false);
        expect(result.current.open).toBe(true);
    });

    it.each([['register', false], ['login', true]] as const)(
        'opens %s for a signed-out account entry with previous login=%s',
        async (mode, previousLogin) => {
            if (previousLogin) localStorage.setItem('onceLogin', 'true');
            const { result } = renderHook(useIdCardAuthController);
            await act(async () => {});
            act(() => openOemAccountModal());
            expect(result.current.open).toBe(true);
            expect(result.current.activeTab).toBe(mode);
            expect(result.current.profileOpen).toBe(false);
        },
    );

    it('keeps explicit authentication requests on their requested tab', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => openOemAuthModal('login'));
        expect(result.current.open).toBe(true);
        expect(result.current.activeTab).toBe('login');
        expect(result.current.profileOpen).toBe(false);
    });

    it('confirms registration before showing success or waiting for animation', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        let finish!: (value: typeof user & { needsProfileSetup?: boolean }) => void;
        mocks.refresh.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        let pending!: Promise<void>;
        await act(async () => { pending = result.current.handleAutoSubmit({ mode: 'register', values }); await Promise.resolve(); });
        expect(mocks.register).toHaveBeenCalledOnce();
        expect(mocks.refresh).toHaveBeenLastCalledWith('new@example.test');
        expect(result.current.authError).not.toBe('201');
        expect(localStorage.getItem('onceLogin')).toBeNull();
        await act(async () => { finish({ ...user, needsProfileSetup: true }); await Promise.resolve(); });
        expect(result.current.authError).toBe('201');
        expect(localStorage.getItem('onceLogin')).toBe('true');
        expect(result.current.profileOpen).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(3333); await pending; });
        expect(result.current.profileOpen).toBe(true);
    });

    it('does not claim success when session confirmation returns no user', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        await act(async () => { await result.current.handleAutoSubmit({ mode: 'register', values }); });
        expect(result.current.authError).toBe('602');
        expect(localStorage.getItem('onceLogin')).toBeNull();
        expect(mocks.register).toHaveBeenCalledOnce();
    });

    it('uses a single exchange across Strict Mode effects and keeps its result authoritative', async () => {
        window.history.replaceState({}, '', '/?auth_code=test-code');
        let finish!: (value: typeof user) => void;
        mocks.exchange.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
        renderHook(useIdCardAuthController, { wrapper: ({ children }) => createElement(StrictMode, null, children) });
        expect(mocks.exchange).toHaveBeenCalledOnce();
        expect(mocks.refresh).not.toHaveBeenCalled();
        expect(window.location.search).toBe('');
        await act(async () => { finish(user); await Promise.resolve(); });
        expect(useAuthStore.getState().sessionUser).toEqual(user);
    });

    it('shows a provider callback error instead of silently returning to the map', async () => {
        window.history.replaceState({}, '', '/?error=access_denied');
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        expect(result.current.open).toBe(true);
        expect(result.current.authError).toBe('603');
        expect(window.location.search).toBe('');
    });

    it('saves changed names on close, retains the profile on failure, and does not write unchanged profiles', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser({ ...user, avatar: 3 }));
        act(() => result.current.handleAvatarClick());
        await act(() => result.current.handleCloseProfile());
        expect(mocks.save).not.toHaveBeenCalled();
        expect(result.current.profileOpen).toBe(false);
        act(() => result.current.handleAvatarClick());
        act(() => result.current.setProfileName('Changed'));
        mocks.save.mockRejectedValueOnce(new Error('save unavailable'));
        await act(() => result.current.handleCloseProfile());
        expect(result.current.profileOpen).toBe(true);
        expect(result.current.profileError).toBe('save unavailable');
        expect(useAuthStore.getState().sessionUser?.nickname).toBe(user.nickname);
        await act(() => result.current.handleCloseProfile());
        expect(result.current.profileOpen).toBe(false);
        expect(useAuthStore.getState().sessionUser?.nickname).toBe('Changed');
        expect(mocks.save).toHaveBeenLastCalledWith('Changed', 3);
    });

    it.each(['logout', 'another account'] as const)('does not apply a stale profile save after %s', async (change) => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser(user));
        act(() => result.current.handleAvatarClick());
        act(() => result.current.setProfileName('Changed'));
        let finish!: (value: typeof user) => void;
        mocks.save.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleSaveProfile(); });
        const nextUser = change === 'logout' ? null : { ...user, uid: 'second-user', nickname: 'Another' };
        act(() => useAuthStore.getState().setSessionUser(nextUser));
        await act(async () => { finish({ ...user, nickname: 'Changed' }); await pending; });
        expect(useAuthStore.getState().sessionUser).toEqual(nextUser);
    });

    it('preserves the current user after failed logout and clears it only after confirmation', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser(user));
        act(() => result.current.handleAvatarClick());
        mocks.logout.mockRejectedValueOnce(new Error('logout unavailable'));
        await act(() => result.current.handleLogout());
        expect(result.current.profileOpen).toBe(true);
        expect(result.current.profileError).toBe('logout unavailable');
        expect(useAuthStore.getState().sessionUser).toEqual(user);
        await act(() => result.current.handleLogout());
        expect(useAuthStore.getState().sessionUser).toBeNull();
        expect(result.current.profileOpen).toBe(false);
        expect(result.current.profileError).toBeNull();
    });

    it('completes logout after a same-account session refresh', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser(user));
        let resolve!: () => void;
        mocks.logout.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleLogout(); });
        act(() => useAuthStore.getState().updateSessionUser({ ...user, nickname: 'Refreshed' }));
        await act(async () => { resolve(); await pending; });
        expect(useAuthStore.getState().sessionUser).toBeNull();
        expect(result.current.profileOpen).toBe(false);
    });

    it('completes background authentication without replacing a panel reopened in the same batch', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        let resolve!: () => void;
        mocks.login.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
        const authenticated = { ...user, needsProfileSetup: true };
        mocks.refresh.mockImplementation(() => {
            useAuthStore.getState().setSessionUser(authenticated);
            return Promise.resolve(authenticated);
        });
        act(() => result.current.openAuthModal('login'));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleAutoSubmit({ mode: 'login', values }); });
        act(() => { result.current.setOpen(false); result.current.openAuthModal('register'); });
        await act(async () => { resolve(); await Promise.resolve(); await Promise.resolve(); });
        await act(async () => { vi.advanceTimersByTime(4000); await pending; });
        expect(useAuthStore.getState().sessionUser).toEqual(authenticated);
        expect(result.current.open).toBe(true);
        expect(result.current.activeTab).toBe('register');
        expect(result.current.authError).toBeNull();
        expect(result.current.profileOpen).toBe(false);
    });

    it.each(['reopen', 'change mode', 'unmount'] as const)('invalidates pending success transitions on %s', async (boundary) => {
        const hook = renderHook(useIdCardAuthController);
        await act(async () => {});
        mocks.refresh.mockResolvedValue({ ...user, needsProfileSetup: true });
        act(() => hook.result.current.openAuthModal('login'));
        let pending!: Promise<void>;
        await act(async () => { pending = hook.result.current.handleAutoSubmit({ mode: 'login', values }); await Promise.resolve(); });
        expect(hook.result.current.authError).toBe('200');
        if (boundary === 'unmount') { hook.unmount(); expect(vi.getTimerCount()).toBe(0); }
        else if (boundary === 'reopen') act(() => { hook.result.current.setOpen(false); hook.result.current.openAuthModal('register'); });
        else act(() => hook.result.current.setActiveTab('register'));
        await act(async () => { vi.advanceTimersByTime(4000); await pending; });
        if (boundary === 'unmount') expect(vi.getTimerCount()).toBe(0);
        else {
            expect(hook.result.current.open).toBe(true);
            expect(hook.result.current.activeTab).toBe('register');
            expect(hook.result.current.profileOpen).toBe(false);
            expect(hook.result.current.isSubmitting).toBe(false);
        }
    });

    it('does not copy an old request failure into a newly opened authentication panel', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        let reject!: (error: Error) => void;
        mocks.login.mockReturnValueOnce(new Promise<void>((_resolve, fail) => { reject = fail; }));
        act(() => result.current.openAuthModal('login'));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleAutoSubmit({ mode: 'login', values }); });
        act(() => { result.current.setOpen(false); result.current.openAuthModal('register'); });
        await act(async () => { reject(new Error('old network failure')); await pending; });
        expect(result.current.authError).toBeNull();
        expect(result.current.open).toBe(true);
        expect(result.current.activeTab).toBe('register');
    });

    it('does not clear a newer session or close its authentication panel when an older logout finishes', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        act(() => useAuthStore.getState().setSessionUser(user));
        let resolve!: () => void;
        mocks.logout.mockReturnValueOnce(new Promise<void>((done) => { resolve = done; }));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleLogout(); });
        const current = { ...user, uid: 'new-session-owner' };
        act(() => {
            useAuthStore.getState().setSessionUser(current);
            result.current.openAuthModal('register');
        });
        await act(async () => { resolve(); await pending; });
        expect(useAuthStore.getState().sessionUser).toEqual(current);
        expect(result.current.open).toBe(true);
        expect(result.current.activeTab).toBe('register');
    });

    it('keeps the current successful transition when the active tab is selected again', async () => {
        const { result } = renderHook(useIdCardAuthController);
        await act(async () => {});
        mocks.refresh.mockResolvedValue(user);
        act(() => result.current.openAuthModal('login'));
        let pending!: Promise<void>;
        await act(async () => { pending = result.current.handleAutoSubmit({ mode: 'login', values }); await Promise.resolve(); });
        expect(result.current.authError).toBe('200');
        act(() => result.current.setActiveTab('login'));
        await act(async () => { vi.advanceTimersByTime(3333); await pending; });
        expect(result.current.open).toBe(false);
        expect(result.current.isSubmitting).toBe(false);
    });
});
