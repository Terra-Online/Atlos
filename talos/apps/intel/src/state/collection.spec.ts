import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useUserRecordStore } from '@main/store/userRecord';
import { useIntelCollection } from './collection';
import { archives } from '../fixtures';

const channels: { name: string; onmessage: (() => void) | null; postMessage: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
    localStorage.clear();
    channels.length = 0;
    useUserRecordStore.setState({ activePoints: ['untouched-point'], activeArchives: ['legacy-archive'], updatedAt: 1 });
    vi.stubGlobal('BroadcastChannel', class {
        onmessage = null;
        postMessage = vi.fn();
        close = vi.fn();
        constructor(readonly name: string) { channels.push(this); }
    });
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });

it('maps physical archives to shared map points and other acquisitions to archive progress', async () => {
    const { result } = renderHook(() => useIntelCollection(archives));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => { result.current.toggle(archives[0]); result.current.toggle(archives[1]); });
    expect([...result.current.collectedIds]).toEqual(['nar_map', 'nar_mission']);
    expect(useUserRecordStore.getState().activePoints).toEqual(['untouched-point', '42']);
    expect(useUserRecordStore.getState().activeArchives).toEqual(['legacy-archive', 'nar_mission']);
    act(() => result.current.toggle(archives[0]));
    expect(useUserRecordStore.getState().activePoints).toEqual(['untouched-point']);
    expect(channels.slice(1).every((channel) => channel.postMessage.mock.calls.length === 1 && channel.close.mock.calls.length === 1)).toBe(true);
});

it('applies a filtered selection atomically and preserves progress outside that scope', async () => {
    const { result } = renderHook(() => useIntelCollection(archives));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    act(() => result.current.setCollected(archives.slice(0, 3), true));
    act(() => result.current.applyCollectedState(archives.slice(0, 2), new Set(['nar_mission'])));
    expect(useUserRecordStore.getState().activePoints).toEqual(['untouched-point']);
    expect(useUserRecordStore.getState().activeArchives).toEqual(['legacy-archive', 'nar_mission', 'nar_auto']);
    const version = useUserRecordStore.getState().updatedAt;
    const published = channels.length;
    act(() => result.current.applyCollectedState(archives.slice(0, 2), new Set(['nar_mission'])));
    expect(useUserRecordStore.getState().updatedAt).toBe(version);
    expect(channels.length).toBe(published);
    act(() => result.current.setCollected(archives.slice(0, 2), false));
    expect(useUserRecordStore.getState().activeArchives).toEqual(['legacy-archive', 'nar_auto']);
});

it('rehydrates other tabs, ignores unrelated or malformed storage, and releases listeners/channels', async () => {
    const { result, unmount } = renderHook(() => useIntelCollection(archives));
    await waitFor(() => expect(result.current.isReady).toBe(true));
    localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: [42], activeArchives: ['nar_auto'], updatedAt: 10 } }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'other' })); });
    expect(result.current.collectedIds.size).toBe(0);
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'points-storage' })); });
    expect([...result.current.collectedIds]).toEqual(['nar_map', 'nar_auto']);
    expect(useUserRecordStore.getState().updatedAt).toBe(10);
    localStorage.setItem('points-storage', 'invalid JSON');
    act(() => channels[0].onmessage?.());
    expect([...result.current.collectedIds]).toEqual(['nar_map', 'nar_auto']);
    unmount();
    expect(channels[0].close).toHaveBeenCalledOnce();
    localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: [], activeArchives: [] } }));
    act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'points-storage' })); });
    expect(useUserRecordStore.getState().activePoints).toEqual(['42']);
});
