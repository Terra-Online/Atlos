import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface IUserRecordStore {
    activePoints: string[];
    addPoint: (id: string) => void;
    deletePoint: (id: string) => void;
    clearPoints: () => void;
}

export const useUserRecordStore = create<IUserRecordStore>()(
    persist(
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
            partialize: (state) => ({
                activePoints: state.activePoints,
            }),
        },
    ),
);

export const useUserRecord = () =>
    useUserRecordStore((state) => state.activePoints);
export const useAddPoint = () => useUserRecordStore((state) => state.addPoint);
export const useDeletePoint = () =>
    useUserRecordStore((state) => state.deletePoint);

// Non-hook accessors for non-React modules (e.g., Leaflet renderer)
export const getActivePoints = () => useUserRecordStore.getState().activePoints;
