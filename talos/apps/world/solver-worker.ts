import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { physicalTask } from './physical-task.ts';
import { routeWriter } from '../../.cache/noclip/packages/extractor/src/write-route.ts';
const { preparePhysicalRoute } = (await import(
    pathToFileURL(
        resolve(
            process.argv[2],
            'packages/extractor/src/game/physical-input.ts',
        ),
    ).href
)) as typeof import('../../.cache/noclip/packages/extractor/src/game/physical-input.ts');
import { createRouteCache } from '../../.cache/noclip/packages/extractor/src/route-cache.ts';

const cache = createRouteCache();
let running = false;
const send = (value: object) => {
    if (process.connected) process.send?.(value);
};
process.on('message', (value: unknown) => {
    if (
        !value ||
        typeof value !== 'object' ||
        !('id' in value) ||
        typeof value.id !== 'string'
    )
        return;
    const id = value.id;
    if (running) {
        send({ type: 'error', id, error: 'route worker is already running' });
        return;
    }
    if (!('files' in value)) {
        send({ type: 'error', id, error: 'invalid route worker request' });
        return;
    }
    const files = value.files;
    running = true;
    void (async () => {
        const task = physicalTask(files);
        const write = routeWriter(
            task.output,
            Object.values(task.resources).filter(
                (v): v is string => typeof v === 'string',
            ),
        );
        const progress = (progress: { phase: string }) =>
            send({
                type: 'progress',
                id,
                progress: { ...progress, memory: process.memoryUsage() },
            });
        const prepared = await preparePhysicalRoute(
            task.resources,
            task.request,
            { cache, progress },
        );
        await prepared.solve({
            work: task.work,
            onProgress: progress,
            onResult: write,
        });
    })()
        .then(() => send({ type: 'done', id, memory: process.memoryUsage() }))
        .catch((error: unknown) => {
            cache.clear();
            send({
                type: 'error',
                id,
                error: error instanceof Error ? error.message : String(error),
            });
        })
        .finally(() => {
            running = false;
        });
});
process.on('disconnect', () => {
    cache.clear();
    process.exit(0);
});
send({ type: 'ready', version: 1 });
