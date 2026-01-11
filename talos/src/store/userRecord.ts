import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useUiPrefsStore } from './uiPrefs';
import { createConditionalStorage } from '@/utils/storage';

interface IUserRecordStore {
    activePoints: string[];
    addPoint: (id: string) => void;
    deletePoint: (id: string) => void;
    clearPoints: () => void;
}

export const useUserRecordStore = create<IUserRecordStore>()(
    persist<IUserRecordStore, [], [], Partial<IUserRecordStore>>(
        (set, get) => ({
            activePoints: [],
            addPoint: (id) => {
                if (get().activePoints.includes(id)) {
                    return;
                } else {
                    set((state) => ({
                        activePoints: [...state.activePoints, id],
                    }));
                }
            },
            deletePoint: (id) => {
                if (!get().activePoints.includes(id)) {
                    return;
                } else {
                    set((state) => ({
                        activePoints: state.activePoints.filter(
                            (point) => point !== id,
                        ),
                    }));
                }
            },
            clearPoints: () => {
                set({ activePoints: [] });
            },
        }),
        {
            name: 'points-storage',
            storage: createJSONStorage(() => createConditionalStorage(
                localStorage,
                () => useUiPrefsStore.getState().prefsMarkerProgressEnabled,
            )),
            partialize: (state) => ({
                activePoints: state.activePoints,
            }),
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<IUserRecordStore>;
                // Only restore if preference is enabled
                if (useUiPrefsStore.getState().prefsMarkerProgressEnabled && persisted.activePoints) {
                    return { ...currentState, activePoints: persisted.activePoints };
                }
                return currentState;
            },
        },
    ),
);

// Auto-restore when preference is enabled
useUiPrefsStore.subscribe((state, prevState) => {
    if (state.prefsMarkerProgressEnabled && !prevState.prefsMarkerProgressEnabled) {
        void useUserRecordStore.persist.rehydrate();
    }
});

export const useUserRecord = () => useUserRecordStore((state) => state.activePoints);
export const useAddPoint = () => useUserRecordStore((state) => state.addPoint);
export const useDeletePoint = () =>
    useUserRecordStore((state) => state.deletePoint);

// Non-hook accessors for non-React modules (e.g., Leaflet renderer)
// Returns empty array if preference is disabled
export const getActivePoints = () => {
    if (!useUiPrefsStore.getState().prefsMarkerProgressEnabled) return [];
    return useUserRecordStore.getState().activePoints;
};
