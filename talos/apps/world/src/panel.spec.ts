import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
