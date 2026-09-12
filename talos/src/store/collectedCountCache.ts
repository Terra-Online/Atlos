interface CountedPoint { id: string; type: string }
const emptyCounts: ReadonlyMap<string, number> = new Map();

/** Collection arrays are immutable store snapshots; each scope is scanned once per data version. */
export class CollectedCountCache {
    private snapshots = new WeakMap<readonly string[], { version: number; ids: Set<string>; scopes: Map<string, ReadonlyMap<string, number>> }>();
    get(ids: readonly string[], version: number, scope: string, load: () => readonly CountedPoint[]): ReadonlyMap<string, number> {
        if (!ids.length) return emptyCounts;
        let snapshot = this.snapshots.get(ids);
        if (!snapshot) { snapshot = { version, ids: new Set(ids), scopes: new Map() }; this.snapshots.set(ids, snapshot); }
        if (snapshot.version !== version) { snapshot.version = version; snapshot.scopes.clear(); }
        let counts = snapshot.scopes.get(scope);
        if (!counts) {
            const result = new Map<string, number>();
            for (const point of load()) if (snapshot.ids.has(point.id)) result.set(point.type, (result.get(point.type) ?? 0) + 1);
            counts = result; snapshot.scopes.set(scope, result);
        }
        return counts;
    }
}
