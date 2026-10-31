import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAuthStore } from '@main/store/auth';
import Profile from './profile/profile';
import Nav from './nav/nav';
import AuthLoader from './authLoader';
import { flush } from '../testSetup';

const api = vi.hoisted(() => ({ save: vi.fn(), gate: vi.fn(), cached: null }));
vi.mock('../api/client', () => ({ saveProfile: api.save }));
vi.mock('./authEntry', () => ({ getAuthGate: () => api.cached, loadAuthGate: api.gate }));
vi.mock('@hub/locale', () => ({ useTranslateUI: () => (key: string) => key === 'userHub.avatarChoice' ? 'Avatar {index}' : key }));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
beforeEach(() => {
    api.save.mockReset(); api.gate.mockReset();
    useAuthStore.getState().setSessionUser({ uid: 'u1', nickname: 'Reader' });
    window.history.replaceState(null, '', '/me/content');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState(null, '', '/'); });

it('saves one avatar request at a time, disables the group, and rolls back failures before a successful retry', async () => {
    const pending = deferred<{ uid: string; nickname: string; avatar: number }>();
    api.save.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ uid: 'u1', nickname: 'Reader', avatar: 2 });
    const saved = vi.fn();
    render(<Profile user={{ uid: 'u1', nickname: 'Reader', avatar: 1 }} onSaved={saved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 2' }));
    const group = screen.getByRole<HTMLFieldSetElement>('group');
    expect(group.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 3' }));
    expect(api.save).toHaveBeenCalledOnce();
    await flush(() => pending.reject(new Error('offline')));
    expect(screen.getByRole('alert').textContent).toBe('offline');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Avatar 1' }).checked).toBe(true);
    expect(group.disabled).toBe(false);
    await flush(() => { fireEvent.click(screen.getByRole('radio', { name: 'Avatar 2' })); });
    expect(saved).toHaveBeenCalledWith({ uid: 'u1', nickname: 'Reader', avatar: 2 });
    expect(useAuthStore.getState().sessionUser?.avatar).toBe(2);
    expect(screen.queryByRole('alert')).toBeNull();
});

it('does not let a completed avatar save from a previous account replace the current session', async () => {
    const pending = deferred<{ uid: string; nickname: string; avatar: number }>();
    api.save.mockReturnValue(pending.promise);
    const saved = vi.fn();
    const view = render(<Profile user={{ uid: 'u1', nickname: 'First', avatar: 1 }} onSaved={saved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 2' }));
    const nextUser = { uid: 'u2', nickname: 'Second', avatar: 3 };
    await flush(() => { useAuthStore.getState().setSessionUser(nextUser); view.rerender(<Profile user={nextUser} onSaved={saved} />); });
    await flush(() => pending.resolve({ uid: 'u1', nickname: 'First', avatar: 2 }));
    expect(useAuthStore.getState().sessionUser?.uid).toBe('u2');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Avatar 3' }).checked).toBe(true);
    expect(saved).not.toHaveBeenCalled();
});

it('refuses to send a profile mutation when props belong to a different current session, even before its next paint', async () => {
    api.save.mockResolvedValue({ uid: 'u2', nickname: 'Old A', avatar: 2 });
    render(<Profile user={{ uid: 'u1', nickname: 'Old A', avatar: 1 }} onSaved={() => {}} />);
    const radio = screen.getByRole('radio', { name: 'Avatar 2' });
    await flush(() => {
        useAuthStore.getState().setSessionUser({ uid: 'u2', nickname: 'Current B' });
        expect(screen.getByRole<HTMLFieldSetElement>('group').disabled).toBe(false);
        fireEvent.click(radio);
    });
    expect(api.save).not.toHaveBeenCalled();
    expect(useAuthStore.getState().sessionUser?.nickname).toBe('Current B');
});

it('rejects an earlier avatar response across a batched A-B-A session transition', async () => {
    const pending = deferred<{ uid: string; nickname: string; avatar: number }>();
    api.save.mockReturnValue(pending.promise);
    const saved = vi.fn();
    render(<Profile user={{ uid: 'u1', nickname: 'Reader', avatar: 1 }} onSaved={saved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 2' }));
    await flush(() => {
        useAuthStore.getState().setSessionUser({ uid: 'u2', nickname: 'Second' });
        useAuthStore.getState().setSessionUser({ uid: 'u1', nickname: 'Fresh first', avatar: 3 });
    });
    await flush(() => pending.resolve({ uid: 'u1', nickname: 'Reader', avatar: 2 }));
    expect(saved).not.toHaveBeenCalled();
    expect(useAuthStore.getState().sessionUser?.nickname).toBe('Fresh first');
    expect(useAuthStore.getState().sessionUser?.avatar).toBe(3);
});

it.each(['logout', 'unmount'])('ignores an avatar response after %s', async (mode) => {
    const pending = deferred<{ uid: string; nickname: string; avatar: number }>();
    api.save.mockReturnValue(pending.promise);
    useAuthStore.getState().setSessionUser({ uid: 'u1', nickname: 'Reader' });
    const saved = vi.fn();
    const view = render(<Profile user={{ uid: 'u1', nickname: 'Reader', avatar: 1 }} onSaved={saved} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Avatar 2' }));
    if (mode === 'logout') await flush(() => useAuthStore.getState().clearSessionUser());
    else view.unmount();
    await flush(() => pending.resolve({ uid: 'u1', nickname: 'Reader', avatar: 2 }));
    expect(saved).not.toHaveBeenCalled();
    expect(useAuthStore.getState().sessionUser?.avatar).not.toBe(2);
});

it('handles ordinary navigation locally while preserving modified-click browser navigation', () => {
    render(<Nav active="contributions" />);
    const link = screen.getByRole('link', { name: /userHub.tabs.profile/ });
    const prevented: boolean[] = [];
    const stopNativeNavigation = (event: MouseEvent) => { prevented.push(event.defaultPrevented); event.preventDefault(); };
    document.addEventListener('click', stopNativeNavigation);
    try {
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, [key]: true });
        fireEvent(link, event);
        expect(prevented.at(-1)).toBe(false);
        expect(window.location.pathname).toBe('/me/content');
    }
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, event);
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.pathname).toBe('/me/profile');
    expect(screen.getByRole('link', { name: /userHub.tabs.contributions/ }).getAttribute('aria-current')).toBe('page');
    } finally { document.removeEventListener('click', stopNativeNavigation); }
});

it('renders auth only after its conditional module arrives and ignores completion after unmount', async () => {
    const gate = deferred<() => React.ReactNode>();
    api.gate.mockReturnValueOnce(gate.promise);
    const view = render(<AuthLoader attemptedSession={{ current: null }} onAuthenticated={() => {}} />);
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    await flush(() => gate.resolve(() => <button>Authentication ready</button>));
    expect(screen.getByRole('button', { name: 'Authentication ready' })).toBeTruthy();
    view.unmount();
    const stale = deferred<() => React.ReactNode>();
    api.gate.mockReturnValueOnce(stale.promise);
    const abandoned = render(<AuthLoader attemptedSession={{ current: null }} onAuthenticated={() => {}} />);
    abandoned.unmount();
    await flush(() => stale.resolve(() => <button>Stale gate</button>));
    expect(screen.queryByText('Stale gate')).toBeNull();
});

it('keeps retrying failed auth chunks with spacing until successful without losing the page', async () => {
    vi.useFakeTimers();
    api.gate.mockRejectedValueOnce(new Error('chunk unavailable')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValue(() => <button>Authentication ready</button>);
    await flush(() => { render(<AuthLoader attemptedSession={{ current: null }} onAuthenticated={() => {}} />); });
    expect(screen.getByRole('status').textContent).toBe('common.loading');
    await act(() => vi.advanceTimersByTimeAsync(799));
    expect(api.gate).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(801));
    expect(api.gate).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Authentication ready' })).toBeTruthy();
});

it('retains a visible recovery for an auth component render failure instead of retrying its rendering indefinitely', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.gate.mockResolvedValueOnce(() => { throw new Error('render failed'); });
    await flush(() => { render(<AuthLoader attemptedSession={{ current: null }} onAuthenticated={() => {}} />); });
    expect(screen.getByRole('alert').textContent).toContain('userHub.loadError');
    expect(screen.getByRole('button', { name: 'userHub.retry' })).toBeTruthy();
});
