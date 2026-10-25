import { createElement, useRef } from 'react';
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AdaptiveLinearBlur from './AdaptiveLinearBlur';
import styles from './AdaptiveLinearBlur.module.scss';

const mode = vi.hoisted(() => ({ performance: true }));
vi.mock('@/store/uiPrefs', () => ({
    usePerformanceMode: () => mode.performance,
}));
vi.mock('progressive-blur', () => ({
    LinearBlur: () => createElement('div', { 'data-blur': true }),
}));
let resize: (() => void)[];
beforeEach(() => {
    mode.performance = true;
    resize = [];
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40);
    vi.stubGlobal(
        'ResizeObserver',
        class {
            constructor(callback: () => void) {
                resize.push(callback);
            }
            observe() {
                return undefined;
            }
            disconnect() {
                return undefined;
            }
        },
    );
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function View({
    top = true,
    bottom = true,
}: {
    top?: boolean;
    bottom?: boolean;
}) {
    const targetRef = useRef<HTMLDivElement>(null);
    return createElement(
        'div',
        null,
        createElement(AdaptiveLinearBlur, {
            side: 'top',
            targetRef,
            strength: 2,
            visible: top,
        }),
        createElement(
            'div',
            { ref: targetRef, 'data-testid': 'scroll' },
            'Content',
        ),
        createElement(AdaptiveLinearBlur, {
            side: 'bottom',
            targetRef,
            strength: 2,
            visible: bottom,
            falloffPercentage: 50,
        }),
    );
}

it('combines both viewport edges, resizes them, and removes the mask when neither edge is visible', () => {
    const { getByTestId, rerender } = render(createElement(View));
    const target = getByTestId('scroll');
    expect(target.style.getPropertyValue('--scroll-fade-top')).toBe('40px');
    expect(target.style.getPropertyValue('--scroll-fade-bottom')).toBe('20px');
    expect(target.classList.contains(styles.maskTarget)).toBe(true);
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60);
    resize.forEach((callback) => callback());
    expect(target.style.getPropertyValue('--scroll-fade-bottom')).toBe('30px');
    rerender(createElement(View, { top: false }));
    expect(target.style.getPropertyValue('--scroll-fade-top')).toBe('0px');
    expect(target.classList.contains(styles.maskTarget)).toBe(true);
    rerender(createElement(View, { top: false, bottom: false }));
    expect(target.classList.contains(styles.maskTarget)).toBe(false);
});

it('cleans up the viewport mask when returning to the normal blur', () => {
    const { getByTestId, rerender, container } = render(createElement(View));
    const target = getByTestId('scroll');
    mode.performance = false;
    rerender(createElement(View));
    expect(target.classList.contains(styles.maskTarget)).toBe(false);
    expect(target.style.getPropertyValue('--scroll-fade-top')).toBe('');
    expect(target.style.getPropertyValue('--scroll-fade-bottom')).toBe('');
    expect(container.querySelectorAll('[data-blur]')).toHaveLength(2);
});

it('keeps the content masked until a closing animation finishes', () => {
    const original = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'animate',
    );
    const animations: {
        cancel: ReturnType<typeof vi.fn>;
        onfinish: (() => void) | null;
    }[] = [];
    const animate = vi.fn(() => {
        const animation = {
            cancel: vi.fn(),
            onfinish: null as (() => void) | null,
        };
        animations.push(animation);
        return animation;
    });
    Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: animate,
    });
    try {
        const { getByTestId, rerender, unmount } = render(createElement(View));
        const target = getByTestId('scroll');
        rerender(createElement(View, { top: false, bottom: false }));
        expect(target.classList.contains(styles.maskTarget)).toBe(true);
        expect(animate).toHaveBeenLastCalledWith(
            [
                { '--scroll-fade-bottom': '20px' },
                { '--scroll-fade-bottom': '0px' },
            ],
            { duration: 250, easing: 'ease-out' },
        );
        animations.slice(-2).forEach((animation) => animation.onfinish?.());
        expect(target.classList.contains(styles.maskTarget)).toBe(false);
        unmount();
    } finally {
        if (original)
            Object.defineProperty(HTMLElement.prototype, 'animate', original);
        else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
});
