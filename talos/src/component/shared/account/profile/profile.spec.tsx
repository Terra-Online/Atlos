import { Profiler, useState, type ComponentProps } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ProfileModal from './profile';
import { cardProfile, deferred, translate as t } from '../../testFixtures';
import { useProgressSyncStore } from '@/store/progressSync';
import { useUserRecordStore } from '@/store/userRecord';
import { ENDFIELD_BINDING_REQUEST_EVENT, type EndfieldBindingRequestDetail } from '@/store/locator';
import { setProgressSyncRequestHandler } from '@/component/shared/sync/progressSyncController';
import type { OfficialMarksSnapshot } from '@/services/endfield';
import { installResizeObserver } from '../../../../../test-support/browser';

const api = vi.hoisted(() => ({ status: vi.fn(), snapshot: vi.fn(), apply: vi.fn(), markers: vi.fn(), mobile: false }));
vi.mock('@/locale', async () => (await import('../../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../../testFixtures')).pipFixture);
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: api.mobile }) }));
vi.mock('@/component/shared/sync/ProgressSyncHost', () => ({ default: () => null }));
vi.mock('@/services/endfield', async (original) => ({ ...await original<typeof import('@/services/endfield')>(), getEFBindingStatus: api.status, loadOfficialMarksSnapshot: api.snapshot, applyOfficialMarks: api.apply }));
vi.mock('@/data/marker', async (original) => ({ ...await original<typeof import('@/data/marker')>(), loadAllMarkers: api.markers }));

const snapshot: OfficialMarksSnapshot = { localPointIds: ['local', 'both'], officialPointIds: ['official', 'both'], localUpdatedAt: 1000, officialUpdatedAt: null, unresolved: 2 };
beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    installResizeObserver();
    useProgressSyncStore.setState(useProgressSyncStore.getInitialState(), true);
    useUserRecordStore.setState(useUserRecordStore.getInitialState(), true);
    api.mobile = false;
    api.status.mockResolvedValue({ binding: { bound: true, enabled: true } });
    api.snapshot.mockResolvedValue(snapshot);
    api.markers.mockResolvedValue([]);
});
afterEach(() => { cleanup(); setProgressSyncRequestHandler(null); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

function mount(overrides: Partial<ComponentProps<typeof ProfileModal>> = {}) {
    const save = vi.fn().mockResolvedValue(undefined);
    const logout = vi.fn().mockResolvedValue(undefined);
    const closed = vi.fn();
    function Profile() {
        const [open, setOpen] = useState(true);
        const [name, setName] = useState('Explorer');
        return <ProfileModal profileOpen={open} setProfileOpen={setOpen} profileName={name} setProfileName={setName} profileError={null} isSavingProfile={false} cardProfile={cardProfile} profileAvatar={3} handleCloseProfile={() => { closed(); setOpen(false); return Promise.resolve(); }} handleSaveProfile={save} handleLogout={logout} {...overrides} />;
    }
    return { ...render(<Profile />), save, logout, closed };
}

it('edits the embedded card, preserves its name constraint, and delegates save/logout without changing the card identity', () => {
    const { save, logout } = mount();
    const name = screen.getByRole<HTMLInputElement>('textbox');
    expect(name.value).toBe('Explorer');
    expect(name.maxLength).toBe(15);
    expect(screen.getByText('UID: 42')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'New name' } });
    expect(name.value).toBe('New name');
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.save') }));
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.logout') }));
    expect(save).toHaveBeenCalledOnce();
    expect(logout).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog').dataset.size).toBe('m');
});

it('updates sync labels from actual progress and local stores and keeps new local points actionable', async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    setProgressSyncRequestHandler(sync);
    mount();
    fireEvent.click(screen.getByRole('button', { name: t('sync.now') }));
    expect(sync).toHaveBeenCalledOnce();
    act(() => {
        useUserRecordStore.setState({ activePoints: ['p1', 'legacy'] });
        useProgressSyncStore.setState({ status: 'synced', baseline: { revision: 'rev', markerIndexHash: 'hash', pointIds: ['p1'], retainedPointIds: ['legacy'] } });
    });
    const synced = screen.getByRole<HTMLButtonElement>('button', { name: t('sync.already') });
    expect(synced.disabled).toBe(true);
    fireEvent.click(synced);
    expect(sync).toHaveBeenCalledOnce();
    act(() => useUserRecordStore.setState({ activePoints: ['p1', 'legacy', 'new'] }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('sync.now') }).disabled).toBe(false);
    act(() => useProgressSyncStore.setState({ status: 'offline', error: 'network failure' }));
    expect(screen.getByText(t('sync.failed').replace('{reason}', t('sync.offline')))).toBeTruthy();
    await act(async () => {});
});

it('disables all destructive actions while saving and switches to a full mobile dialog', () => {
    api.mobile = true;
    const { save, logout } = mount({ isSavingProfile: true });
    expect(screen.getByRole('dialog').dataset.size).toBe('full');
    for (const label of [t('idcard.profile.saving'), t('idcard.profile.logout'), t('sync.now'), t('idcard.profile.importOfficial')]) {
        const button = screen.getByRole<HTMLButtonElement>('button', { name: label });
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
    }
    expect(save).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
    expect(api.status).not.toHaveBeenCalled();
});

