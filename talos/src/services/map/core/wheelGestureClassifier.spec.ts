import { describe, expect, it } from 'vitest';
import {
    WHEEL_GESTURE_DECISION_MS,
    WHEEL_GESTURE_IDLE_MS,
    WheelGestureClassifier,
    inferWheelGestureMode,
    type WheelGestureSample,
} from 'trackpad-input';

const sample = (
    overrides: Partial<WheelGestureSample> = {},
): WheelGestureSample => ({
    ctrlKey: false,
    deltaMode: 0,
    deltaX: 0,
    deltaY: 0,
    timeStamp: 0,
    ...overrides,
});

describe('inferWheelGestureMode', () => {
    it('keeps line and page mode mouse wheels on zoom', () => {
        expect(inferWheelGestureMode(sample({ deltaMode: 1, deltaY: 3 }))).toBe(
            'zoom',
        );
        expect(inferWheelGestureMode(sample({ deltaMode: 2, deltaY: 1 }))).toBe(
            'zoom',
        );
    });

    it('keeps large integer pixel-mode vertical wheels on zoom', () => {
        expect(inferWheelGestureMode(sample({ deltaY: 100 }))).toBe('zoom');
    });

    it('keeps a legacy vertical mouse wheel on zoom', () => {
        expect(
            inferWheelGestureMode(
                sample({ deltaY: 3, wheelDelta: -120, wheelDeltaY: -120 }),
            ),
        ).toBe('zoom');
    });

    it('lets explicit horizontal input override legacy fields', () => {
        expect(
            inferWheelGestureMode(
                sample({
                    deltaX: 2,
                    deltaY: 5,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('pan');
        expect(
            inferWheelGestureMode(
                sample({
                    deltaX: 12,
                    deltaY: 100,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('pan');
    });

    it('maps pixel-mode two-axis trackpad scrolling to pan', () => {
        expect(inferWheelGestureMode(sample({ deltaX: 0.01, deltaY: 4 }))).toBe(
            'pan',
        );
        expect(inferWheelGestureMode(sample({ deltaX: 60, deltaY: 80 }))).toBe(
            'pan',
        );
    });

    it('never maps pure vertical pixel input to pan', () => {
        expect(inferWheelGestureMode(sample({ deltaY: -3 }))).toBe('zoom');
        expect(inferWheelGestureMode(sample({ deltaY: 2.25 }))).toBe('zoom');
        expect(inferWheelGestureMode(sample({ deltaX: 0, deltaY: 3 }))).toBe(
            'zoom',
        );
        expect(
            inferWheelGestureMode(
                sample({ deltaY: 3, wheelDelta: -9, wheelDeltaY: -9 }),
            ),
        ).toBe('zoom');
        expect(inferWheelGestureMode(sample({ deltaY: 40.5 }))).toBe('zoom');
    });

    it('maps ctrl-wheel trackpad pinch to zoom', () => {
        expect(
            inferWheelGestureMode(
                sample({ ctrlKey: true, deltaX: 2, deltaY: 1.5 }),
            ),
        ).toBe('zoom');
    });
});

describe('WheelGestureClassifier', () => {
    it('classifies a legacy mouse stream as zoom immediately', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 10,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
        expect(
            classifier.classify(
                sample({
                    deltaY: 5,
                    timeStamp: 10 + WHEEL_GESTURE_DECISION_MS - 1,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
    });

    it('promotes buffered input on the first horizontal component', () => {
        const classifier = new WheelGestureClassifier();

        expect(classifier.classify(sample({ deltaY: 3, timeStamp: 10 }))).toBe(
            'pending',
        );
        expect(
            classifier.classify(
                sample({
                    deltaX: 0.01,
                    deltaY: 5,
                    timeStamp: 10 + WHEEL_GESTURE_DECISION_MS - 1,
                }),
            ),
        ).toBe('pan');
    });

    it('falls a lone ambiguous wheel sample back to zoom', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 10,
                }),
            ),
        ).toBe('pending');
        expect(classifier.resolvePendingAsZoom()).toBe('zoom');
    });

    it('locks the first decision for one continuous gesture', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(sample({ deltaX: 0.01, timeStamp: 10 })),
        ).toBe('pan');
        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 20,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('pan');
    });

    it('does not let later axis noise take over a mouse wheel gesture', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(sample({ deltaY: 100, timeStamp: 10 })),
        ).toBe('pending');
        expect(classifier.resolvePendingAsZoom()).toBe('zoom');
        expect(
            classifier.classify(
                sample({ deltaX: 0.5, deltaY: 90, timeStamp: 20 }),
            ),
        ).toBe('zoom');
    });

    it('does not let event timestamps split an active gesture', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(sample({ deltaX: 0.01, timeStamp: 10 })),
        ).toBe('pan');
        expect(
            classifier.classify(
                sample({
                    deltaY: 100,
                    timeStamp: 10 + WHEEL_GESTURE_IDLE_MS + 1,
                }),
            ),
        ).toBe('pan');
        classifier.reset();
        expect(
            classifier.classify(
                sample({
                    deltaY: 100,
                    timeStamp: 10 + WHEEL_GESTURE_IDLE_MS + 1,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
    });

    it('can be reset when the input session becomes idle', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(sample({ deltaX: 0.01, timeStamp: 10 })),
        ).toBe('pan');
        classifier.reset();
        expect(
            classifier.classify(sample({ deltaY: 100, timeStamp: 20 })),
        ).toBe('pending');
        expect(classifier.resolvePendingAsZoom()).toBe('zoom');
    });

    it('never lets a pure vertical legacy mouse stream start panning', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(
                sample({
                    deltaY: 5,
                    timeStamp: 10,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
        expect(
            classifier.classify(
                sample({
                    deltaY: 4,
                    timeStamp: 20,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
    });

    it('accepts a single small horizontal component as trackpad pan', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(
                sample({ deltaX: 0.01, deltaY: 3, timeStamp: 10 }),
            ),
        ).toBe('pan');
    });

    it('keeps a legacy vertical momentum tail in the active pan', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(sample({ deltaX: 0.01, timeStamp: 10 })),
        ).toBe('pan');
        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 30,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('pan');
    });

    it('keeps pan sticky until the owner ends the input session', () => {
        const classifier = new WheelGestureClassifier();

        expect(
            classifier.classify(
                sample({ deltaX: 4, deltaY: 4, timeStamp: 10 }),
            ),
        ).toBe('pan');
        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 10 + WHEEL_GESTURE_IDLE_MS + 1,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('pan');
        classifier.reset();
        expect(
            classifier.classify(
                sample({
                    deltaY: 3,
                    timeStamp: 20,
                    wheelDelta: -120,
                    wheelDeltaY: -120,
                }),
            ),
        ).toBe('zoom');
    });
});
