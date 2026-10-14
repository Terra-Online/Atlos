import { flush } from '../../testSetup';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContributions, type Kind } from './useContributions';
import type { Contribution } from '../../types';

const { getContributions } = vi.hoisted(() => ({ getContributions: vi.fn() }));
vi.mock('../../api/client', () => ({
    getContributions,
    isUnauthorized: () => false,
}));

const item = (
    id: string,
    kind: 'image' | 'comment' = 'image',
): Contribution => ({
    id,
    kind,
    markerId: 'marker',
    poiType: 'poi',
    content: null,
    status: 'active',
    visibility: 'public',
    createdAt: '2026-08-20 10:00:00',
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (cause: Error) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}

describe('contribution loading', () => {
    let root: Root;
    let node: HTMLDivElement;
    let state: ReturnType<typeof useContributions>;

    function Probe({
        kind = 'image',
        revision = 0,
    }: {
        kind?: Kind;
        revision?: number;
    }) {
        state = useContributions(kind, revision);
        return null;
    }

    beforeEach(() => {
        getContributions.mockReset();
        node = document.createElement('div');
        document.body.append(node);
        root = createRoot(node);
    });

    afterEach(async () => {
        await flush(() => root.unmount());
        node.remove();
    });

    it('ignores a previous filter response even if the server completes after cancellation', async () => {
        const old = deferred<{
            items: Contribution[];
            nextCursor: string | null;
        }>();
        getContributions
            .mockReturnValueOnce(old.promise)
            .mockResolvedValueOnce({
                items: [item('new', 'comment')],
                nextCursor: null,
            });
        await flush(() => root.render(createElement(Probe)));
        const oldSignal = getContributions.mock.calls[0][2] as AbortSignal;
        await flush(() =>
            root.render(createElement(Probe, { kind: 'comment' })),
        );
        expect(oldSignal.aborted).toBe(true);
        await flush(() =>
            old.resolve({ items: [item('old')], nextCursor: 'old-cursor' }),
        );
        expect(state.items?.map((value) => value.id)).toEqual(['new']);
        expect(state.cursor).toBeNull();
    });

    it('keeps existing records and retries the same cursor after a pagination failure', async () => {
        getContributions
            .mockResolvedValueOnce({
                items: [item('first')],
                nextCursor: 'cursor +/',
            })
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({
                items: [item('second')],
                nextCursor: null,
            });
        await flush(() => root.render(createElement(Probe)));
        await flush(() => state.loadMore());
        expect(state.items?.map((value) => value.id)).toEqual(['first']);
        expect(state.error).toBe('offline');
        await flush(() => state.retry());
        expect(getContributions.mock.calls[2][1]).toBe('cursor +/');
        expect(state.items?.map((value) => value.id)).toEqual([
            'first',
            'second',
        ]);
        expect(state.error).toBeNull();
        expect(state.cursor).toBeNull();
    });

    it('preserves the unloaded state on failure and allows a first-page retry', async () => {
        getContributions
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValueOnce({ items: [], nextCursor: null });
        await flush(() => root.render(createElement(Probe)));
        expect(state.items).toBeNull();
        expect(state.loading).toBe(false);
        await flush(() => state.retry());
        expect(state.items).toEqual([]);
        expect(state.error).toBeNull();
    });

    it('prevents duplicate page requests and resets to page one on refresh', async () => {
        const next = deferred<{
            items: Contribution[];
            nextCursor: string | null;
        }>();
        getContributions
            .mockResolvedValueOnce({
                items: [item('first')],
                nextCursor: 'cursor',
            })
            .mockReturnValueOnce(next.promise)
            .mockResolvedValueOnce({
                items: [item('refreshed')],
                nextCursor: null,
            });
        await flush(() => root.render(createElement(Probe)));
        await flush(() => {
            state.loadMore();
            state.loadMore();
        });
        expect(getContributions).toHaveBeenCalledTimes(2);
        await flush(() => root.render(createElement(Probe, { revision: 1 })));
        await flush(() =>
            next.resolve({ items: [item('stale-page')], nextCursor: null }),
        );
        expect(getContributions.mock.calls[2][1]).toBeUndefined();
        expect(state.items?.map((value) => value.id)).toEqual(['refreshed']);
    });
});
