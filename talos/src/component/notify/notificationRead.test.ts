import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    NOTIFICATION_READ_DWELL_MS,
    createNotificationReadBatcher,
    createNotificationVisibilityObserver,
} from './notificationRead';

interface MockObserverRecord {
    callback: IntersectionObserverCallback;
    options?: IntersectionObserverInit;
    observed: Set<Element>;
}

const observers: MockObserverRecord[] = [];

class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '0px';
    readonly thresholds = [];
    readonly record: MockObserverRecord;

    constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
    ) {
        this.record = { callback, options, observed: new Set() };
        observers.push(this.record);
    }

    disconnect = () => this.record.observed.clear();
    observe = (target: Element) => this.record.observed.add(target);
    takeRecords = () => [];
    unobserve = (target: Element) => this.record.observed.delete(target);
}

const emitIntersection = (
    record: MockObserverRecord,
    target: Element,
    intersectionRatio: number,
) => {
    record.callback(
        [
            {
                target,
                isIntersecting: intersectionRatio > 0,
                intersectionRatio,
            } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver,
    );
};

describe('notification visibility read observer', () => {
    beforeEach(() => {
        observers.length = 0;
        vi.useFakeTimers();
        vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('reads once after at least half the card is visible for the configured dwell time', () => {
        const onRead = vi.fn();
        const root = document.createElement('div');
        const card = document.createElement('article');
        const controller = createNotificationVisibilityObserver({
            root,
            onRead,
        });
        controller.observe(card, 'notification-1');

        expect(observers[0]?.options).toMatchObject({ root, threshold: 0.5 });
        emitIntersection(observers[0], card, 0.5);
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS - 1);
        expect(onRead).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onRead).toHaveBeenCalledOnce();
        expect(onRead).toHaveBeenCalledWith('notification-1');

        emitIntersection(observers[0], card, 1);
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS);
        expect(onRead).toHaveBeenCalledOnce();
        controller.disconnect();
    });

    it('cancels dwell time when the card leaves the threshold', () => {
        const onRead = vi.fn();
        const card = document.createElement('article');
        const controller = createNotificationVisibilityObserver({
            root: document.createElement('div'),
            onRead,
        });
        controller.observe(card, 'notification-1');

        emitIntersection(observers[0], card, 0.75);
        vi.advanceTimersByTime(300);
        emitIntersection(observers[0], card, 0.49);
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS);
        expect(onRead).not.toHaveBeenCalled();
        controller.disconnect();
    });

    it('does not count time while the document is hidden', () => {
        const onRead = vi.fn();
        const card = document.createElement('article');
        const controller = createNotificationVisibilityObserver({
            root: document.createElement('div'),
            onRead,
        });
        controller.observe(card, 'notification-1');
        emitIntersection(observers[0], card, 1);
        vi.advanceTimersByTime(300);

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'hidden',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS);
        expect(onRead).not.toHaveBeenCalled();

        Object.defineProperty(document, 'visibilityState', {
            configurable: true,
            value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        emitIntersection(observers[0], card, 1);
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS);
        expect(onRead).toHaveBeenCalledOnce();
        controller.disconnect();
    });

    it('cancels pending reads when the observer is disconnected', () => {
        const onRead = vi.fn();
        const card = document.createElement('article');
        const controller = createNotificationVisibilityObserver({
            root: document.createElement('div'),
            onRead,
        });
        controller.observe(card, 'notification-1');
        emitIntersection(observers[0], card, 1);
        vi.advanceTimersByTime(300);

        controller.disconnect();
        vi.advanceTimersByTime(NOTIFICATION_READ_DWELL_MS);
        expect(onRead).not.toHaveBeenCalled();
    });
});

describe('notification read batching', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('deduplicates IDs from the same category into one request', async () => {
        const send = vi.fn().mockResolvedValue({ total: 1 });
        const onResult = vi.fn();
        const batcher = createNotificationReadBatcher({ send, onResult });

        batcher.enqueue('community', 'notification-1');
        batcher.enqueue('community', 'notification-1');
        batcher.enqueue('community', 'notification-2');
        await vi.advanceTimersByTimeAsync(49);
        expect(send).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith('community', [
            'notification-1',
            'notification-2',
        ]);
        expect(onResult).toHaveBeenCalledWith({ total: 1 });
        batcher.dispose();
    });

    it('serializes a later batch behind an in-flight request', async () => {
        let resolveFirst: ((value: number) => void) | undefined;
        const send = vi
            .fn()
            .mockImplementationOnce(
                () =>
                    new Promise<number>((resolve) => {
                        resolveFirst = resolve;
                    }),
            )
            .mockResolvedValueOnce(0);
        const onResult = vi.fn();
        const batcher = createNotificationReadBatcher({ send, onResult });

        batcher.enqueue('community', 'notification-1');
        await vi.advanceTimersByTimeAsync(50);
        batcher.enqueue('community', 'notification-2');
        await vi.advanceTimersByTimeAsync(50);
        expect(send).toHaveBeenCalledTimes(1);

        resolveFirst?.(1);
        await vi.advanceTimersByTimeAsync(0);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send).toHaveBeenLastCalledWith('community', [
            'notification-2',
        ]);
        expect(onResult).toHaveBeenNthCalledWith(1, 1);
        expect(onResult).toHaveBeenNthCalledWith(2, 0);
        batcher.dispose();
    });

    it('flushes a pending batch immediately', async () => {
        const send = vi.fn().mockResolvedValue(0);
        const batcher = createNotificationReadBatcher({
            send,
            onResult: vi.fn(),
        });

        batcher.enqueue('system', 'notification-1');
        await batcher.flush();
        expect(send).toHaveBeenCalledWith('system', ['notification-1']);
        batcher.dispose();
    });
});
