import { afterEach, expect, it, vi } from 'vitest';
import { connectWorld } from './bridge';

afterEach(() => vi.unstubAllGlobals());
it('binds only the opener with an allowed origin and fresh challenge, then checks every command', () => {
    const postMessage =
        vi.fn<
            (message: { nonce: string; type: string }, origin: string) => void
        >();
    const opener = { postMessage } as unknown as Window;
    vi.stubGlobal('opener', opener);
    const select = vi.fn();
    const preferences = vi.fn();
    const bridge = connectWorld(select, preferences);
    const nonce = postMessage.mock.calls[0][0].nonce;
    const message = (
        data: object,
        origin = 'https://opendfieldmap.org',
        source = opener,
    ) =>
        window.dispatchEvent(
            new MessageEvent('message', {
                origin,
                source,
                data: { version: 1, session: 'tab-session', nonce, ...data },
            }),
        );
    message({ type: 'connect' }, 'https://evil.example');
    message({ type: 'connect' }, 'https://opendfieldmap.org', window);
    message({ type: 'connect', nonce: 'stale' });
    message({ type: 'open-point', point: 'too-early' });
    expect(select).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
    message({
        type: 'connect',
        preferences: { satellite: true, locale: 'zh-CN' },
    });
    expect(preferences).toHaveBeenCalledExactlyOnceWith({
        satellite: true,
        locale: 'zh-CN',
    });
    expect(postMessage.mock.lastCall?.[0].type).toBe('connected');
    message({ type: 'open-point', point: 'wrong-session', session: 'other' });
    message({ type: 'open-point', point: 'wrong-nonce', nonce: 'old' });
    message({ type: 'open-point', point: 'target' });
    expect(select).toHaveBeenCalledExactlyOnceWith('target');
    bridge.close();
    message({ type: 'open-point', point: 'after-close' });
    expect(select).toHaveBeenCalledTimes(1);
});
it('works independently when a shared link has no opener', () => {
    vi.stubGlobal('opener', null);
    const bridge = connectWorld(vi.fn(), vi.fn());
    expect(() => bridge.send('state')).not.toThrow();
    bridge.close();
});
