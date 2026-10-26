import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AnnModal, { type AnnItem } from './announcement';
import { installResizeObserver } from '../../../test-support/browser';

const mocks = vi.hoisted(() => ({ read: vi.fn(), mode: '' as string, t: (key: string) => key }));
vi.mock('@/locale', () => ({ useTranslateUI: () => mocks.t }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/services/announcements/client', () => ({ getAnnouncementDebugMode: () => mocks.mode, setAnnouncementLastRead: mocks.read }));

const announcements: AnnItem[] = [
    { id: 'new', date: '2026-10-27', title: 'New release', description: 'Latest changes', content: '**New** map features' },
    { id: 'old', date: '2026-10-26', title: 'Earlier release', description: 'Earlier changes', content: '[Documentation](https://example.test/docs)' },
];
beforeEach(() => { installResizeObserver(); mocks.read.mockClear(); mocks.mode = ''; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('marks only a visible nonempty release list as read, preserving the latest id and date', () => {
    const unread = vi.fn();
    const view = render(<AnnModal open={false} announcements={announcements} onHasUnread={unread} />);
    expect(mocks.read).not.toHaveBeenCalled();
    view.rerender(<AnnModal open announcements={announcements} onHasUnread={unread} />);
    expect(mocks.read).toHaveBeenCalledWith({ id: 'new', date: '2026-10-27' });
    expect(unread).toHaveBeenCalledWith(false);
    expect(screen.getByRole('tab', { name: 'New release' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Earlier release' }));
    expect(screen.getByRole('link', { name: 'Documentation' }).getAttribute('href')).toBe('https://example.test/docs');
    view.rerender(<AnnModal open announcements={[announcements[0]]} onHasUnread={unread} />);
    expect(screen.getByRole('tab', { name: 'New release' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('link', { name: 'Documentation' })).toBeNull();
});

it('keeps the forced-unread debug mode unread and renders an empty list without a read acknowledgement', () => {
    mocks.mode = 'force-unread';
    const unread = vi.fn();
    const view = render(<AnnModal open announcements={announcements} onHasUnread={unread} />);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(unread).not.toHaveBeenCalled();
    mocks.mode = '';
    view.rerender(<AnnModal open announcements={[]} onHasUnread={unread} />);
    expect(screen.getByText('announcement.empty')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(mocks.read).not.toHaveBeenCalled();
});

it.each(['button', 'Escape', 'mask'] as const)('reports one close and one controlled state change through %s', (method) => {
    const close = vi.fn(), change = vi.fn();
    render(<AnnModal open onClose={close} onChange={change} />);
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    else if (method === 'Escape') act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    else fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(close).toHaveBeenCalledOnce();
    expect(change).toHaveBeenCalledExactlyOnceWith(false);
});
