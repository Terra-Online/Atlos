import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/locale', () => ({ getCurrentLocale: () => 'en-US' }));

describe('preview window lifecycle', () => {
    const origin = 'https://world.opendfieldmap.org';
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
                data: { version: 1, nonce: session, type: 'world-ready' },
            }),
        );

    it('opens from the click and sends only the latest target after a validated handshake', async () => {
        const { openPreview } = await import('./preview');
        openPreview('1');
        const url = new URL(String(open.mock.calls[0][0]));
        expect(url.search).toBe('');
        expect(url.pathname).toMatch(/^\/[A-Za-z0-9]{7}$/);
        const nonce = 'fresh-challenge';
        openPreview('2');
        expect(open).toHaveBeenCalledTimes(1);
        ready(nonce, popup, 'https://attacker.example');
        ready(nonce, window);
        expect(postMessage).not.toHaveBeenCalled();
        ready(nonce, popup);
        const session = (
            postMessage.mock.lastCall?.[0] as unknown as { session: string }
        ).session;
        window.dispatchEvent(
            new MessageEvent('message', {
                origin,
                source: popup,
                data: { version: 1, type: 'connected', session, nonce },
            }),
        );
        expect(postMessage).toHaveBeenLastCalledWith(
            {
                version: 1,
                session,
                nonce,
                type: 'open-point',
                point: '2',
                preferences: { satellite: false, locale: 'en-US' },
            },
            origin,
        );
    });

    it('reuses a ready window when another point is opened', async () => {
        const { openPreview } = await import('./preview');
        openPreview('1');
        const nonce = 'fresh-challenge';
        ready(nonce, popup);
        const session = (
            postMessage.mock.lastCall?.[0] as unknown as { session: string }
        ).session;
        window.dispatchEvent(
            new MessageEvent('message', {
                origin,
                source: popup,
                data: { version: 1, type: 'connected', session, nonce },
            }),
        );
        postMessage.mockClear();
        openPreview('2');
        expect(open).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledExactlyOnceWith(
            {
                version: 1,
                session,
                nonce,
                type: 'open-point',
                point: '2',
                preferences: { satellite: false, locale: 'en-US' },
            },
            origin,
        );
    });

    it('keeps a normal-link fallback when a popup is blocked', async () => {
        open.mockReturnValue(null);
        const { openPreview } = await import('./preview');
        expect(openPreview('3')).toBe(false);
    });
});
