import { flush } from './testSetup';
import { createElement } from 'react';
import { waitFor, within } from '@testing-library/react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { Overview } from './types';
import { useAuthStore } from '@main/store/auth';

const api = vi.hoisted(() => ({
    clearReadCache: vi.fn(),
    getOverview: vi.fn(),
    getContributions: vi.fn(),
    saveProfile: vi.fn(),
}));
const auth = vi.hoisted(() => ({
    openAvatar: vi.fn(),
    open: true,
    ready: true,
    profileOpen: false,
    submitting: false,
}));
vi.mock('./api/client', () => ({
    ...api,
    isUnauthorized: (error: unknown) =>
        error instanceof Error && error.message === 'Unauthorized',
}));
vi.mock('@main/component/shared/account/useIdCardAuthController', () => ({
    useIdCardAuthController: () => ({
        authReady: auth.ready,
        sessionUser: useAuthStore((state) => state.sessionUser),
        hasLoggedInBefore: false,
        handleAvatarClick: auth.openAvatar,
        open: auth.open,
        profileOpen: auth.profileOpen,
        isSubmitting: auth.submitting,
    }),
}));
vi.mock('@main/component/shared/account/useIdCardProfileViewModel', () => ({
    useIdCardProfileViewModel: ({ sessionUser }: { sessionUser: Overview['user'] | null }) => ({
        displayName: sessionUser?.nickname ?? '',
    }),
}));
vi.mock('@main/component/shared/account/access', () => ({
    Access: ({ open }: { open: boolean }) =>
        createElement('div', { 'data-auth-open': open }),
}));
vi.mock('@main/component/shared/account/profile/profile', () => ({
    default: () => null,
}));
vi.mock('@main/locale', () => ({
    useTranslateUI: () => (key: string) => key,
    translateUI: (key: string) => key,
    getCurrentLocale: () => 'en-US',
    useLocale: () => 'en-US',
    useTranslateGame: () => () => '',
}));
vi.mock('@hub/locale', () => ({
    useTranslateUI: () => (key: string) => key,
    translateUI: (key: string) => key,
    getCurrentLocale: () => 'en-US',
    useLocale: () => 'en-US',
    setLocale: vi.fn(),
}));
vi.mock('@main/platform/theme', () => ({
    initTheme: vi.fn(),
    cleanupTheme: vi.fn(),
    toggleTheme: vi.fn(),
}));

const overview: Overview = {
    user: { uid: '42', nickname: 'Tester' },
    contributions: {
        imageCount: 2,
        commentCount: 3,
        pendingCount: 0,
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearSessionUser();
    auth.open = true;
    auth.ready = true;
    auth.profileOpen = false;
    auth.submitting = false;
    api.getOverview.mockReset().mockResolvedValue(overview);
    api.getContributions.mockReset().mockResolvedValue({ items: [], nextCursor: null });
    api.saveProfile.mockReset();
});

