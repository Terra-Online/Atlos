import { createElement } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useIdCardHoverAngle } from './useIdCardHoverAngle';

function Card() {
    const { cardRef, handleCardMouseMove, handleCardMouseLeave } = useIdCardHoverAngle();
    return createElement('div', { ref: cardRef, onMouseMove: handleCardMouseMove, onMouseLeave: handleCardMouseLeave, 'data-testid': 'card' });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('takes the shortest leave and reentry path after several counterclockwise pointer rotations', () => {
    const { getByTestId } = render(createElement(Card));
    const card = getByTestId('card');
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    const move = (degrees: number) => {
        const radians = degrees * Math.PI / 180;
        fireEvent.mouseMove(card, { clientX: 50 + Math.sin(radians) * 40, clientY: 50 - Math.cos(radians) * 40 });
    };
    const angle = () => Number.parseFloat(card.style.getPropertyValue('--idcard-hover-angle'));
    move(0);
    act(() => { vi.advanceTimersByTime(200); });
    for (const degrees of [270, 180, 90, 0, 270, 180, 90, 0]) move(degrees);
    const beforeLeave = angle();
    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(200); });
    expect(Math.abs(angle() - beforeLeave)).toBeLessThanOrEqual(180);
    const beforeReentry = angle();
    move(350);
    act(() => { vi.advanceTimersByTime(200); });
    expect(Math.abs(angle() - beforeReentry)).toBeLessThanOrEqual(180);
});

it('cancels the owned hover animation when unmounted', () => {
    const { getByTestId, unmount } = render(createElement(Card));
    const card = getByTestId('card');
    vi.spyOn(card, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100));
    fireEvent.mouseMove(card, { clientX: 50, clientY: 0 });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});
