import { StrictMode, createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import Modal from './modal';
import Viewer from '@/component/viewer/viewer';

vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key, useLocale: () => 'en' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document, getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/upvote.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/flag.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/share.svg?react', () => ({ default: () => null }));
vi.mock('@/assets/images/UI/recall.svg?react', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('mounts closed before entering and preserves the portal when an exit is interrupted', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const afterClose = vi.fn();
    const view = (open: boolean) => <StrictMode><Modal open={open} onAfterClose={afterClose}>content</Modal></StrictMode>;
    const { rerender } = render(view(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view(true));
    const dialog = screen.getByRole('dialog');
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('open');
    rerender(view(false));
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(true);
    await act(() => vi.advanceTimersByTime(100));
    rerender(view(true));
    await act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog.dataset.state).toBe('open');
    expect(afterClose).not.toHaveBeenCalled();
    rerender(view(false));
    await act(() => vi.advanceTimersByTime(325));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(afterClose).toHaveBeenCalledOnce();
});

it('waits for viewer content before starting its entry', async () => {
    vi.useFakeTimers();
    const view = (imageUrl: string) => <Viewer open imageUrl={imageUrl} alt="preview" onClose={() => {}} />;
    const { rerender } = render(view(''));
    await act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(view('/preview.webp'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('closed');
    await act(() => vi.advanceTimersToNextFrame());
    expect(dialog.dataset.state).toBe('open');
});

it('measures scroll once per frame and stops observing while a modal exits', async () => {
    vi.useFakeTimers();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect = disconnect; });
    const scroller = createRef<HTMLDivElement>();
    const modal = (open: boolean) => (
        <Modal open={open} animateOnOpen={false} showClose={false} contentRef={scroller}>Body</Modal>
    );
    const view = render(modal(true));
    const content = scroller.current!;
    const readHeight = vi.spyOn(content, 'scrollHeight', 'get');
    for (let event = 0; event < 20; event += 1) fireEvent.scroll(content);
    expect(readHeight).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersToNextFrame());
    expect(readHeight).toHaveBeenCalledOnce();

    fireEvent.scroll(content);
    view.rerender(modal(false));
    expect(disconnect).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTime(100));
    expect(readHeight).toHaveBeenCalledOnce();
    expect(content.isConnected).toBe(true);
});
