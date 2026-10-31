import { describe, expect, it } from 'vitest';
import {
    acknowledgeRetainedPointIds,
    areLocalPointsSynced,
    arePointSetsEqual,
    buildPointPatch,
    getUnacknowledgedRetainedPointIds,
    splitByKnownPointIds,
} from './pointState';

describe('progress point acknowledgement', () => {
    it('ignores order, duplicates, and whitespace consistently with server normalization', () => {
        expect(arePointSetsEqual([' p1 ', 'p2', 'p1', ''], ['p2', 'p1'])).toBe(true);
        expect(buildPointPatch([' p1 '], ['p1', 'p1'])).toEqual({ setPointIds: [], clearPointIds: [] });
        expect(splitByKnownPointIds([' p1 ', 'legacy', 'legacy'], new Set(['p1'])))
            .toEqual({ known: ['p1'], unknown: ['legacy'] });
    });

    it('does not mistake confirmed legacy backups for unsynced visible progress', () => {
        const baseline = { pointIds: ['p1'], retainedPointIds: ['legacy', 'cloud-only-backup'] };
        expect(areLocalPointsSynced(['legacy', 'p1'], baseline)).toBe(true);
        expect(areLocalPointsSynced(['p1'], baseline)).toBe(true);
        expect(areLocalPointsSynced(['p1', 'unacknowledged'], baseline)).toBe(false);
        expect(areLocalPointsSynced(['legacy'], baseline)).toBe(false);
        expect(areLocalPointsSynced(['p1', 'p2', 'legacy'], baseline)).toBe(false);
        expect(areLocalPointsSynced([], null)).toBe(false);
    });

    it('never hides a visible point change behind a retained acknowledgement', () => {
        expect(areLocalPointsSynced([], { pointIds: ['p1'], retainedPointIds: ['p1'] })).toBe(false);
        expect(areLocalPointsSynced(['p1'], { pointIds: ['p1'], retainedPointIds: ['p1'] })).toBe(true);
    });

    it('only retries retained IDs not yet acknowledged by the server', () => {
        expect(getUnacknowledgedRetainedPointIds(['old', ' new ', 'new'], ['old'])).toEqual(['new']);
        expect(getUnacknowledgedRetainedPointIds(['old'], undefined)).toEqual(['old']);
    });

    it('supports older sync responses without acknowledging changes made after the request', () => {
        expect(acknowledgeRetainedPointIds(undefined, ['old'], ['sent'])).toEqual(['old', 'sent']);
        expect(acknowledgeRetainedPointIds(['authoritative'], ['old'], ['sent'])).toEqual(['authoritative']);
        expect(acknowledgeRetainedPointIds([], ['old'], ['sent'])).toEqual([]);
    });
});
