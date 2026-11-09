import { afterEach, beforeEach, expect, it } from 'vitest';
import { useProgressSyncStore } from './progressSync';

const progress = { revision: 'revision', markerIndexHash: 'index', pointIds: ['p1'], retainedPointIds: ['legacy'], updatedAt: 1000 };
beforeEach(() => { localStorage.clear(); useProgressSyncStore.setState(useProgressSyncStore.getInitialState(), true); });
afterEach(() => { localStorage.clear(); });

it('persists the account owner with a verified baseline and restores both on rehydration', async () => {
    useProgressSyncStore.getState().setBaseline(progress, 'account-a');
    const stored = localStorage.getItem('talos-progress-sync')!;
    useProgressSyncStore.getState().setBaseline(null);
    expect(useProgressSyncStore.getState().baselineUid).toBeNull();
    localStorage.setItem('talos-progress-sync', stored);
    await useProgressSyncStore.persist.rehydrate();
    expect(useProgressSyncStore.getState().baseline).toMatchObject({ pointIds: ['p1'], retainedPointIds: ['legacy'] });
    expect(useProgressSyncStore.getState().baselineUid).toBe('account-a');
    expect(useProgressSyncStore.getState().lastSyncedAt).toBe(1000);
});

it('does not trust a legacy baseline without an owner, while preserving its last sync time', async () => {
    localStorage.setItem('talos-progress-sync', JSON.stringify({ version: 4, state: { baseline: progress, lastSyncedAt: 1000 } }));
    await useProgressSyncStore.persist.rehydrate();
    expect(useProgressSyncStore.getState().baseline).toBeNull();
    expect(useProgressSyncStore.getState().baselineUid).toBeNull();
    expect(useProgressSyncStore.getState().lastSyncedAt).toBe(1000);
    expect(useProgressSyncStore.getState().status).toBe('idle');
});
