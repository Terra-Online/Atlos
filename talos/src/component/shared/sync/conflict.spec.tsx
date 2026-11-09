import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SyncConflictModal from './conflict';
import styles from './conflict.module.scss';
import { REGION_DICT } from '@/data/map';
import type { IMarkerData } from '@/data/marker';
import { deferred, translate as t } from '../testFixtures';
import { installResizeObserver } from '../../../../test-support/browser';

const api = vi.hoisted(() => ({ markers: vi.fn() }));
vi.mock('@/data/marker', () => ({ loadAllMarkers: api.markers }));
vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/store/uiPrefs', () => ({ usePerformanceMode: () => true }));

beforeEach(() => { installResizeObserver(); api.markers.mockReset().mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps point and archive namespaces separate when counting merge choices, including empty sources', () => {
    const resolve = vi.fn();
    const view = render(<SyncConflictModal open sourceA={{ side: 'local', pointIds: ['p1', 'shared'], archiveIds: ['shared'] }} sourceB={{ side: 'remote', pointIds: ['shared', 'p2'], archiveIds: ['shared', 'p2'] }} onClose={vi.fn()} onResolve={resolve} />);
    const totals = [...view.baseElement.querySelectorAll(`.${styles.totalNum}`)].map((node) => node.textContent);
    expect(totals).toEqual(['3', '4']);
    const merge = screen.getByRole('button', { name: t('sync.conflict.merge').replace('{count}', '5') });
    fireEvent.click(merge);
    expect(resolve).toHaveBeenCalledWith('merge');
    cleanup();
    render(<SyncConflictModal open sourceA={{ side: 'local', pointIds: [] }} sourceB={{ side: 'remote', pointIds: [] }} onClose={vi.fn()} onResolve={resolve} />);
    expect(screen.getByRole('button', { name: t('sync.conflict.merge').replace('{count}', '0') })).toBeTruthy();
});

it('can compare archive-only progress without loading map data and leaves the choice under caller control', () => {
    const resolve = vi.fn();
    render(<SyncConflictModal open sourceA={{ side: 'local', pointIds: [], archiveIds: ['a'] }} sourceB={{ side: 'remote', pointIds: [], archiveIds: ['b'] }} onClose={vi.fn()} onResolve={resolve} archiveLabel="Read archives" totalLabel="Entries" />);
    expect(api.markers).not.toHaveBeenCalled();
    expect(screen.getByText('Read archives')).toBeTruthy();
    expect(screen.getAllByText('Entries')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: t('sync.conflict.keepA').replace('{label}', t('sync.conflict.local')) }));
    expect(resolve).toHaveBeenLastCalledWith('a');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('sync.conflict.keepB').replace('{label}', t('sync.conflict.remote')) }));
    expect(resolve).toHaveBeenLastCalledWith('b');
});

it('loads marker distribution only while open and updates the regional comparison from marker ids', async () => {
    const pending = deferred<IMarkerData[]>();
    api.markers.mockReturnValue(pending.promise);
    const props = { sourceA: { side: 'local' as const, pointIds: ['p1'] }, sourceB: { side: 'remote' as const, pointIds: ['p2', 'p3'] }, onClose: vi.fn(), onResolve: vi.fn() };
    const view = render(<SyncConflictModal open={false} {...props} />);
    expect(api.markers).not.toHaveBeenCalled();
    view.rerender(<SyncConflictModal open {...props} />);
    await act(async () => {});
    expect(api.markers).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').textContent).toBe(t('common.loading'));
    expect(view.baseElement.querySelector(`.${styles.regionTable}`)).toBeNull();
    const subregId = REGION_DICT.Valley_4.subregions[0];
    const point = (id: string): IMarkerData => ({ id, subregId, type: 'ore', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
    await act(async () => { pending.resolve([point('p1'), point('p2'), point('p3')]); await pending.promise; });
    const table = view.baseElement.querySelector(`.${styles.regionTable}`)!;
    expect([...table.querySelectorAll(`.${styles.regionCount}`)].map((node) => node.textContent)).toEqual(['1', '2']);
    expect(screen.queryByRole('status')).toBeNull();
});

it('keeps retrying failed distribution loads while open, then displays only the successful statistics', async () => {
    vi.useFakeTimers();
    api.markers.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValueOnce([]);
    render(<SyncConflictModal open sourceA={{ side: 'local', pointIds: ['p1'] }} sourceB={{ side: 'remote', pointIds: ['p2'] }} onClose={vi.fn()} onResolve={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe(t('common.loading'));
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(api.markers).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(800));
    expect(api.markers).toHaveBeenCalledTimes(3);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector(`.${styles.regionTable}`)).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(api.markers).toHaveBeenCalledTimes(3);
});

it('stops retrying when closed and tries again when reopened', async () => {
    vi.useFakeTimers();
    api.markers.mockRejectedValue(new Error('offline'));
    const props = { sourceA: { side: 'local' as const, pointIds: ['p1'] }, sourceB: { side: 'remote' as const, pointIds: ['p2'] }, onClose: vi.fn(), onResolve: vi.fn() };
    const view = render(<SyncConflictModal open {...props} />);
    await act(async () => {});
    expect(api.markers).toHaveBeenCalledOnce();
    view.rerender(<SyncConflictModal open={false} {...props} />);
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(api.markers).toHaveBeenCalledOnce();
    view.rerender(<SyncConflictModal open {...props} />);
    await act(async () => {});
    expect(api.markers).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(api.markers).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
});
