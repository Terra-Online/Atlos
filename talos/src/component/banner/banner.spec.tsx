import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Banner from './banner';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps an interrupted close mounted and reports only a completed dismissal', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const { rerender } = render(<Banner content="first" onClose={onClose} />);
    const banner = screen.getByText('first').closest('[data-state]')!;
    expect(banner.getAttribute('data-state')).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(banner.getAttribute('data-state')).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(banner.getAttribute('data-state')).toBe('open');
    fireEvent.click(screen.getByRole('button'));
    await act(() => vi.advanceTimersByTime(100));
    rerender(<Banner content="second" onClose={onClose} />);
    await act(() => vi.advanceTimersByTime(250));
    expect(screen.getByText('second').closest('[data-state]')).toBe(banner);
    expect(banner.getAttribute('data-state')).toBe('open');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button'));
    await act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('second')).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
});

it('keeps the outgoing content during a prop-driven exit without reporting a user dismissal', async () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    const view = render(<Banner content="Previous" onClose={onClose} schema="dark" />);
    expect(screen.getByRole('button').dataset.schema).toBe('dark');
    view.rerender(<Banner open={false} content="Next" onClose={onClose} />);
    expect(screen.getByText('Previous')).toBeTruthy();
    expect(screen.queryByText('Next')).toBeNull();
    await act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText('Previous')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<Banner content="Next" onClose={onClose} />);
    expect(screen.getByText('Next')).toBeTruthy();
});
