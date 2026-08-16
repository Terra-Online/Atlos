import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useUiPrefsStore } from './uiPrefs';
import { createConditionalStorage } from '@/platform/storage';

interface IUserRecordStore {
    activePoints: string[];
    activeArchives: string[];
    updatedAt: number;
}

export const useUserRecordStore = create<IUserRecordStore>()(
    persist<IUserRecordStore, [], [], Partial<IUserRecordStore>>(
        () => ({
            activePoints: [],
            activeArchives: [],
            updatedAt: Date.now(),
        }),
        {
            name: 'points-storage',
            storage: createJSONStorage(() => createConditionalStorage(
                localStorage,
                () => useUiPrefsStore.getState().prefsMarkerProgressEnabled,
            )),
            partialize: (state) => ({
                activePoints: state.activePoints,
                activeArchives: state.activeArchives,
                updatedAt: state.updatedAt,
            }),
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<IUserRecordStore>;
                // Always restore persisted progress when it exists,
                // regardless of the current preference toggle. The preference
                // only controls whether *new* writes go to localStorage (via
                // createConditionalStorage).  We must never discard data from
                // localStorage during hydration — that would wipe the user's
                // progress silently if they toggle the setting off and on.
                if (Array.isArray(persisted.activePoints) || Array.isArray(persisted.activeArchives)) {
                    return {
                        ...currentState,
                        activePoints: Array.isArray(persisted.activePoints)
                            ? persisted.activePoints
                            : currentState.activePoints,
                        activeArchives: Array.isArray(persisted.activeArchives)
                            ? persisted.activeArchives
                            : currentState.activeArchives,
                        updatedAt: persisted.updatedAt ?? currentState.updatedAt,
                    };
                }
                return currentState;
            },
        },
    ),
);

// Auto-restore when preference is enabled
useUiPrefsStore.subscribe((state, prevState) => {
    if (state.prefsMarkerProgressEnabled && !prevState.prefsMarkerProgressEnabled) {
        void Promise.resolve(useUserRecordStore.persist.rehydrate()).then(async () => {
            const { useHistoryStore } = await import('@/store/history');
            useHistoryStore.getState().clear();
        });
    }
});

export const useUserRecord = () => useUserRecordStore((state) => state.activePoints);

// Non-hook accessors for non-React modules (e.g., Leaflet renderer)
// Returns empty array if preference is disabled
export const getActivePoints = () => {
    if (!useUiPrefsStore.getState().prefsMarkerProgressEnabled) return [];
    return useUserRecordStore.getState().activePoints;
};
