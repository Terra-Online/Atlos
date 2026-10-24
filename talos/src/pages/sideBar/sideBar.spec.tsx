import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SideBar from './sideBar';

const { increment, owner } = vi.hoisted(() => ({ increment: vi.fn(), owner: { document: null as Document | null } }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ isMobile: false }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => owner.document ?? document }));
vi.mock('@/store/uiPrefs', () => ({ useIncrementLayoutVersion: () => increment }));
vi.mock('./sideBar.desktop', () => ({ default: () => <div data-sidebar-fonts="true" /> }));
vi.mock('./sideBar.mobile', () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); increment.mockReset(); owner.document = null; });

it('invalidates selector measurements once for a sidebar font commit, ignoring other areas', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    const view = render(<SideBar currentRegion={null} onToggle={() => {}} />);
    act(() => {
        view.container.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
        view.container.querySelector('[data-sidebar-fonts]')!.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
        document.body.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
    });
    expect(frames).toHaveLength(1);
    act(() => frames[0](0));
    expect(increment).toHaveBeenCalledOnce();
});

it('moves the font listener to the adopted document and cancels the old frame', () => {
    const oldFrames: FrameRequestCallback[] = [], nextFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { oldFrames.push(callback); return oldFrames.length; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(<SideBar currentRegion={null} onToggle={() => {}} />);
    act(() => { document.body.dispatchEvent(new Event('fontregionchange', { bubbles: true })); });
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const nextDocument = iframe.contentDocument!, nextView = nextDocument.defaultView!;
    Object.defineProperty(nextView, 'requestAnimationFrame', { configurable: true, value: (callback: FrameRequestCallback) => { nextFrames.push(callback); return nextFrames.length; } });
    Object.defineProperty(nextView, 'cancelAnimationFrame', { configurable: true, value: vi.fn() });
    try {
        const adopted = document.createElement('div'); adopted.setAttribute('data-sidebar-fonts', 'true');
        nextDocument.body.append(nextDocument.adoptNode(adopted));
        owner.document = nextDocument;
        view.rerender(<SideBar currentRegion={null} onToggle={() => {}} />);
        expect(cancel).toHaveBeenCalledWith(1);
        act(() => {
            document.body.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
            adopted.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
        });
        expect(oldFrames).toHaveLength(1);
        expect(nextFrames).toHaveLength(1);
        act(() => nextFrames[0](0));
        expect(increment).toHaveBeenCalledOnce();
        view.unmount();
        nextDocument.body.dispatchEvent(new Event('fontregionchange', { bubbles: true }));
        expect(nextFrames).toHaveLength(1);
    } finally { iframe.remove(); }
});
