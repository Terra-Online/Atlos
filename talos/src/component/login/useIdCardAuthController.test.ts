import { act, cleanup, renderHook } from '@testing-library/react';
import { StrictMode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth';
import { useIdCardAuthController } from './useIdCardAuthController';

const mocks = vi.hoisted(() => ({ register: vi.fn(), login: vi.fn(), exchange: vi.fn(), refresh: vi.fn(), pause: vi.fn(() => vi.fn()) }));
vi.mock('@/services/auth', async (original) => ({
    ...await original<typeof import('@/services/auth')>(),
    registerWithEmail: mocks.register, loginWithEmail: mocks.login, exchangeAuthCode: mocks.exchange,
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
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); });

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
});
