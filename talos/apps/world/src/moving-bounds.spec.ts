import { describe, expect, it } from 'vitest';
import { boxSegments, supportBoxes, type SupportBox } from './moving-bounds';

const contact: SupportBox = {
    device: 'box',
    family: 'conveyor',
    role: 'use',
    min: [4, 1, -1],
    max: [6, 3, 1],
};

describe('route contact boxes', () => {
    it('accepts an actual use pose independently of authored path endpoints', () => {
        expect(supportBoxes([contact])).toEqual([contact]);
        const edges = boxSegments(contact);
        expect(edges).toHaveLength(12);
        expect(
            new Set(edges.map((edge) => JSON.stringify(edge.points))).size,
        ).toBe(12);
        expect(
            edges.every((edge) =>
                edge.points.every((point) =>
                    point.every(
                        (value, axis) =>
                            value === contact.min[axis] ||
                            value === contact.max[axis],
                    ),
                ),
            ),
        ).toBe(true);
    });
    it('leaves legacy candidates without annotations unchanged', () => {
        expect(supportBoxes(undefined)).toEqual([]);
        expect(
            supportBoxes({
                endpoints: { initial: contact, terminal: contact },
            }),
        ).toEqual([]);
    });
    it('ignores malformed optional diagrams', () => {
        expect(
            supportBoxes([
                null,
                { ...contact, role: 'path-start' },
                { ...contact, min: [Infinity, 1, -1] },
                { ...contact, max: [3, 3, 1] },
                contact,
            ]),
        ).toEqual([contact]);
    });
});
