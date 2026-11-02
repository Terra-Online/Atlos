import { createElement } from 'react';
import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Panel } from './panel';

vi.mock('@/locale/fontLoader', () => ({
    registerFontRegion: () => ({ update() {}, stop() {} }),
}));
afterEach(cleanup);

it('collapses by its named heading, preserves control state, and keeps header actions independent', () => {
    const reset = vi.fn();
    render(
        createElement(Panel, {
            title: 'Display settings',
            label: 'display settings',
            actions: createElement('button', { onClick: reset }, 'Reset'),
            children: createElement('input', {
                'aria-label': 'Exposure',
                defaultValue: '1',
            }),
        }),
    );
    const heading = screen.getByRole('button', { name: 'Display settings' });
    const input = screen.getByRole('textbox', { name: 'Exposure' });
    const body = document.getElementById(
        heading.getAttribute('aria-controls')!,
    )!;
    const cameraKeys = vi.fn();
    window.addEventListener('keydown', cameraKeys);
    fireEvent.keyDown(heading, { key: ' ', code: 'Space' });
    window.removeEventListener('keydown', cameraKeys);
    expect(cameraKeys).not.toHaveBeenCalled();
    fireEvent.input(input, { target: { value: '2' } });
    fireEvent.click(heading);
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(body.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(body.hidden).toBe(true);
    fireEvent.click(heading);
    expect(body.hidden).toBe(false);
    expect(screen.getByRole('textbox', { name: 'Exposure' })).toBe(input);
    expect(input).toHaveProperty('value', '2');
});

it('animates like the SDK demo and ignores a cancelled collapse after reopening', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'animate',
    );
    const animations: { cancel: () => void; onfinish: (() => void) | null }[] =
        [];
    const animate = vi.fn(
        (_frames: unknown, _options: KeyframeAnimationOptions) => {
            const animation: {
                cancel: () => void;
                onfinish: (() => void) | null;
            } = { cancel: vi.fn(), onfinish: null };
            animations.push(animation);
            return animation;
        },
    );
    Object.defineProperty(HTMLElement.prototype, 'animate', {
        configurable: true,
        value: animate,
    });
    try {
        render(
            createElement(Panel, {
                title: 'Filters',
                label: 'filters',
                children: createElement('input', { 'aria-label': 'Strength' }),
            }),
        );
        const heading = screen.getByRole('button', { name: 'Filters' });
        const input = screen.getByRole('textbox', { name: 'Strength' });
        const body = document.getElementById(
            heading.getAttribute('aria-controls')!,
        )!;
        fireEvent.click(heading);
        expect(animate.mock.calls[0]?.[1]).toEqual({
            duration: 240,
            easing: 'cubic-bezier(0.6, 0, 0, 1)',
        });
        expect(body.hidden).toBe(false);
        expect(body.hasAttribute('inert')).toBe(true);
        const staleFinish = animations[0].onfinish;
        fireEvent.click(heading);
        expect(animations[0].cancel).toHaveBeenCalled();
        act(() => staleFinish?.());
        expect(body.hidden).toBe(false);
        act(() => animations[1].onfinish?.());
        expect(screen.getByRole('textbox', { name: 'Strength' })).toBe(input);
        fireEvent.click(heading);
        act(() => animations[2].onfinish?.());
        expect(body.hidden).toBe(true);
    } finally {
        cleanup();
        if (descriptor)
            Object.defineProperty(HTMLElement.prototype, 'animate', descriptor);
        else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
    }
});