it.each([
    ['a', ['local', 'both']], ['b', ['official', 'both']], ['merge', ['local', 'both', 'official']],
] as const)('waits for profile exit before showing the real conflict dialog and applies choice %s', async (choice, ids) => {
    const { closed } = mount();
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.importOfficial') }));
    await act(async () => {});
    expect(closed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: t('sync.conflict.title') })).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
    await tick(325);
    const dialog = screen.getByRole('dialog', { name: t('sync.conflict.title') });
    const label = choice === 'merge' ? t('sync.conflict.merge').replace('{count}', '3') : t(choice === 'a' ? 'sync.conflict.keepA' : 'sync.conflict.keepB').replace('{label}', t(choice === 'a' ? 'sync.conflict.local' : 'sync.conflict.remote'));
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
    expect(api.apply).toHaveBeenCalledOnce();
    expect(api.apply).toHaveBeenCalledWith([...ids], 2);
    await tick(325);
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('imports equal snapshots directly and prevents duplicate requests while an import is pending', async () => {
    const pending = deferred<{ binding: { bound: boolean; enabled: boolean } }>();
    api.status.mockReturnValue(pending.promise);
    api.snapshot.mockResolvedValue({ ...snapshot, officialPointIds: snapshot.localPointIds });
    const { closed } = mount();
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.importOfficial') }));
    fireEvent.click(screen.getByRole('button', { name: t('common.loading') }));
    expect(api.status).toHaveBeenCalledOnce();
    await act(async () => { pending.resolve({ binding: { bound: true, enabled: true } }); await pending.promise; });
    expect(api.apply).toHaveBeenCalledWith(snapshot.localPointIds, 2);
    expect(closed).not.toHaveBeenCalled();
});

it('requests binding with a resumable import and leaves progress untouched until the account is bound', async () => {
    api.status.mockResolvedValueOnce({ binding: { bound: false, enabled: false } });
    const requests: EndfieldBindingRequestDetail[] = [];
    const listener = (event: Event) => requests.push((event as CustomEvent<EndfieldBindingRequestDetail>).detail);
    window.addEventListener(ENDFIELD_BINDING_REQUEST_EVENT, listener);
    try {
        const { closed } = mount();
        fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.importOfficial') }));
        await act(async () => {});
        expect(closed).toHaveBeenCalledOnce();
        expect(requests).toHaveLength(1);
        expect(requests[0].enableLocator).toBe(false);
        expect(api.snapshot).not.toHaveBeenCalled();
        api.snapshot.mockResolvedValue({ ...snapshot, officialPointIds: snapshot.localPointIds });
        await act(async () => requests[0].onBound?.());
        expect(api.apply).toHaveBeenCalledWith(snapshot.localPointIds, 2);
    } finally {
        window.removeEventListener(ENDFIELD_BINDING_REQUEST_EVENT, listener);
    }
});

it('keeps local progress unchanged and makes import retryable after a backend failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failure = new Error('official map unavailable');
    api.snapshot.mockRejectedValueOnce(failure);
    mount();
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.importOfficial') }));
    await act(async () => {});
    expect(warn).toHaveBeenCalledWith('[sync][official] import failed', failure);
    expect(api.apply).not.toHaveBeenCalled();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: t('idcard.profile.importOfficial') }).disabled).toBe(false);
    const errorText = t('sync.failed').replace('{reason}', failure.message);
    expect(screen.getByText(errorText).closest('[aria-live]')?.getAttribute('aria-live')).toBe('polite');
    api.snapshot.mockResolvedValue({ ...snapshot, officialPointIds: snapshot.localPointIds });
    fireEvent.click(screen.getByRole('button', { name: t('idcard.profile.importOfficial') }));
    await act(async () => {});
    expect(api.apply).toHaveBeenCalledWith(snapshot.localPointIds, snapshot.unresolved);
    expect(screen.queryByText(errorText)).toBeNull();
    // Unresolved map/type matches are intentional data gaps, not transport
    // failures: they stay silent while valid official marks still apply.
    expect(warn).toHaveBeenCalledOnce();
});

it('does not subscribe the profile to action-only store changes', () => {
    const commits = vi.fn();
    const props = { profileOpen: true, setProfileOpen: vi.fn(), profileName: 'Explorer', setProfileName: vi.fn(), profileError: null, isSavingProfile: false, cardProfile, profileAvatar: 1, handleCloseProfile: vi.fn().mockResolvedValue(undefined), handleSaveProfile: vi.fn().mockResolvedValue(undefined), handleLogout: vi.fn().mockResolvedValue(undefined) };
    // A real store selector is important here: a plain hook stub cannot detect
    // accidentally restoring the full-store subscription from before phase 2.
    render(<Profiler id="profile" onRender={commits}><ProfileModal {...props} /></Profiler>);
    commits.mockClear();
    act(() => useProgressSyncStore.setState({ setStatus: vi.fn() }));
    expect(commits).not.toHaveBeenCalled();
});
