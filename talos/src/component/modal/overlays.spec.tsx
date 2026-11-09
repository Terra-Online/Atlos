import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installPopover, installResizeObserver, setRect } from '../../../test-support/browser';
import Modal from './modal';
import Viewer from '@/component/viewer/viewer';
import PopoverTooltip from '@/component/popover/popover';
import ContextMenu from '@/component/contextMenu/ContextMenu';
import ActionBar from '@/component/actionBar/ActionBar';

const platform = vi.hoisted(() => ({ document: null as Document | null }));
const fontRef = () => {};
vi.mock('@/locale', () => ({ useTranslateUI: () => (key: string) => key, useLocale: () => 'en-US' }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => fontRef }));
vi.mock('@/locale/fontLoader', () => ({ registerFontRegion: () => ({ update() {}, stop() {} }) }));
vi.mock('@/platform/pictureInPicture', () => ({
    useAppDocument: () => platform.document ?? document,
    getAppDocument: () => platform.document ?? document,
    getOpenerDocument: () => document,
    subscribePictureInPictureState: () => () => {},
}));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));

let popover: ReturnType<typeof installPopover>;
beforeEach(() => {
    vi.useFakeTimers();
    installResizeObserver();
    popover = installPopover();
    platform.document = null;
});
afterEach(() => {
    cleanup();
    popover.restore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

const escape = () => fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' });
const finishExit = (ms = 325) => act(() => { vi.advanceTimersByTime(ms); });

it('keeps closing controlled by the owner and emits the same callbacks for button, mask and Escape', () => {
    const onClose = vi.fn();
    const onChange = vi.fn();
    const view = render(<Modal open title="Settings" animateOnOpen={false} onClose={onClose} onChange={onChange}>Body</Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.close' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.click(dialog.parentElement!);
    escape();
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onChange.mock.calls).toEqual([[false], [false], [false]]);
    view.rerender(<Modal open={false} title="Settings" onClose={onClose} onChange={onChange}>Body</Modal>);
    finishExit();
    expect(screen.queryByRole('dialog')).toBeNull();
});

it('honors close policies and leaves composing Escape alone', () => {
    const onClose = vi.fn();
    const view = render(<Modal open title="Protected" showClose={false} maskClosable={false} closeOnEsc={false} onClose={onClose}>Body</Modal>);
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    escape();
    expect(onClose).not.toHaveBeenCalled();
    view.rerender(<Modal open title="Protected" onClose={onClose}>Body</Modal>);
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledOnce();
});

it('traps focus across actual controls and a tooltip, restoring the opener and previous scroll policy', () => {
    document.body.style.overflow = 'auto';
    function Page() {
        const [open, setOpen] = useState(false);
        return <>
            <button onClick={() => setOpen(true)}>Open</button>
            <Modal open={open} title="Account" animateOnOpen={false} onChange={setOpen}>
                <PopoverTooltip content="Last control hint"><button>Last</button></PopoverTooltip>
            </Modal>
        </>;
    }
    const view = render(<Page />);
    const opener = screen.getByRole('button', { name: 'Open' });
    act(() => opener.focus());
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog');
    const first = within(dialog).getByRole('button', { name: 'common.close' });
    const last = within(dialog).getByRole('button', { name: 'Last' });
    setRect(first, 0, 0, 20, 20);
    setRect(last, 0, 40, 20, 20);
    expect(document.activeElement).toBe(dialog);
    act(() => popover.focusVisible(last));
    const hint = screen.getByRole('tooltip');
    expect(popover.isOpen(hint)).toBe(true);
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    // Escape dismisses the hint before the dialog.
    escape();
    expect(popover.isOpen(hint)).toBe(false);
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(false);
    escape();
    expect(dialog.parentElement?.hasAttribute('inert')).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
    finishExit();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('auto');
    view.unmount();
    document.body.style.overflow = '';
});

it('isolates viewer and menu dismissal above a modal and restores focus in reverse order', () => {
    function Page() {
        const [viewer, setViewer] = useState(false);
        const [menu, setMenu] = useState(false);
        return <>
            <Modal open title="Parent" animateOnOpen={false}>
                <button onClick={() => setViewer(true)}>Preview</button>
                <button onClick={() => setMenu(true)}>Menu</button>
            </Modal>
            <Viewer open={viewer} imageUrl="/preview.webp" alt="Preview image" onClose={() => setViewer(false)} />
            {menu && <ContextMenu ownerDocument={document} position={{ x: 20, y: 40 }} groups={[{ id: 'actions', items: [{ id: 'copy', label: 'Copy', onSelect() {} }] }]} onDismiss={() => setMenu(false)} />}
        </>;
    }
    render(<Page />);
    const parent = screen.getByRole('dialog', { name: 'Parent' });
    const preview = within(parent).getByRole('button', { name: 'Preview' });
    act(() => preview.focus());
    fireEvent.click(preview);
    const viewer = screen.getByRole('dialog', { name: 'Preview image' });
    expect(parent.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(parent.parentElement!);
    expect(viewer.isConnected).toBe(true);
    escape();
    finishExit(300);
    expect(screen.queryByRole('dialog', { name: 'Preview image' })).toBeNull();
    expect(document.activeElement).toBe(preview);
    expect(document.body.style.overflow).toBe('hidden');
    const trigger = within(parent).getByRole('button', { name: 'Menu' });
    act(() => trigger.focus());
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByRole('menuitem'));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBe(parent);
});

it('dismisses a floating toolbar before a modal takes ownership', () => {
    const dismiss = vi.fn();
    const anchor = new DOMRect(40, 80, 100, 20);
    const items = [{ id: 'copy', label: 'Copy', icon: 'C' }];
    const page = (open: boolean) => <>
        <ActionBar variant="floating" anchorRect={anchor} onFloatingDismiss={dismiss} items={items} />
        <Modal open={open} title="Import" animateOnOpen={false} />
    </>;
    const view = render(page(false));
    const toolbar = screen.getByRole('toolbar');
    expect(popover.isOpen(toolbar)).toBe(true);
    view.rerender(page(true));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(popover.isOpen(toolbar)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
});

it('moves a portal between documents while full-size modals stay in the opener', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const other = frame.contentDocument!;
    const view = render(<Modal open title="Moving" animateOnOpen={false} />);
    try {
        expect(document.body.style.overflow).toBe('hidden');
        platform.document = other;
        view.rerender(<Modal open title="Moving" animateOnOpen={false} />);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(within(other.body).getByRole('dialog', { name: 'Moving' })).toBeTruthy();
        expect(document.body.style.overflow).toBe('');
        expect(other.body.style.overflow).toBe('hidden');
        view.rerender(<Modal open title="Moving" size="full" animateOnOpen={false} />);
        expect(screen.getByRole('dialog', { name: 'Moving' })).toBeTruthy();
        expect(other.body.style.overflow).toBe('');
    } finally {
        view.unmount();
        frame.remove();
    }
    expect(document.body.style.overflow).toBe('');
});
