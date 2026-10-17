import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { expect, it, vi } from 'vitest';
import OverflowPopoverText from './OverflowPopoverText';

vi.mock('./popover', () => ({
    default: ({
        children,
        disabled,
    }: {
        children: ReactNode;
        disabled: boolean;
    }) => (
        <span data-testid='tooltip' data-disabled={String(disabled)}>
            {children}
        </span>
    ),
}));

it('remeasures font-metric changes only for its own region', () => {
    const { container, unmount } = render(
        <div data-font-region>
            <OverflowPopoverText text='字体切换后的标题' />
        </div>,
    );
    const text = screen.getByText('字体切换后的标题');
    let width = 120;
    Object.defineProperty(text, 'clientWidth', {
        configurable: true,
        value: 80,
    });
    Object.defineProperty(text, 'scrollWidth', {
        configurable: true,
        get: () => width,
    });
    const region = container.firstElementChild!;
    expect(screen.getByTestId('tooltip').getAttribute('data-disabled')).toBe(
        'true',
    );
    act(() => {
        region.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
    });
    expect(screen.getByTestId('tooltip').getAttribute('data-disabled')).toBe(
        'false',
    );
    width = 60;
    const sibling = document.createElement('div');
    document.body.append(sibling);
    act(() => {
        sibling.dispatchEvent(
            new Event('fontregionchange', { bubbles: true }),
        );
    });
    expect(screen.getByTestId('tooltip').getAttribute('data-disabled')).toBe(
        'false',
    );
    act(() => {
        region.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
    });
    expect(screen.getByTestId('tooltip').getAttribute('data-disabled')).toBe(
        'true',
    );
    sibling.remove();
    unmount();
});
