import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * `React.lazy` that retries a failed dynamic import once.
 * A deploy that replaces hashed chunks or a flaky network otherwise leaves the
 * lazy subtree permanently rejected until the page is reloaded.
 */
// Props are intentionally `any`: the wrapper must accept any lazy component and
// preserve its exact type through T, as React.lazy itself does.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lazyWithRetry = <T extends ComponentType<any>>(
    load: () => Promise<{ default: T }>,
    delay = 800,
): LazyExoticComponent<T> =>
    lazy(() =>
        load().catch(
            (error: unknown) =>
                new Promise<{ default: T }>((resolve, reject) => {
                    globalThis.setTimeout(() => {
                        load().then(resolve, () =>
                            reject(error instanceof Error ? error : new Error(String(error))),
                        );
                    }, delay);
                }),
        ),
    );
