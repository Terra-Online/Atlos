import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useUserRecordStore = create(persist((set, get) => ({
    activePoints: [],
    addPoint: (id) => {
        if (get().activePoints.includes(id)) {
            return
        }
        else {
            set((state) => ({
                activePoints: [...state.activePoints, id]
            }));
        }
    },
    deletePoint: (id) => {
        if (!get().activePoints.includes(id)) {
            return
        }
        else {
            set((state) => ({
                activePoints: state.activePoints.filter(point => point !== id)
            }));
        }
    },
    clearPoints: () => {
        set({ activePoints: [] });
    },
}), {
    name: 'points-storage',
    ppartialize: (state) => ({
        activePoints: state.activePoints
    })
}))

export const useUserRecord = () => useUserRecordStore((state) => state.activePoints)
export const useAddPoint = () => useUserRecordStore((state) => state.addPoint)