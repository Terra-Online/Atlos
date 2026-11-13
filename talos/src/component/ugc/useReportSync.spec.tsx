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
} from '@/services/ugc/client';
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
    'coalesces %s reports by submission and sends no snapshot body',
    async (kind) => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockResolvedValue(
                Response.json({ ok: true, status: 'flagged', flagCount: 1 }),
            );
        vi.stubGlobal('fetch', fetch);
        const apply = vi.fn();
        const send =
            kind === 'comment' ? toggleUGCCommentFlag : toggleUGCImageFlag;
        const { result } = renderHook(() =>
            useReportSync({
                scope: 'point:user',
                delay: 300,
                send: (target, desired) => send(target.id, desired),
                apply,
                rollback: vi.fn(),
            }),
        );
        act(() => {
            result.current.start(
                { id: 'target' },
                { flagged: false, status: 'active' },
                true,
            );
            result.current.start(
                { id: 'target' },
                { flagged: true, status: 'flagged' },
                true,
            );
            result.current.start({ id: 'cancelled' }, { flagged: false }, true);
            result.current.start({ id: 'cancelled' }, { flagged: true }, false);
        });
        await tick();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][1]?.body).toBeUndefined();
        expect(apply).toHaveBeenCalledExactlyOnceWith(
            { id: 'target' },
            expect.objectContaining({ flagged: true }),
        );
    },
);

it('rolls back failed reporting without retrying', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'));
    const rollback = vi.fn();
    const { result } = renderHook(() =>
        useReportSync({
            scope: 'point:user',
            delay: 300,
            send,
            apply: vi.fn(),
            rollback,
        }),
    );
    act(() =>
        result.current.start(
            { id: 'target' },
            { flagged: false, status: 'active' },
            true,
        ),
    );
    await tick();
    expect(rollback).toHaveBeenCalledExactlyOnceWith(
        { id: 'target' },
        { flagged: false, status: 'active' },
    );
    expect(send).toHaveBeenCalledTimes(1);
});

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
            }),
        { initialProps: { scope: 'point:user-A' } },
    );
    act(() =>
        result.current.start(
            { id: 'target' },
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
        expect(await send('target', false)).toMatchObject({
            flagged: false,
            status: 'flagged',
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    },
);
