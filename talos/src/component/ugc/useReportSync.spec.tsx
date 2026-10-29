import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/services/http/authRuntime', () => ({
    getAuthBase: () => 'https://api.example.test',
    getAuthHeaders: () => ({}),
}));
vi.mock('@/data/marker', () => ({ MARKER_TYPE_DICT: {} }));
vi.mock('@/services/routing/share', () => ({ buildPointShareToken: vi.fn() }));
import {
    toggleUGCCommentFlag,
    toggleUGCImageFlag,
    UGCClientError,
} from '@/services/ugc/client';
import type { ReportTarget } from './useReportSync';
import { useReportSync } from './useReportSync';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
const tick = () =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(300);
    });

it.each(['comment', 'image'] as const)(
    'captures %s click IDs and coalesces only within the same version',
    async (kind) => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
            Promise.resolve(
                Response.json({
                    ok: true,
                    status: 'flagged',
                    flagCount: 1,
                }),
            ),
        );
        vi.stubGlobal('fetch', fetch);
        const apply =
            vi.fn<(target: ReportTarget, patch: { status?: string }) => void>();
        const send =
            kind === 'comment' ? toggleUGCCommentFlag : toggleUGCImageFlag;
        const { result } = renderHook(() =>
            useReportSync({
                scope: 'point:user',
                delay: 300,
                send: (target, desired) =>
                    send(target.id, desired, target.snapshotId),
                apply,
                rollback: vi.fn(),
                conflict: vi.fn().mockResolvedValue(undefined),
            }),
        );
        const clicked = { id: 'target', snapshotId: 'A' };
        act(() => {
            result.current.start(
                clicked,
                { flagged: false, status: 'flagged' },
                true,
            );
            // A new read must not silently change the version of the already queued click.
            clicked.snapshotId = 'B';
            result.current.start(
                { id: 'target', snapshotId: 'B' },
                { flagged: false, status: 'flagged' },
                true,
            );
            result.current.start(
                { id: 'cancelled', snapshotId: 'C' },
                { flagged: false, status: 'flagged' },
                true,
            );
            result.current.start(
                { id: 'cancelled', snapshotId: 'C' },
                { flagged: true, status: 'flagged' },
                false,
            );
            result.current.start(
                { id: 'unsaved', snapshotId: '' },
                { flagged: false, status: 'flagged' },
                true,
            );
        });
        await tick();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(
            fetch.mock.calls.map(([, init]) => {
                if (typeof init?.body !== 'string')
                    throw new Error('Expected a JSON report body');
                return JSON.parse(init.body) as unknown;
            }),
        ).toEqual([{ snapshotId: 'A' }, { snapshotId: 'B' }]);
        expect(apply.mock.calls.map(([target]) => target.snapshotId)).toEqual([
            'A',
            'B',
        ]);
    },
);

it.each([true, false])(
    'cancels a desired=%s 409 task and invokes rollback and recovery without retry, including newer clicks in flight',
    async (desired) => {
        let reject!: (error: Error) => void;
        const send = vi.fn(
            () =>
                new Promise<never>((_, fail) => {
                    reject = fail;
                }),
        );
        const rollback = vi.fn();
        const refresh = vi
            .fn<() => Promise<void>>()
            .mockResolvedValue(undefined);
        const { result } = renderHook(() =>
            useReportSync({
                scope: 'point:user',
                delay: 300,
                send,
                apply: vi.fn(),
                rollback,
                conflict: refresh,
            }),
        );
        act(() =>
            result.current.start(
                { id: 'target', snapshotId: 'A' },
                { flagged: !desired, status: 'flagged' },
                desired,
            ),
        );
        await tick();
        act(() =>
            result.current.start(
                { id: 'target', snapshotId: 'A' },
                { flagged: desired, status: 'flagged' },
                !desired,
            ),
        );
        await act(async () => {
            reject(
                new UGCClientError('Changed', 'PUBLIC_SNAPSHOT_CONFLICT', 409),
            );
            await Promise.resolve();
        });
        await tick();
        expect(rollback).toHaveBeenCalledExactlyOnceWith(
            { id: 'target', snapshotId: 'A' },
            { flagged: !desired, status: 'flagged' },
        );
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledTimes(1);
    },
);

it('drops a previous account or point task and ignores its late response', async () => {
    let resolve!: (value: { status: 'active' }) => void;
    const send = vi.fn(
        () =>
            new Promise<{ status: 'active' }>((done) => {
                resolve = done;
            }),
    );
    const apply = vi.fn();
    const { result, rerender } = renderHook(
        ({ scope }) =>
            useReportSync({
                scope,
                delay: 300,
                send,
                apply,
                rollback: vi.fn(),
                conflict: vi.fn().mockResolvedValue(undefined),
            }),
        { initialProps: { scope: 'point:user-A' } },
    );
    act(() =>
        result.current.start(
            { id: 'target', snapshotId: 'A' },
            { flagged: false, status: 'flagged' },
            true,
        ),
    );
    await tick();
    rerender({ scope: 'point:user-B' });
    await act(async () => {
        resolve({ status: 'active' });
        await Promise.resolve();
    });
    expect(apply).not.toHaveBeenCalled();
});

it.each(['comment', 'image'] as const)(
    'keeps the reader unflagged when withdrawing a %s report while other reports remain',
    async (kind) => {
        const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
            Response.json({
                ok: true,
                status: 'flagged',
                flagCount: 1,
                deleted: true,
            }),
        );
        vi.stubGlobal('fetch', fetch);
        const send =
            kind === 'comment' ? toggleUGCCommentFlag : toggleUGCImageFlag;
        expect(await send('target', false, 'A')).toMatchObject({
            flagged: false,
            status: 'flagged',
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    },
);
