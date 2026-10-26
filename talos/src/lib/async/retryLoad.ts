interface Options {
    signal?: AbortSignal;
    delay?: number;
    onRetry?: (error: unknown) => void;
}

/** Retries loading only; callers commit successful data once after it resolves. */
export function retryLoad<T>(load: () => Promise<T>, { signal, delay = 800, onRetry }: Options = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const cleanup = () => {
            globalThis.clearTimeout(timer);
            signal?.removeEventListener('abort', cancel);
        };
        const cancel = () => {
            cleanup();
            reject(signal?.reason instanceof Error ? signal.reason : new DOMException('Loading cancelled', 'AbortError'));
        };
        const attempt = () => {
            void Promise.resolve().then(() => {
                signal?.throwIfAborted();
                return load();
            }).then((value) => {
                cleanup();
                if (signal?.aborted) cancel();
                else resolve(value);
            }, (error: unknown) => {
                if (signal?.aborted) { cancel(); return; }
                try { onRetry?.(error); }
                catch (cause) { cleanup(); reject(cause instanceof Error ? cause : new Error(String(cause))); return; }
                if (signal?.aborted) { cancel(); return; }
                timer = globalThis.setTimeout(attempt, delay);
            });
        };
        if (signal?.aborted) { cancel(); return; }
        signal?.addEventListener('abort', cancel, { once: true });
        attempt();
    });
}
