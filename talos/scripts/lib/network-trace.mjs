/** CDP encoded lengths include response headers. Failed and unfinished reads
 * retain partial observations; absent protocol measurements remain unknown. */
export function createNetworkTrace(session) {
    const current = new Map(),
        rows = [];
    session.on('Network.requestWillBeSent', (event) => {
        const previous = current.get(event.requestId);
        if (previous && event.redirectResponse) {
            previous.complete = true;
            previous.transferBytes =
                event.redirectResponse.encodedDataLength ??
                previous.transferBytes;
            previous.observedTransferBytes =
                previous.transferBytes ?? previous.observedTransferBytes;
        }
        const row = {
            url: event.request.url,
            bodyBytes: 0,
            transferBytes: null,
            observedTransferBytes: 0,
            cache: false,
            failed: false,
            complete: false,
        };
        current.set(event.requestId, row);
        rows.push(row);
    });
    session.on('Network.responseReceived', (event) => {
        const row = current.get(event.requestId);
        if (!row) return;
        row.status = event.response.status;
        row.mime = event.response.mimeType;
        row.cache ||= !!event.response.fromDiskCache;
        row.transferBytes = event.response.encodedDataLength ?? null;
        row.observedTransferBytes = row.transferBytes ?? 0;
    });
    session.on('Network.dataReceived', (event) => {
        const row = current.get(event.requestId);
        if (!row) return;
        row.bodyBytes += event.dataLength;
        row.observedTransferBytes += event.encodedDataLength ?? 0;
        row.transferBytes =
            row.transferBytes === null || event.encodedDataLength === undefined
                ? null
                : row.transferBytes + event.encodedDataLength;
    });
    session.on('Network.requestServedFromCache', (event) => {
        const row = current.get(event.requestId);
        if (row) row.cache = true;
    });
    session.on('Network.loadingFinished', (event) => {
        const row = current.get(event.requestId);
        if (!row) return;
        row.complete = true;
        row.transferBytes = event.encodedDataLength ?? null;
        row.observedTransferBytes =
            row.transferBytes ?? row.observedTransferBytes;
    });
    session.on('Network.loadingFailed', (event) => {
        const row = current.get(event.requestId);
        if (!row) return;
        row.failed = true;
        row.error = event.errorText;
    });
    return { snapshot: () => rows.map((row) => ({ ...row })) };
}
