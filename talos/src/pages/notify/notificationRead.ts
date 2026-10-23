export const NOTIFICATION_READ_RATIO = 0.5;
export const NOTIFICATION_READ_DWELL_MS = 1_000;

type ViewportSide = 'above' | 'below';

interface ViewportTraversal {
    entrySide: ViewportSide | null;
    entered: boolean;
}

interface NotificationVisibilityObserverOptions {
    root: Element;
    onRead: (id: string) => void;
    threshold?: number;
    dwellMs?: number;
}

export interface NotificationVisibilityObserver {
    observe: (element: Element, id: string) => void;
    disconnect: () => void;
}

export const createNotificationVisibilityObserver = ({
    root,
    onRead,
    threshold = NOTIFICATION_READ_RATIO,
    dwellMs = NOTIFICATION_READ_DWELL_MS,
}: NotificationVisibilityObserverOptions): NotificationVisibilityObserver => {
    const ids = new WeakMap<Element, string>();
    const targets = new Set<Element>();
    const timers = new Map<Element, number>();
    const consumedIds = new Set<string>();
    const traversals = new WeakMap<Element, ViewportTraversal>();
    let traversalFrame: number | undefined;

    const cancelTimer = (element: Element) => {
        const timer = timers.get(element);
        if (timer === undefined) return;
        window.clearTimeout(timer);
        timers.delete(element);
    };

    const consume = (element: Element, id: string) => {
        if (consumedIds.has(id)) return;
        consumedIds.add(id);
        cancelTimer(element);
        observer.unobserve(element);
        onRead(id);
    };

    const outsideSide = (element: Element): ViewportSide | null => {
        const rootBounds = root.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        if (bounds.bottom <= rootBounds.top) return 'above';
        if (bounds.top >= rootBounds.bottom) return 'below';
        return null;
    };

    const updateTraversals = () => {
        traversalFrame = undefined;
        if (document.visibilityState !== 'visible') return;
        for (const target of targets) {
            const id = ids.get(target);
            if (!id || consumedIds.has(id)) continue;
            const traversal = traversals.get(target) ?? {
                entrySide: null,
                entered: false,
            };
            const side = outsideSide(target);
            if (!side) {
                if (traversal.entrySide) traversal.entered = true;
            } else if (
                traversal.entered &&
                traversal.entrySide &&
                traversal.entrySide !== side
            ) {
                consume(target, id);
                continue;
            } else {
                traversal.entrySide = side;
                traversal.entered = false;
            }
            traversals.set(target, traversal);
        }
    };

    const handleScroll = () => {
        if (traversalFrame !== undefined) return;
        traversalFrame = window.requestAnimationFrame(updateTraversals);
    };

    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                const id = ids.get(entry.target);
                if (!id || consumedIds.has(id)) {
                    cancelTimer(entry.target);
                    continue;
                }

                const isVisible =
                    document.visibilityState === 'visible' &&
                    entry.isIntersecting &&
                    entry.intersectionRatio >= threshold;

                if (!isVisible) {
                    cancelTimer(entry.target);
                    continue;
                }
                if (timers.has(entry.target)) continue;

                const timer = window.setTimeout(() => {
                    timers.delete(entry.target);
                    if (
                        document.visibilityState !== 'visible' ||
                        consumedIds.has(id)
                    )
                        return;
                    consume(entry.target, id);
                }, dwellMs);
                timers.set(entry.target, timer);
            }
        },
        { root, threshold },
    );

    const handleVisibilityChange = () => {
        for (const target of targets) cancelTimer(target);
        if (document.visibilityState !== 'visible') return;

        // Re-observing requests a fresh intersection entry after returning to
        // the foreground, so hidden time never contributes to the dwell time.
        for (const target of targets) {
            traversals.set(target, {
                entrySide: outsideSide(target),
                entered: false,
            });
            observer.unobserve(target);
            observer.observe(target);
        }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    root.addEventListener('scroll', handleScroll, { passive: true });

    return {
        observe: (element, id) => {
            ids.set(element, id);
            traversals.set(element, {
                entrySide: outsideSide(element),
                entered: false,
            });
            targets.add(element);
            observer.observe(element);
        },
        disconnect: () => {
            document.removeEventListener(
                'visibilitychange',
                handleVisibilityChange,
            );
            root.removeEventListener('scroll', handleScroll);
            if (traversalFrame !== undefined) {
                window.cancelAnimationFrame(traversalFrame);
                traversalFrame = undefined;
            }
            for (const target of targets) cancelTimer(target);
            targets.clear();
            observer.disconnect();
        },
    };
};

interface NotificationReadBatcherOptions<TCategory extends string, TResult> {
    send: (category: TCategory, ids: string[]) => Promise<TResult>;
    onResult: (result: TResult) => void;
    batchDelayMs?: number;
    maxBatchSize?: number;
}

export interface NotificationReadBatcher<TCategory extends string> {
    enqueue: (category: TCategory, id: string) => void;
    flush: () => Promise<void>;
    dispose: () => void;
}

export const createNotificationReadBatcher = <
    TCategory extends string,
    TResult,
>({
    send,
    onResult,
    batchDelayMs = 50,
    maxBatchSize = 100,
}: NotificationReadBatcherOptions<
    TCategory,
    TResult
>): NotificationReadBatcher<TCategory> => {
    const pending = new Map<TCategory, Set<string>>();
    let disposed = false;
    let timer: number | undefined;
    let drainPromise: Promise<void> | null = null;

    const cancelScheduledFlush = () => {
        if (timer === undefined) return;
        window.clearTimeout(timer);
        timer = undefined;
    };

    const takeBatch = (): [TCategory, string[]] | null => {
        const entry = pending.entries().next().value;
        if (!entry) return null;
        const [category, ids] = entry;
        const batch = [...ids].slice(0, maxBatchSize);
        for (const id of batch) ids.delete(id);
        if (ids.size === 0) pending.delete(category);
        return [category, batch];
    };

    const drain = async () => {
        while (!disposed) {
            const batch = takeBatch();
            if (!batch) return;
            const [category, ids] = batch;
            try {
                const result = await send(category, ids);
                if (!disposed) onResult(result);
            } catch {
                // Local optimistic read state is refreshed from the server the
                // next time the notification center opens.
            }
        }
    };

    const startDrain = (): Promise<void> => {
        cancelScheduledFlush();
        if (disposed) return Promise.resolve();
        if (drainPromise) return drainPromise;
        drainPromise = drain().finally(() => {
            drainPromise = null;
            if (!disposed && pending.size > 0) scheduleFlush();
        });
        return drainPromise;
    };

    const scheduleFlush = () => {
        if (disposed || timer !== undefined || drainPromise) return;
        timer = window.setTimeout(() => {
            timer = undefined;
            void startDrain();
        }, batchDelayMs);
    };

    return {
        enqueue: (category, id) => {
            if (disposed) return;
            const ids = pending.get(category) ?? new Set<string>();
            ids.add(id);
            pending.set(category, ids);
            scheduleFlush();
        },
        flush: startDrain,
        dispose: () => {
            disposed = true;
            cancelScheduledFlush();
            pending.clear();
        },
    };
};
