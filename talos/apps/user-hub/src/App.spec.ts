import { flush } from './testSetup';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import type { Overview } from './types';

const api = vi.hoisted(() => ({
    getOverview: vi.fn(),
    getContributions: vi.fn(),
    saveProfile: vi.fn(),
}));
vi.mock('./api/client', () => ({ ...api, isUnauthorized: () => false }));
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
    loginMethods: [],
    services: { endfield: { bound: false, enabled: false } },
    contributions: {
        imageCount: 2,
        commentCount: 3,
        pendingCount: 0,
        recent: [],
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    api.getOverview.mockResolvedValue(overview);
    api.getContributions.mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => window.history.replaceState(null, '', '/'));

it('opens the account page from a legacy URL and reports refresh failures', async () => {
    window.history.replaceState(null, '', '/me/security');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(node.textContent).toContain('Tester');
        expect(node.textContent).toContain('userHub.loginMethods');
        expect(node.textContent).toContain('userHub.endfieldAccount');
        expect(api.getContributions).not.toHaveBeenCalled();
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

it('opens contributions by default and keeps the three navigation destinations distinct', async () => {
    window.history.replaceState(null, '', '/me/');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        expect(api.getContributions).toHaveBeenCalledOnce();
        expect(node.textContent).toContain('userHub.emptyContributions');
        const links = node.querySelectorAll<HTMLAnchorElement>('nav a');
        expect(links).toHaveLength(3);
        expect(node.querySelectorAll('[role="tab"]')).toHaveLength(2);
        expect(api.getContributions.mock.calls[0][0]).toBe('image');
        const account = node.querySelector<HTMLAnchorElement>(
            'nav a[href="/me/account"]',
        );
        await flush(() => account?.click());
        expect(window.location.pathname).toBe('/me/account');
        expect(account?.getAttribute('aria-current')).toBe('page');
        expect(node.textContent).toContain('userHub.loginMethods');
        expect(node.textContent).not.toContain('userHub.emptyContributions');
        const content =
            node.querySelector<HTMLAnchorElement>('nav a[href="/me/"]');
        await flush(() => content?.click());
        expect(window.location.pathname).toBe('/me/');
        expect(node.textContent).toContain('userHub.emptyContributions');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('saves avatars immediately, rolls back a failed save and refreshes after success', async () => {
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
        api.getOverview.mockResolvedValueOnce({ ...overview, user: updated });
        await flush(() => choice?.click());
        expect(node.querySelector('[role="alert"]')).toBeNull();
        expect(node.querySelector('[role="status"]')).toBeNull();
        expect(choice?.checked).toBe(true);
        expect(api.getOverview).toHaveBeenCalledTimes(2);
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});

it('saves a changed nickname on blur without a separate confirmation', async () => {
    window.history.replaceState(null, '', '/me/profile');
    const node = document.createElement('div');
    document.body.append(node);
    const root = createRoot(node);
    try {
        await flush(() => root.render(createElement(App)));
        const input = node.querySelector<HTMLInputElement>(
            'input[autocomplete="nickname"]',
        );
        if (!input) throw new Error('Nickname input is missing');
        const valueProperty = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value',
        );
        if (!valueProperty?.set) throw new Error('Input value setter is missing');
        const updated = { ...overview.user, nickname: 'NewName', avatar: 1 };
        api.saveProfile.mockResolvedValueOnce(updated);
        api.getOverview.mockResolvedValueOnce({ ...overview, user: updated });
        await flush(() => {
            valueProperty.set?.call(input, 'NewName');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(api.saveProfile).not.toHaveBeenCalled();
        await flush(() =>
            input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
        );
        expect(api.saveProfile).toHaveBeenCalledWith('NewName', 1);
        expect(input.value).toBe('NewName');
    } finally {
        await flush(() => root.unmount());
        node.remove();
    }
});
