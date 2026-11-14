// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createTransport } from './transport';

describe('client transfer accounting', () => {
    it('counts the complete response when a server ignores a range request', async () => {
        const transport = createTransport(() =>
            Promise.resolve(new Response('abcdefghij')),
        );
        transport.operation('open');
        const response = await transport.fetch(
            'scene',
            'https://assets.test/render.czar',
            { headers: { range: 'bytes=2-4' } },
        );
        expect(await response.text()).toBe('abcdefghij');
        expect(transport.snapshot().requests[0]).toMatchObject({
            operation: 'open',
            requestedBytes: 3,
            responseBytes: 10,
            rangeFallback: true,
            status: 200,
            outcome: 'complete',
        });
    });
});

it('retains separate 206 reads and leaves unavailable network sizes unknown', async () => {
    const transport = createTransport(() =>
        Promise.resolve(
            new Response('cde', {
                status: 206,
                headers: { 'content-range': 'bytes 2-4/10' },
            }),
        ),
    );
    for (let i = 0; i < 2; i++) {
        const response = await transport.fetch(
            'scene',
            'https://assets.test/shard.czar',
            { headers: { range: 'bytes=2-4' } },
        );
        await response.arrayBuffer();
    }
    const { requests } = transport.snapshot();
    expect(requests).toHaveLength(2);
    expect(
        requests.map((r) => [
            r.responseBytes,
            r.requestedBytes,
            r.rangeFallback,
            r.transferBytes,
        ]),
    ).toEqual([
        [3, 3, false, null],
        [3, 3, false, null],
    ]);
});

it('counts bytes received before a response consumer cancels', async () => {
    const transport = createTransport(() =>
        Promise.resolve(
            new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(Uint8Array.of(1, 2));
                    },
                }),
            ),
        ),
    );
    const response = await transport.fetch(
        'scene',
        'https://assets.test/slow.czar',
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(Uint8Array.of(1, 2));
    await reader.cancel();
    expect(transport.snapshot().requests[0]).toMatchObject({
        responseBytes: 2,
        outcome: 'cancelled',
    });
});

it('preserves a visible cache hit as zero transfer bytes', async () => {
    const transport = createTransport(() =>
        Promise.resolve(new Response('abc')),
    );
    const response = await transport.fetch(
        'scene',
        'https://assets.test/cached.czar',
    );
    await response.text();
    const row = transport.snapshot().requests[0];
    const entry = Object.assign(
        performance.mark(row.url, { startTime: row.started }),
        { transferSize: 0, encodedBodySize: 3, responseStart: 1 },
    );
    const original = performance.getEntriesByType.bind(performance);
    performance.getEntriesByType = () => [entry];
    try {
        expect(transport.snapshot().requests[0]).toMatchObject({
            responseBytes: 3,
            transferBytes: 0,
            encodedBodyBytes: 3,
        });
    } finally {
        performance.getEntriesByType = original;
        performance.clearMarks(row.url);
    }
});
