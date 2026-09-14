import { describe, expect, it } from 'vitest';
import { ProximityIndex } from './proximityIndex';

describe('game-space proximity lookup', () => {
    it('matches a full scan across negative cells, exact boundaries and heights', () => {
        const index = new ProximityIndex<number>();
        const points = Array.from({ length: 10000 }, (_, i) => ({
            x: (i * 37 % 503) - 251, y: (i % 23) - 11, z: (i * 97 % 509) - 254,
        }));
        points.push({ x: 20, y: 0, z: 0 }, { x: -20, y: 0, z: 0 }, { x: 0, y: 6, z: 0 });
        points.forEach((point, id) => index.add(id, point));
        for (const position of [{ x: 0, y: 0, z: 0 }, { x: -20.1, y: -3, z: -40 }, { x: 39.99, y: 5, z: 20 }]) {
            const expected = points.flatMap((p, i) => Math.abs(p.x - position.x) < 20
                && Math.abs(p.z - position.z) < 20 && Math.abs(p.y - position.y) < 6 ? [i] : []);
            expect(index.query(position).sort((a, b) => a - b)).toEqual(expected);
        }
    });
    it('ignores invalid coordinates and immediately indexes newly loaded points', () => {
        const index = new ProximityIndex<string>();
        index.add('invalid', { x: NaN, y: 0, z: 0 });
        expect(index.query({ x: Infinity, y: 0, z: 0 })).toEqual([]);
        index.add('new', { x: -0.1, y: 0, z: 0 });
        expect(index.query({ x: 0, y: 0, z: 0 })).toEqual(['new']);
    });
});
