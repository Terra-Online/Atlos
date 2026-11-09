import { useCallback, useEffect, useRef, useState } from 'react';
import { getContributions, isUnauthorized } from '../../api/client';
import type { Contribution } from '../../types';

export type Kind = 'image' | 'comment';

type State = {
    items: Contribution[] | null;
    cursor: string | null;
    loading: boolean;
    error: string | null;
    unauthorized: boolean;
};

const initialState: State = {
    items: null,
    cursor: null,
    loading: true,
    error: null,
    unauthorized: false,
};

export function useContributions(kind: Kind, revision: number, onUnauthorized?: () => void, authRevision = 0) {
    const [state, setState] = useState(initialState);
    const [retry, setRetry] = useState(0);
    const request = useRef<AbortController | null>(null);
    const pending = useRef(false);
    const authHandler = useRef(onUnauthorized);
    authHandler.current = onUnauthorized;
    const interrupted = useRef<{ cursor?: string; kind: Kind; revision: number } | null>(null);

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
                    unauthorized: false,
                }));
            } catch (cause) {
                if (controller.signal.aborted) return;
                if (isUnauthorized(cause)) {
                    interrupted.current = { cursor, kind, revision };
                    setState((previous) => ({ ...previous, loading: false, unauthorized: true }));
                    authHandler.current?.();
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
        [kind, revision],
    );

    useEffect(() => {
        interrupted.current = null;
        void load();
        return () => request.current?.abort();
    }, [load, revision, retry]);

    const previousAuthRevision = useRef(authRevision);
    useEffect(() => {
        if (previousAuthRevision.current === authRevision) return;
        previousAuthRevision.current = authRevision;
        const saved = interrupted.current;
        interrupted.current = null;
        if (saved?.kind === kind && saved.revision === revision) void load(saved.cursor);
    }, [authRevision, kind, load, revision]);

    const loadMore = () => {
        if (!pending.current && !state.unauthorized && state.cursor) void load(state.cursor);
    };

    return {
        ...state,
        loadMore,
        retry: () =>
            state.items === null ? setRetry((value) => value + 1) : loadMore(),
    };
}
