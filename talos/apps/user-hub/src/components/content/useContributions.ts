import { useCallback, useEffect, useRef, useState } from 'react';
import { getContributions, isUnauthorized } from '../../api/client';
import type { Contribution } from '../../types';

export type Kind = 'image' | 'comment';

type State = {
    items: Contribution[] | null;
    cursor: string | null;
    loading: boolean;
    error: string | null;
};

const initialState: State = {
    items: null,
    cursor: null,
    loading: true,
    error: null,
};

export function useContributions(kind: Kind, revision: number) {
    const [state, setState] = useState(initialState);
    const [retry, setRetry] = useState(0);
    const request = useRef<AbortController | null>(null);
    const pending = useRef(false);

    const load = useCallback(
        async (cursor?: string) => {
            const controller = new AbortController();
            request.current?.abort();
            request.current = controller;
            pending.current = true;
            setState((previous) =>
                cursor
                    ? { ...previous, loading: true, error: null }
                    : initialState,
            );
            try {
                const page = await getContributions(
                    kind,
                    cursor,
                    controller.signal,
                );
                if (controller.signal.aborted) return;
                setState((previous) => ({
                    items: cursor
                        ? [...(previous.items ?? []), ...page.items]
                        : page.items,
                    cursor: page.nextCursor,
                    loading: false,
                    error: null,
                }));
            } catch (cause) {
                if (controller.signal.aborted) return;
                if (isUnauthorized(cause)) {
                    window.location.assign('/');
                    return;
                }
                setState((previous) => ({
                    ...previous,
                    loading: false,
                    error:
                        cause instanceof Error
                            ? cause.message
                            : 'HTTP request failed',
                }));
            } finally {
                if (!controller.signal.aborted) pending.current = false;
            }
        },
        [kind],
    );

    useEffect(() => {
        void load();
        return () => request.current?.abort();
    }, [load, revision, retry]);

    const loadMore = () => {
        if (!pending.current && state.cursor) void load(state.cursor);
    };

    return {
        ...state,
        loadMore,
        retry: () =>
            state.items === null ? setRetry((value) => value + 1) : loadMore(),
    };
}
