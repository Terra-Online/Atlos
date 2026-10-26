import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SideBarFrame, { SidebarFooter } from './sideBar.frame';
import styles from './sideBar.module.scss';
import { getSidebarMaxWidth, useUiPrefsStore } from '@/store/uiPrefs';
import { translate as t } from '../testFixtures';
import { installPointerCapture, installResizeObserver } from '../../../../test-support/browser';

const device = vi.hoisted(() => ({ isMobile: false, width: 1280, height: 800 }));
vi.mock('@/platform/device', async (original) => ({ ...await original<typeof import('@/platform/device')>(), useDevice: () => device, useAppViewport: () => device }));
vi.mock('@/locale', async () => (await import('../testFixtures')).localeFixture);
vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
vi.mock('@/platform/pictureInPicture', async () => (await import('../testFixtures')).pipFixture);
vi.mock('@/component/shared/account/idcard', () => ({ default: () => <div data-testid="account">Account</div> }));
let restorePointer: () => void;
beforeEach(() => {
    device.isMobile = false;
    device.height = 800;
    installResizeObserver();
    restorePointer = installPointerCapture();
    useUiPrefsStore.setState({ sidebarOpen: true, sidebarWidth: 400, mobileDrawerSnapIndex: 0 });
});
afterEach(() => { cleanup(); restorePointer(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('forwards content and bottom tools, persists desktop toggles, and makes a hidden sidebar inert', async () => {
    const content = createRef<HTMLDivElement>();
    const toggle = vi.fn();
    const props = { contentRef: content, onToggle: toggle, bottomTools: <button>Bottom tool</button> };
    const view = render(<SideBarFrame {...props}><p>Filters</p></SideBarFrame>);
    await act(async () => {});
    expect(content.current?.textContent).toContain('Filters');
    expect(screen.getByTestId('account')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bottom tool' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: t('common.collapse') }));
    expect(useUiPrefsStore.getState().sidebarOpen).toBe(false);
    expect(toggle).toHaveBeenCalledWith(false);
    view.rerender(<SideBarFrame {...props} visible={false}><p>Filters</p></SideBarFrame>);
    const frame = view.container.querySelector('[data-sidebar-layout="desktop"]')!;
    expect(frame.hasAttribute('inert')).toBe(true);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
});

it('previews resizing without persisting each move, then commits a clamped width on release', async () => {
    const view = render(<div className="app"><SideBarFrame><p>Filters</p></SideBarFrame></div>);
    await act(async () => {});
    const app = view.container.firstElementChild as HTMLElement;
    const handle = view.container.querySelector<HTMLElement>(`.${styles.resizeHandle}`)!;
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 });
    expect(handle.hasPointerCapture(1)).toBe(true);
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
    expect(app.style.getPropertyValue('--sidebar-width')).toBe('450px');
    expect(useUiPrefsStore.getState().sidebarWidth).toBe(400);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 10000 });
    expect(handle.hasPointerCapture(1)).toBe(false);
    expect(useUiPrefsStore.getState().sidebarWidth).toBe(getSidebarMaxWidth(device.width));
});

it.each(['pointercancel', 'lostpointercapture', 'unmount'] as const)('rolls back the resize preview and releases ownership on %s', async (reason) => {
    const app = document.createElement('div');
    app.className = 'app';
    app.style.setProperty('--sidebar-width', '400px');
    document.body.append(app);
    const view = render(<SideBarFrame><p>Filters</p></SideBarFrame>, { container: app });
    try {
        await act(async () => {});
        const handle = view.container.querySelector<HTMLElement>(`.${styles.resizeHandle}`)!;
        fireEvent.pointerDown(handle, { pointerId: 1, clientX: 400 });
        fireEvent.pointerMove(handle, { pointerId: 1, clientX: 450 });
        expect(handle.classList.contains(styles.dragging)).toBe(true);
        expect(app.style.getPropertyValue('--sidebar-width')).toBe('450px');
        if (reason === 'unmount') view.unmount();
        else fireEvent(handle, new PointerEvent(reason, { bubbles: true, pointerId: 1 }));
        expect(app.style.getPropertyValue('--sidebar-width')).toBe('400px');
        expect(useUiPrefsStore.getState().sidebarWidth).toBe(400);
        expect(handle.hasPointerCapture(1)).toBe(false);
        if (reason !== 'unmount') {
            expect(handle.classList.contains(styles.dragging)).toBe(false);
            fireEvent.pointerMove(handle, { pointerId: 1, clientX: 550 });
            expect(app.style.getPropertyValue('--sidebar-width')).toBe('400px');
            // The cancelled interaction must not stop a subsequent resize.
            fireEvent.pointerDown(handle, { pointerId: 2, clientX: 400 });
            fireEvent.pointerUp(handle, { pointerId: 2, clientX: 420 });
            expect(useUiPrefsStore.getState().sidebarWidth).toBe(420);
        }
    } finally { view.unmount(); app.remove(); }
});

it('locks app sidebars open at their requested width without exposing desktop toggle/resize controls', async () => {
    const view = render(<SideBarFrame lockedOpen fixedWidth={320}><p>Archives</p></SideBarFrame>);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: t('common.collapse') })).toBeNull();
    expect(view.container.querySelector(`.${styles.resizeHandle}`)).toBeNull();
    expect((view.container.firstElementChild as HTMLElement).style.getPropertyValue('--sidebar-width')).toBe('320px');
});

it('drives the real mobile drawer from stored snap commands and updates the stored snap after a handle cycle', async () => {
    device.isMobile = true;
    useUiPrefsStore.setState({ mobileDrawerSnapIndex: 2 });
    const toggle = vi.fn();
    render(<SideBarFrame onToggle={toggle}><p>Archives</p></SideBarFrame>);
    await act(async () => {});
    const drawer = document.querySelector<HTMLElement>('[data-font-region="drawer"]')!;
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('680px'));
    fireEvent.click(screen.getByRole('separator', { name: 'Drawer drag handle' }));
    await waitFor(() => expect(drawer.style.getPropertyValue('--drawer-size')).toBe('64px'));
    expect(useUiPrefsStore.getState().mobileDrawerSnapIndex).toBe(0);
    expect(toggle).toHaveBeenLastCalledWith(false);
});

it('opens and closes the real support dialog from the shared footer and exposes safe social links', async () => {
    render(<SidebarFooter />);
    fireEvent.click(screen.getByRole('button', { name: t('support.title') }));
    expect(screen.getByRole('dialog', { name: t('support.title') })).toBeTruthy();
    for (const name of ['GitHub', 'Discord', 'Bluesky', 'X/Twitter', 'QQ']) {
        const link = screen.getByRole<HTMLAnchorElement>('link', { name });
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
    }
    fireEvent.click(screen.getByRole('button', { name: t('common.close') }));
    expect(screen.getByRole('dialog').parentElement?.hasAttribute('inert')).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
