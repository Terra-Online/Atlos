import { readFile, stat } from 'node:fs/promises';
import { createCandidatePlanner, type Vec3 } from '@opendfieldmap/ganglia';

type Input = {
    navigation: string;
    source: { buildGuid: string; contentHash: string };
    arrivals: Parameters<ReturnType<typeof createCandidatePlanner>['plan']>[0];
    target: Vec3;
    excludedEdges?: (number | string)[];
};
type Data = Parameters<typeof createCandidatePlanner>[0] & { source: Input['source'] };
let prepared: { key: string; data: Data; planner: ReturnType<typeof createCandidatePlanner> } | undefined;

// One scene stays prepared across queries, outside the server's event loop.
async function plan(input: Input) {
    const started=performance.now();
    let readMs=0,prepareMs=0;
    const info = await stat(input.navigation);
    const key = JSON.stringify([input.navigation, info.mtimeMs, info.size]);
    if (prepared?.key !== key) {
        prepared = undefined;
        const reading=performance.now();
        const data = JSON.parse(await readFile(input.navigation, 'utf8'));
        readMs=performance.now()-reading;
        if (data.source.buildGuid !== input.source.buildGuid || data.source.contentHash !== input.source.contentHash)
            throw new Error('Navigation source mismatch');
        const preparing=performance.now();
        prepared = { key, data, planner: createCandidatePlanner(data) };
        prepareMs=performance.now()-preparing;
    }
    const { data, planner } = prepared;
    if (data.source.buildGuid !== input.source.buildGuid || data.source.contentHash !== input.source.contentHash)
        throw new Error('Navigation source mismatch');
    const searching=performance.now();
    const result = planner.plan(input.arrivals, input.target, { excludedEdges: input.excludedEdges });
    return {...result,diagnostics:{readMs,prepareMs,searchMs:performance.now()-searching,
        totalMs:performance.now()-started,surfaces:data.surfaces.length,arrivals:input.arrivals.length,memory:process.memoryUsage()}};
}

if (process.send) {
    let pending = Promise.resolve();
    process.on('message', (message: { id: string; input: Input }) => {
        pending = pending.then(async () => {
            try { process.send?.({ id: message.id, result: await plan(message.input) }); }
            catch (error) { process.send?.({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
        });
    });
    process.on('disconnect', () => process.exit());
} else {
    const input: Input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(await plan(input)));
}
