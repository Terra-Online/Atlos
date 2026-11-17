import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCoinLoop } from './moving-coin.ts';

const source = {
    buildGuid: 'build',
    contentHash: 'content',
    path: 'level.json',
};
const placement = [8, 0, 0];

function input() {
    return {
        model: 'source-coin-spline-v1',
        activation: 'loaded-entity-tick',
        source,
        splineId: 3,
        placedPosition: placement,
        startPosition: [0, 0, 0],
        repeatFrom: 0,
        camouflaged: false,
        timeLimited: false,
        segments: [
            {
                curve: [
                    [0, 0, 0],
                    [1, 0, 0],
                    [1, 0, 0],
                    [0, 0, 0],
                ],
                speed: 2,
                waitSeconds: 0,
                requiresNearby: false,
                smoothSpeed: false,
            },
        ],
    };
}

test('binds a moving coin by its placed transform while keeping its distinct spline start', () => {
    const loop = readCoinLoop(input(), source, placement);
    assert.deepEqual(loop?.startPosition, [0, 0, 0]);
    assert.equal(readCoinLoop(input(), source, [0, 0, 0]), null);
    assert.equal(
        readCoinLoop(input(), { ...source, contentHash: 'other' }, placement),
        null,
    );
});

test('rejects gates and open trajectories that cannot support a stationary wait', () => {
    const opened = input();
    opened.segments[0].curve[3] = [2, 0, 0];
    assert.equal(readCoinLoop(opened, source, placement), null);
    const gated = input();
    gated.segments[0].requiresNearby = true;
    assert.equal(readCoinLoop(gated, source, placement), null);
    assert.equal(
        readCoinLoop(
            { ...input(), activation: 'unresolved' },
            source,
            placement,
        ),
        null,
    );
});
