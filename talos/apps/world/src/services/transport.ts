export type Channel = 'scene' | 'routing';
export interface Transfer {
    id: number;
    operation: string;
    channel: Channel;
    url: string;
    started: number;
    durationMs: number | null;
    requestedBytes: number | null;
    uploadBytes: number | null;
    responseBytes: number;
    transferBytes: number | null;
    encodedBodyBytes: number | null;
    status: number | null;
    content: { kind: string; bytes: number }[];
    category: string;
    serverCache: string | null;
    rangeFallback: boolean;
    outcome: 'pending' | 'complete' | 'cancelled' | 'failed';
}

/** Response bytes are decoded bytes observed at this seam. Network sizes come
 * from Resource Timing, whose cross-origin visibility requires server opt-in. */
export function createTransport(
    fetcher: typeof fetch = (...args) => fetch(...args),
) {
    let operation = 'background';
    let serial = 0;
    let discardedRequests = 0;
    const requests: Transfer[] = [];
    return {
        operation(name: string) {
            operation = name;
        },
        snapshot() {
            const timings =
                typeof performance.getEntriesByType === 'function'
                    ? performance
                          .getEntriesByType('resource')
                          .filter(
                              (entry): entry is PerformanceResourceTiming =>
                                  'transferSize' in entry,
                          )
                    : [];
            const used = new Set<PerformanceResourceTiming>();
            const rows = requests.map((row) => {
                const timing = timings.find(
                    (t) =>
                        !used.has(t) &&
                        t.name === row.url &&
                        t.startTime >= row.started - 1 &&
                        t.startTime <= row.started + 50,
                );
                if (timing) used.add(timing);
                const visible = timing && timing.responseStart > 0;
                return {
                    ...row,
                    transferBytes: visible ? timing.transferSize : null,
                    encodedBodyBytes: visible ? timing.encodedBodySize : null,
                };
            });
            return { requests: rows, discardedRequests };
        },
        async fetch(
            channel: Channel,
            input: string | URL,
            init: RequestInit = {},
            content: Transfer['content'] = [],
        ) {
            const url = new URL(
                input,
                typeof location === 'undefined' ? undefined : location.href,
            ).href;
            const range = /^bytes=(\d+)-(\d+)$/.exec(
                new Headers(init.headers).get('range') ?? '',
            );
            const row: Transfer = {
                id: ++serial,
                operation,
                channel,
                url,
                started: performance.now(),
                durationMs: null,
                requestedBytes: range
                    ? Number(range[2]) - Number(range[1]) + 1
                    : null,
                uploadBytes:
                    typeof init.body === 'string'
                        ? new TextEncoder().encode(init.body).byteLength
                        : init.body == null
                          ? 0
                          : null,
                responseBytes: 0,
                transferBytes: null,
                encodedBodyBytes: null,
                status: null,
                rangeFallback: false,
                serverCache: null,
                content,
                category:
                    channel === 'routing'
                        ? 'routing'
                        : url.endsWith('.json')
                          ? 'catalogue'
                          : url.endsWith('/core.czar')
                            ? 'scene-core'
                            : content.length
                              ? Array.from(
                                    new Set(content.map((c) => c.kind)),
                                ).join('+')
                              : 'other',
                outcome: 'pending',
            };
            if (requests.length === 10000) {
                requests.shift();
                discardedRequests++;
            }
            requests.push(row);
            const finish = (outcome: Transfer['outcome']) => {
                row.outcome = outcome;
                row.durationMs = performance.now() - row.started;
            };
            try {
                const response = await fetcher(url, init);
                row.status = response.status;
                row.serverCache = response.headers.get('x-route-cache');
                row.rangeFallback = !!range && response.status === 200;
                const reader = response.body?.getReader();
                if (!reader) {
                    finish('complete');
                    return response;
                }
                const body = new ReadableStream<Uint8Array>({
                    async pull(controller) {
                        try {
                            const part = await reader.read();
                            if (part.done) {
                                finish('complete');
                                controller.close();
                            } else {
                                row.responseBytes += part.value.byteLength;
                                controller.enqueue(part.value);
                            }
                        } catch (error) {
                            finish(
                                init.signal?.aborted ? 'cancelled' : 'failed',
                            );
                            controller.error(error);
                        }
                    },
                    async cancel(reason) {
                        finish('cancelled');
                        await reader.cancel(reason);
                    },
                });
                return new Response(body, {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                });
            } catch (error) {
                finish(init.signal?.aborted ? 'cancelled' : 'failed');
                throw error;
            }
        },
    };
}

export const transport = createTransport();