it('opens the shared avatar auth flow in place after a 401 and reloads after login', async () => {
    window.history.replaceState(null, '', '/me/');
    api.getOverview.mockRejectedValueOnce(new Error('Unauthorized'));
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(window.location.pathname).toBe('/me/content');
        await waitFor(() => expect(auth.openAvatar).toHaveBeenCalledOnce());
        expect(node.querySelector('[data-auth-open="true"]')).not.toBeNull();
        await flush(() =>
            within(node).getByRole('button', { name: 'idcard.auth.login' }).click(),
        );
        expect(auth.openAvatar).toHaveBeenCalledTimes(2);

        auth.open = false;
        await flush(() => { useAuthStore.getState().setSessionUser(overview.user); root.render(createElement(App)); });
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        expect(node.textContent).toContain('Tester');
        expect(node.querySelector('[data-auth-open]')).toBeNull();

        // A later authorization failure can recover for the same account.
        api.getOverview.mockRejectedValueOnce(new Error('Unauthorized'));
        await flush(() => node.querySelector<HTMLButtonElement>(
            'button[aria-label="userHub.refresh"]',
        )?.click());
        expect(api.getOverview).toHaveBeenCalledTimes(3);
        await flush(() => useAuthStore.getState().setSessionUser(overview.user));
        expect(api.getOverview).toHaveBeenCalledTimes(4);
        expect(node.textContent).toContain('Tester');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('stops retrying a restored session after repeated overview 401s and permits an explicit retry', async () => {
    api.getOverview.mockRejectedValue(new Error('Unauthorized'));
    useAuthStore.getState().setSessionUser(overview.user);
    auth.open = false;
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(api.getOverview).toHaveBeenCalledOnce();
        // A restored session is an actual store transition, not an independent
        // mock identity that survives the app's clearSessionUser() on 401.
        await flush(() => useAuthStore.getState().setSessionUser(overview.user));
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        expect(within(node).getByRole('button', { name: 'idcard.auth.login' })).not.toBeNull();
        await flush(() => root.render(createElement(App)));
        expect(api.getOverview).toHaveBeenCalledTimes(2);

        api.getOverview.mockResolvedValue(overview);
        await flush(() => within(node).getByRole('button', { name: 'idcard.auth.login' }).click());
        await flush(() => useAuthStore.getState().setSessionUser(overview.user));
        await flush(() => root.render(createElement(App)));
        expect(api.getOverview).toHaveBeenCalledTimes(3);
        expect(node.textContent).toContain('Tester');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

afterEach(() => window.history.replaceState(null, '', '/'));

it('redirects the excluded account page to content and reports refresh failures', async () => {
    window.history.replaceState(null, '', '/me/security');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(node.textContent).toContain('Tester');
        expect(window.location.pathname).toBe('/me/content');
        expect(node.textContent).not.toContain('userHub.loginMethods');
        expect(node.textContent).not.toContain('userHub.endfieldAccount');
        expect(api.getContributions).toHaveBeenCalledOnce();
        expect(
            node.querySelector('button[aria-label="userHub.signOut"]'),
        ).toBeNull();
        api.getOverview.mockRejectedValueOnce(
            new Error('Refresh failed (503)'),
        );
        const refresh = node.querySelector<HTMLButtonElement>(
            'button[aria-label="userHub.refresh"]',
        );
        await flush(() => refresh?.click());
        expect(node.querySelector('[role="alert"]')?.textContent).toContain(
            'Refresh failed (503)',
        );
        expect(refresh?.disabled).toBe(false);
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('opens contributions by default and keeps the two navigation destinations distinct', async () => {
    window.history.replaceState(null, '', '/me/');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(window.location.pathname).toBe('/me/content');
        expect(api.getContributions).toHaveBeenCalledOnce();
        expect(node.textContent).toContain('userHub.emptyContributions');
        const links = node.querySelectorAll<HTMLAnchorElement>('nav a');
        expect(links).toHaveLength(2);
        expect(node.querySelectorAll('[role="tab"]')).toHaveLength(2);
        expect(api.getContributions.mock.calls[0][0]).toBe('image');
        expect(node.querySelector('nav a[href="/me/account"]')).toBeNull();
        await flush(() => within(node).getByRole('button', { name: 'userHub.tabs.profile' }).click());
        expect(window.location.pathname).toBe('/me/profile');
        const profile = node.querySelector<HTMLAnchorElement>(
            'nav a[href="/me/profile"]',
        );
        await flush(() => profile?.click());
        expect(window.location.pathname).toBe('/me/profile');
        expect(profile?.getAttribute('aria-current')).toBe('page');
        expect(node.querySelectorAll('input[name="avatar"]')).toHaveLength(40);
        expect(node.textContent).not.toContain('userHub.emptyContributions');
        const content = node.querySelector<HTMLAnchorElement>(
            'nav a[href="/me/content"]',
        );
        await flush(() => content?.click());
        expect(window.location.pathname).toBe('/me/content');
        expect(node.textContent).toContain('userHub.emptyContributions');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('waits for auth readiness and modal submission completion before reloading an expired overview', async () => {
    api.getOverview.mockRejectedValueOnce(new Error('Unauthorized'));
    auth.ready = false;
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await waitFor(() => expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).not.toBeNull());
        expect(auth.openAvatar).not.toHaveBeenCalled();
        auth.ready = true;
        await flush(() => root.render(createElement(App)));
        expect(auth.openAvatar).toHaveBeenCalledOnce();
        auth.open = false;
        auth.submitting = true;
        await flush(() => { useAuthStore.getState().setSessionUser(overview.user); root.render(createElement(App)); });
        expect(api.getOverview).toHaveBeenCalledOnce();
        auth.submitting = false;
        auth.profileOpen = true;
        await flush(() => root.render(createElement(App)));
        expect(api.getOverview).toHaveBeenCalledOnce();
        auth.profileOpen = false;
        await flush(() => root.render(createElement(App)));
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        expect(node.textContent).toContain('Tester');
    } finally { await flush(() => root.unmount()); node.remove(); }
});

it('saves avatars immediately, rolls back failures and updates the card without reloading UGC', async () => {
    window.history.replaceState(null, '', '/me/profile');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        const choice = node.querySelector<HTMLInputElement>(
            'input[name="avatar"][value="2"]',
        );
        expect(
            Array.from(node.querySelectorAll('button')).some(
                (button) => button.textContent === 'idcard.profile.save',
            ),
        ).toBe(false);
        api.saveProfile.mockRejectedValueOnce(new Error('Save failed'));
        await flush(() => choice?.click());
        expect(api.saveProfile).toHaveBeenCalledWith('Tester', 2);
        expect(node.querySelector('[role="alert"]')?.textContent).toBe(
            'Save failed',
        );
        expect(choice?.checked).toBe(false);
        const updated = { ...overview.user, avatar: 2 };
        api.saveProfile.mockResolvedValueOnce(updated);
        await flush(() => choice?.click());
        expect(node.querySelector('[role="alert"]')).toBeNull();
        expect(node.querySelector('[role="status"]')).toBeNull();
        expect(choice?.checked).toBe(true);
        expect(api.getOverview).toHaveBeenCalledOnce();
        expect(api.getContributions).not.toHaveBeenCalled();
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('reauthenticates a failed contribution page in place and resumes the same cursor for the same account', async () => {
    window.history.replaceState(null, '', '/me/content');
    useAuthStore.getState().clearSessionUser();
    auth.open = true;
    const first = { id: 'image-a', kind: 'image', markerId: '42', poiType: 'ore', content: null, status: 'active', visibility: 'public', createdAt: '2026-05-21T03:28:31Z' };
    api.getContributions
        .mockResolvedValueOnce({ items: [first], nextCursor: 'next+cursor' })
        .mockRejectedValueOnce(new Error('Unauthorized'))
        .mockResolvedValueOnce({ items: [{ ...first, id: 'image-b' }], nextCursor: null });
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await flush(() => within(node).getByRole('button', { name: 'userHub.loadMore' }).click());
        expect(window.location.pathname).toBe('/me/content');
        expect(api.getContributions).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).not.toBeNull());
        // Keep the signed-out gate open until the same authenticated uid exists.
        auth.open = false;
        await flush(() => { useAuthStore.getState().setSessionUser(overview.user); root.render(createElement(App)); });
        expect(api.getOverview).toHaveBeenCalledOnce();
        expect(api.getContributions.mock.calls[2][1]).toBe('next+cursor');
        expect(node.querySelectorAll('main ul > li')).toHaveLength(2);
        expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).toBeNull();
        expect(window.location.pathname).toBe('/me/content');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('reloads private overview and contributions when reauthentication changes the account', async () => {
    useAuthStore.getState().clearSessionUser();
    auth.open = true;
    api.getContributions.mockRejectedValueOnce(new Error('Unauthorized'));
    const nextUser = { uid: '84', nickname: 'Another user' };
    api.getOverview.mockResolvedValueOnce(overview).mockResolvedValueOnce({ ...overview, user: nextUser });
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await waitFor(() => expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).not.toBeNull());
        auth.open = false;
        await flush(() => { useAuthStore.getState().setSessionUser(nextUser); root.render(createElement(App)); });
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        expect(api.getContributions.mock.calls[1][1]).toBeUndefined();
        expect(node.textContent).toContain('Another user');
        expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).toBeNull();
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('hides the previous identity and private list immediately when the store switches accounts without a 401', async () => {
    const second: Overview = { ...overview, user: { uid: '84', nickname: 'Second reader' } };
    let release!: (result: Overview) => void;
    const pending = new Promise<Overview>((resolve) => { release = resolve; });
    api.getOverview.mockResolvedValueOnce(overview).mockReturnValueOnce(pending);
    api.getContributions.mockResolvedValueOnce({ items: [{ id: 'private-a', kind: 'image', markerId: '42', poiType: 'ore', content: null, previewUrl: '/private-a.webp', status: 'active', visibility: 'private', createdAt: '2026-05-21T03:28:31Z' }], nextCursor: null });
    useAuthStore.getState().setSessionUser(overview.user);
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(node.textContent).toContain('Tester');
        expect(node.querySelector('img[src="/private-a.webp"]')).not.toBeNull();
        await flush(() => useAuthStore.getState().setSessionUser(second.user));
        expect(node.textContent).not.toContain('Tester');
        expect(node.querySelector('img[src="/private-a.webp"]')).toBeNull();
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        await flush(() => release(second));
        expect(node.textContent).toContain('Second reader');
        expect(api.getContributions).toHaveBeenCalledTimes(2);
    } finally { await flush(() => root.unmount()); node.remove(); }
});

it('rejects an old overview response after a same-batch A-B-A ownership transition', async () => {
    let release!: (result: Overview) => void;
    const pending = new Promise<Overview>((resolve) => { release = resolve; });
    api.getOverview.mockReturnValueOnce(pending).mockResolvedValueOnce({ ...overview, user: { ...overview.user, nickname: 'Fresh A' } });
    useAuthStore.getState().setSessionUser(overview.user);
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await flush(() => {
            useAuthStore.getState().setSessionUser({ uid: '84', nickname: 'B' });
            useAuthStore.getState().setSessionUser(overview.user);
        });
        expect((api.getOverview.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
        await flush(() => release({ ...overview, user: { ...overview.user, nickname: 'Stale A' } }));
        expect(node.textContent).toContain('Fresh A');
        expect(node.textContent).not.toContain('Stale A');
        expect(api.getOverview).toHaveBeenCalledTimes(2);
    } finally { await flush(() => root.unmount()); node.remove(); }
});

it('adopts a cookie-authenticated overview as the session owner when no cached identity exists', async () => {
    window.history.replaceState(null, '', '/me/profile');
    useAuthStore.getState().clearSessionUser();
    api.saveProfile.mockResolvedValue({ ...overview.user, avatar: 2 });
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(useAuthStore.getState().sessionUser?.uid).toBe(overview.user.uid);
        await flush(() => node.querySelector<HTMLInputElement>('input[name="avatar"][value="2"]')?.click());
        expect(api.saveProfile).toHaveBeenCalledExactlyOnceWith('Tester', 2);
        expect(api.getOverview).toHaveBeenCalledOnce();
        expect(api.getContributions).not.toHaveBeenCalled();
    } finally { await flush(() => root.unmount()); node.remove(); }
});

it.each(['resolve', 'reject'] as const)('ignores a pending same-account overview %s after a newer session user is committed', async (completion) => {
    let resolve!: (result: Overview) => void;
    let reject!: (reason: Error) => void;
    const old = new Promise<Overview>((yes, no) => { resolve = yes; reject = no; });
    const fresh: Overview = { ...overview, user: { ...overview.user, nickname: 'Fresh session', avatar: 3 } };
    api.getOverview.mockReturnValueOnce(old).mockResolvedValueOnce(fresh);
    useAuthStore.getState().setSessionUser(overview.user);
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await flush(() => useAuthStore.getState().setSessionUser(fresh.user));
        await flush(() => completion === 'resolve' ? resolve(overview) : reject(new Error('Unauthorized')));
        expect(useAuthStore.getState().sessionUser).toEqual(fresh.user);
        expect(node.textContent).toContain('Fresh session');
        expect(node.textContent).not.toContain('Tester');
        expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).toBeNull();
        expect(api.getOverview).toHaveBeenCalledTimes(2);
        expect(api.clearReadCache).toHaveBeenCalledOnce();
    } finally { await flush(() => root.unmount()); node.remove(); }
});

it.each(['resolve', 'reject'] as const)('ignores a deferred previous-account overview %s after a newer account becomes current', async (completion) => {
    let resolve!: (result: Overview) => void;
    let reject!: (reason: Error) => void;
    const old = new Promise<Overview>((yes, no) => { resolve = yes; reject = no; });
    const second: Overview = { ...overview, user: { uid: '84', nickname: 'Second reader' } };
    api.getOverview.mockReturnValueOnce(old).mockResolvedValueOnce(second);
    useAuthStore.getState().setSessionUser(overview.user);
    const node = document.createElement('div'); document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        await flush(() => useAuthStore.getState().setSessionUser(second.user));
        expect(node.textContent).toContain('Second reader');
        await flush(() => completion === 'resolve' ? resolve(overview) : reject(new Error('Unauthorized')));
        expect(node.textContent).toContain('Second reader');
        expect(node.textContent).not.toContain('Tester');
        expect(useAuthStore.getState().sessionUser?.uid).toBe(second.user.uid);
        expect(within(node).queryByRole('button', { name: 'idcard.auth.login' })).toBeNull();
        expect(api.getOverview).toHaveBeenCalledTimes(2);
    } finally { await flush(() => root.unmount()); node.remove(); }
});
