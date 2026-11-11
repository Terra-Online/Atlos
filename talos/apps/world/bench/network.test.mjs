import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createNetworkTrace } from '../../../scripts/lib/network-trace.mjs';

test('cancelled response retains received headers and compressed body bytes', () => {
    const cdp = new EventEmitter();
    const trace = createNetworkTrace(cdp);
    cdp.emit('Network.requestWillBeSent', {
        requestId: 'one',
        request: { url: 'https://assets.test/scene.czar' },
    });
    cdp.emit('Network.responseReceived', {
        requestId: 'one',
        response: {
            status: 206,
            mimeType: 'application/octet-stream',
            encodedDataLength: 120,
        },
    });
    cdp.emit('Network.dataReceived', {
        requestId: 'one',
        dataLength: 1000,
        encodedDataLength: 300,
    });
    cdp.emit('Network.loadingFailed', {
        requestId: 'one',
        errorText: 'net::ERR_ABORTED',
        canceled: true,
    });
    assert.deepEqual(
        trace
            .snapshot()
            .map(({ transferBytes, bodyBytes, complete, failed }) => ({
                transferBytes,
                bodyBytes,
                complete,
                failed,
            })),
        [
            {
                transferBytes: 420,
                bodyBytes: 1000,
                complete: false,
                failed: true,
            },
        ],
    );
});
