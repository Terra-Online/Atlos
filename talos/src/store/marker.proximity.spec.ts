import { describe, expect, it, vi } from 'vitest';
import { useMarkerStore } from './marker';

describe('temporary proximity selection', () => {
    it('notifies and persists once per changed batch, never for unchanged position hits', () => {
        useMarkerStore.setState({ temporarySelectedPoints: [], selectedPoints: ['saved'] });
        const listener = vi.fn();
        const stop = useMarkerStore.subscribe(listener);
        const storage = vi.spyOn(localStorage, 'setItem');
        try {
            const state = useMarkerStore.getState();
            state.setTemporarySelectedBatch(['a', 'b', 'a']);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(storage).toHaveBeenCalledTimes(1);
            state.setTemporarySelectedBatch(['a', 'b']);
            state.setTemporarySelected('a', true);
            state.clearTemporarySelected(['missing']);
            expect(listener).toHaveBeenCalledTimes(1);
            expect(storage).toHaveBeenCalledTimes(1);
            state.clearTemporarySelected(['a', 'b']);
            expect(listener).toHaveBeenCalledTimes(2);
            expect(useMarkerStore.getState().selectedPoints).toEqual(['saved']);
        } finally { stop(); storage.mockRestore(); }
    });
});
