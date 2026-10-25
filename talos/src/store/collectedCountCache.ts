import { deduplicateMarkersByPositionAndType } from '@/data/marker/deduplication.js';
import type { IMarkerData } from '@/data/marker';

type CountedPoint = Pick<IMarkerData, 'id' | 'type' | 'x' | 'y' | 'z'>;
const emptyCounts: ReadonlyMap<string, number> = new Map();

/** Collection arrays are immutable store snapshots; each scope is scanned once per data version. */
export class CollectedCountCache {
    private snapshots = new WeakMap<readonly string[], { version: number; ids: Set<string>; scopes: Map<string, ReadonlyMap<string, number>> }>();
    private indexed = new WeakMap<readonly string[], { types: ReadonlyMap<string, string>; counts: ReadonlyMap<string, number> }>();

    /** The lookup already chose representatives, so only collected IDs need scanning. */
    getIndexed(ids: readonly string[], types: ReadonlyMap<string, string>): ReadonlyMap<string, number> {
        if (!ids.length) return emptyCounts;
        const cached = this.indexed.get(ids);
        if (cached?.types === types) return cached.counts;
        const counts = new Map<string, number>();
        for (const id of new Set(ids)) {
            const type = types.get(id);
            if (type) counts.set(type, (counts.get(type) ?? 0) + 1);
        }
        this.indexed.set(ids, { types, counts });
        return counts;
    }

    get(ids: readonly string[], version: number, scope: string, load: () => readonly CountedPoint[]): ReadonlyMap<string, number> {
        if (!ids.length) return emptyCounts;
        let snapshot = this.snapshots.get(ids);
        if (!snapshot) { snapshot = { version, ids: new Set(ids), scopes: new Map() }; this.snapshots.set(ids, snapshot); }
        if (snapshot.version !== version) { snapshot.version = version; snapshot.scopes.clear(); }
        let counts = snapshot.scopes.get(scope);
        if (!counts) {
            const result = new Map<string, number>();
            for (const point of deduplicateMarkersByPositionAndType(load())) {
                if (point.type && snapshot.ids.has(point.id)) result.set(point.type, (result.get(point.type) ?? 0) + 1);
            }
            counts = result; snapshot.scopes.set(scope, result);
        }
        return counts;
    }
}
