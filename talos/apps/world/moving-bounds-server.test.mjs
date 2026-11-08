import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { routeServer } from './dev-route-server.ts';

test('serves bounded, build-matched endpoint diagrams and refreshes a rewritten catalog', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'world-moving-bounds-'));
    const middleware = new Map();
    const plugin = routeServer(directory);
    plugin.configureServer({
        middlewares: {
            use(path, handle) {
                middleware.set(path, handle);
            },
        },
        httpServer: new EventEmitter(),
    });
    const source = { buildGuid: 'build', contentHash: 'hash' };
    const bounds = { min: [0, 0, 0], max: [2, 1, 2] };
    const device = {
        id: 'leaf',
        family: 'platform',
        level: 'map02_lv010',
        endpoints: {
            initial: bounds,
            terminal: { min: [10, 4, 0], max: [12, 5, 2] },
        },
        surfaces: [],
    };
    const catalog = {
        version: 1,
        scene: 'map02',
        source,
        movingSupports: [
            device,
            {
                ...device,
                id: 'far',
                endpoints: {
                    initial: { min: [1000, 0, 0], max: [1002, 1, 2] },
                    terminal: { min: [1010, 0, 0], max: [1012, 1, 2] },
                },
            },
        ],
    };
    const file = join(directory, 'map02-traversal-devices.json');
    const query = {
        scene: 'map02',
        level: 'map02_lv010',
        ...source,
        x: '1',
        y: '1',
        z: '1',
    };
    const request = (overrides = {}, method = 'GET') =>
        new Promise((resolve) => {
            middleware.get('/__routes/moving-bounds')(
                {
                    method,
                    url: '/?' + new URLSearchParams({ ...query, ...overrides }),
                },
                {
                    statusCode: 200,
                    setHeader() {},
                    end(body) {
                        resolve({
                            status: this.statusCode,
                            value: JSON.parse(body),
                        });
                    },
                },
            );
        });
    try {
        await writeFile(file, JSON.stringify(catalog));
        const result = await request();
        assert.equal(result.status, 200);
        assert.deepEqual(
            result.value.devices.map((device) => device.id),
            ['leaf'],
        );
        assert.equal('surfaces' in result.value.devices[0], false);
        assert.equal((await request({ contentHash: 'other' })).status, 409);
        assert.equal((await request({ scene: '../outside' })).status, 400);
        assert.equal((await request({ x: 'NaN' })).status, 400);
        assert.equal((await request({}, 'POST')).status, 405);
        catalog.movingSupports[0].id = 'rewritten-leaf';
        await writeFile(file, JSON.stringify(catalog));
        assert.deepEqual(
            (await request()).value.devices.map((device) => device.id),
            ['rewritten-leaf'],
        );
    } finally {
        await plugin.closeBundle();
        await rm(directory, { recursive: true, force: true });
    }
});
