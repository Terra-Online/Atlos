import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

describe('preview window lifecycle', () => {
    const origin = 'https://oem-noclip.pages.dev';
    let popup: Window;
    type Post = (
        message: { type: string; point: string },
        origin: string,
    ) => void;
    let postMessage: Mock<Post>;
    let open: Mock<Window['open']>;
    beforeEach(() => {
        vi.resetModules();
        postMessage = vi.fn<Post>();
        popup = {
            closed: false,
            postMessage,
            focus: vi.fn(),
        } as unknown as Window;
        open = vi.fn<Window['open']>().mockReturnValue(popup);
        vi.spyOn(window, 'open').mockImplementation(open);
    });
    const ready = (session: string, source: Window, sender = origin) =>
        window.dispatchEvent(
            new MessageEvent('message', {
                origin: sender,
                source,
                data: { version: 1, session, type: 'ready' },
            }),
        );

    it('opens from the click and sends only the latest target after a validated handshake', async () => {
        const { openPreview } = await import('./preview');
        openPreview('first', 'release');
        const url = new URL(String(open.mock.calls[0][0]));
        const session = url.searchParams.get('session')!;
        openPreview('second', 'release');
        expect(open).toHaveBeenCalledTimes(1);
        ready(session, popup, 'https://attacker.example');
        ready(session, window);
        expect(postMessage).not.toHaveBeenCalled();
        ready(session, popup);
        expect(postMessage).toHaveBeenLastCalledWith(
            { version: 1, session, type: 'open-point', point: 'second' },
            origin,
        );
    });

    it('reuses a ready window when another point is opened', async () => {
        const { openPreview } = await import('./preview');
        openPreview('first', 'release');
        const session = new URL(String(open.mock.calls[0][0])).searchParams.get(
            'session',
        )!;
        ready(session, popup);
        postMessage.mockClear();
        openPreview('second', 'release');
        expect(open).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledExactlyOnceWith(
            { version: 1, session, type: 'open-point', point: 'second' },
            origin,
        );
    });

    it('keeps a normal-link fallback when a popup is blocked', async () => {
        open.mockReturnValue(null);
        const { openPreview } = await import('./preview');
        expect(openPreview('point', 'release')).toBe(false);
    });
});
