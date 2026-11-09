import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/http/authRuntime', () => ({ getAuthBase: () => 'https://benchmark.invalid', getAuthHeaders: () => ({}) }));
vi.mock('@/services/http/request', () => ({ requestJson: vi.fn() }));
import { subscribeNotificationLive } from './client';

class Socket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    static instances: Socket[] = [];
    readyState = 0;
    send = vi.fn();
    close = vi.fn();
    constructor(_url: string) { super(); Socket.instances.push(this); }
    open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
    message(data: string) { this.dispatchEvent(new MessageEvent('message', { data })); }
}

describe('notification heartbeat compatibility', () => {
    let stop: () => void;
    beforeEach(() => {
        vi.useFakeTimers(); Socket.instances = [];
        vi.stubGlobal('WebSocket', Socket);
        stop = subscribeNotificationLive({ onUpdate: vi.fn() });
        Socket.instances[0].open();
    });
    afterEach(() => { stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('uses platform echo for healthy connections without changing the interval', () => {
        const socket = Socket.instances[0];
        vi.advanceTimersByTime(49_999); expect(socket.send).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1); expect(socket.send).toHaveBeenLastCalledWith('OEMping1');
        socket.message('OEMping1');
        vi.advanceTimersByTime(50_000); expect(socket.send).toHaveBeenLastCalledWith('OEMping1');
        socket.message('OEMping1');
        vi.advanceTimersByTime(15_000); expect(socket.close).not.toHaveBeenCalled();
    });

    it('ignores a late static echo after timeout and retains the two-miss close policy', () => {
        const socket = Socket.instances[0];
        vi.advanceTimersByTime(65_000);
        expect(socket.close).not.toHaveBeenCalled();
        vi.advanceTimersByTime(35_000);
        const token = socket.send.mock.calls.at(-1)![0] as string;
        expect(token).toMatch(/^[A-Za-z0-9]{8}$/); expect(token).not.toBe('OEMping1');
        socket.message('OEMping1');
        vi.advanceTimersByTime(15_000);
        expect(socket.close).toHaveBeenCalledWith(4000, 'notification heartbeat timeout');
    });

    it('accepts a nonce acknowledgement after recovery and stays in nonce mode', () => {
        const socket = Socket.instances[0];
        vi.advanceTimersByTime(100_000);
        socket.message(socket.send.mock.calls.at(-1)![0] as string);
        vi.advanceTimersByTime(50_000);
        const token = socket.send.mock.calls.at(-1)![0] as string;
        expect(token).not.toBe('OEMping1'); socket.message(token);
        vi.advanceTimersByTime(15_000); expect(socket.close).not.toHaveBeenCalled();
    });
});
