import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPopover, setRect } from '../../../test-support/browser';
import type { UGCImage } from '@/services/ugc/client';
import Viewer from './viewer';

vi.mock('@/locale', () => ({ useLocale: () => 'en-US', useTranslateUI: () => (key: string) => key }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getAppDocument: () => document, subscribePictureInPictureState: () => () => {} }));

// Distinct metadata catches a carousel that changes only its image pixels.
const images: UGCImage[] = [
    { id: 'first', markerId: 'point', url: '/first.webp', content: 'First image', author: { nickname: 'Alice', publicUid: '42' }, createdAt: '2026-01-01T00:00:00Z', upvotes: 3, upvoted: true },
    { id: 'second', markerId: 'point', url: '/second.webp', content: 'Second image', author: { nickname: 'Bob', publicUid: '43' }, createdAt: '2026-02-01T00:00:00Z', upvoteCount: 7, flagged: true, status: 'remove_request' },
];
let popover: ReturnType<typeof installPopover>;
beforeEach(() => { vi.useFakeTimers(); popover = installPopover(); });
afterEach(() => { cleanup(); popover.restore(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('keeps carousel selection, metadata and image loading state in step through the owner', () => {
    const change = vi.fn();
    function Page() {
        const [selected, setSelected] = useState('first');
        return <Viewer open imageUrl="/fallback.webp" alt="Fallback" images={images} selectedImageId={selected} onSelectedImageIdChange={(id) => { change(id); setSelected(id); }} onClose={() => {}} />;
    }
    render(<Page />);
    const first = screen.getByRole('img', { name: 'First image' });
    expect(first.getAttribute('src')).toBe('/first.webp');
    expect(first.dataset.loaded).toBe('false');
    fireEvent.load(first);
    expect(first.dataset.loaded).toBe('true');
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upvote' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Switch image' }), { key: 'ArrowRight' });
    const next = screen.getByRole('img', { name: 'Second image' });
    expect(change).toHaveBeenLastCalledWith('second');
    expect(next.dataset.loaded).toBe('false');
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(screen.queryByText('Alice')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upvote' }).querySelector('span')?.textContent).toBe('7');
    expect(screen.getByRole('button', { name: 'Flag' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(screen.getByRole('button', { name: 'Switch image' }), { key: 'ArrowRight' });
    expect(change).toHaveBeenLastCalledWith('first');
    expect(screen.getByRole('dialog', { name: 'First image' })).toBeTruthy();
});

it('navigates only within the carousel hit zones and keeps the click inside the viewer', () => {
    const change = vi.fn();
    const close = vi.fn();
    render(<Viewer open imageUrl="" alt="Fallback" images={images} selectedImageId="first" onSelectedImageIdChange={change} onClose={close} />);
    const layer = screen.getByRole('button', { name: 'Switch image' });
    setRect(layer, 10, 20, 1000, 600);
    fireEvent.click(layer, { clientX: 500, clientY: 320 });
    fireEvent.click(layer, { clientX: 950, clientY: 40 });
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(layer, { clientX: 50, clientY: 320 });
    expect(change).toHaveBeenLastCalledWith('second');
    fireEvent.click(layer, { clientX: 960, clientY: 320 });
    expect(change).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(close).toHaveBeenCalledOnce();
});

it('gates actions by permissions, pending state and callbacks without losing action targets', () => {
    const callbacks = { onToggleUpvote: vi.fn(), onToggleFlag: vi.fn(), onShare: vi.fn(), onToggleRecall: vi.fn(), onRecallBlur: vi.fn(), onRequestUpload: vi.fn() };
    const view = render(<Viewer open imageUrl="/one.webp" alt="One" canRecall canAppendUpload {...callbacks} onClose={() => {}} />);
    for (const name of ['Upvote', 'Flag', 'Share', 'detail.viewer.recall', 'detail.viewer.uploadAno']) fireEvent.click(screen.getByRole('button', { name }));
    for (const callback of Object.values(callbacks).filter((fn) => fn !== callbacks.onRecallBlur)) expect(callback).toHaveBeenCalledOnce();
    fireEvent.blur(screen.getByRole('button', { name: 'detail.viewer.recall' }));
    expect(callbacks.onRecallBlur).toHaveBeenCalledOnce();
    view.rerender(<Viewer open imageUrl="/one.webp" alt="One" canFlag={false} canRecall actionPending recallConfirming shareCopied onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Flag' })).toBeNull();
    for (const name of ['Upvote', 'Share', 'common.confirmAgain', 'detail.viewer.uploadAno']) expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true);
    view.rerender(<Viewer open imageUrl="/one.webp" alt="One" canRecall recallOnly recallRequested onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Upvote' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull();
    expect(screen.getByRole('button', { name: 'detail.viewer.unrecall' }).getAttribute('aria-pressed')).toBe('true');
});

it('uses fallback metadata for a single image and cancels an interrupted exit', async () => {
    const view = render(<Viewer open imageUrl="/one.webp" alt="One" onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Switch image' })).toBeNull();
    expect(screen.getAllByText('--')).toHaveLength(3);
    const dialog = screen.getByRole('dialog');
    view.rerender(<Viewer open={false} imageUrl="/one.webp" alt="One" onClose={() => {}} />);
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(true);
    await act(() => vi.advanceTimersByTime(100));
    view.rerender(<Viewer open imageUrl="/one.webp" alt="One" onClose={() => {}} />);
    await act(() => vi.advanceTimersByTime(400));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(false);
});
