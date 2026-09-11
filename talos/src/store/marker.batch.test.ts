import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarkerStore } from './marker';

beforeEach(() => useMarkerStore.setState({ selectedPoints: [], filter: [] }));
afterEach(() => vi.restoreAllMocks());
describe('batch point selection', () => {
  it('notifies and persists one snapshot for a large selection', () => {
    const changed = vi.fn(), persisted = vi.spyOn(localStorage, 'setItem');
    const unsubscribe = useMarkerStore.subscribe(changed);
    const ids = Array.from({ length: 10000 }, (_, i) => `point-${i}`);
    useMarkerStore.getState().setSelectedBatch(ids, true);
    expect(useMarkerStore.getState().selectedPoints).toEqual(ids);
    expect(changed).toHaveBeenCalledTimes(1); expect(persisted).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('preserves unrelated selections and skips unchanged updates', () => {
    useMarkerStore.getState().setSelectedBatch(['host', 'a', 'b', 'a'], true);
    const previous = useMarkerStore.getState().selectedPoints;
    useMarkerStore.getState().setSelectedBatch(['a', 'b'], true);
    expect(useMarkerStore.getState().selectedPoints).toBe(previous);
    useMarkerStore.getState().setSelectedBatch(new Set(['a', 'b']), false);
    expect(useMarkerStore.getState().selectedPoints).toEqual(['host']);
  });
});
