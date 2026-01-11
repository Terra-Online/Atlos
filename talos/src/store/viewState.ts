// states store for map view states(continuously use)
import { IMapView } from '@/component/mapCore/type';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import L from 'leaflet';
import { useUiPrefsStore } from './uiPrefs';
import { createConditionalStorage } from '@/utils/storage';

interface IViewStateStore {
    viewStates: Record<string, IMapView>;
    saveViewState: (region: string, map: L.Map) => void;
    getViewState: (region: string) => IMapView | undefined;
    clearAllViewStates: () => void;
}

const useViewState = create<IViewStateStore>()(
    persist(
        (set, get) => ({
            // declare viewStates
            viewStates: {},

            saveViewState: (region, map) => {
                if (!map) return;

                const center = map.getCenter();
                const zoom = map.getZoom();

                set((state) => ({
                    viewStates: {
                        ...state.viewStates,
                        [region]: { lat: center.lat, lng: center.lng, zoom },
                    },
                }));
            },

            getViewState: (region) => {
                return get().viewStates[region] || undefined;
            },

            clearAllViewStates: () => {
                set({ viewStates: {} });
            },
        }),
        {
            name: 'map-view-states',
            storage: createJSONStorage(() => createConditionalStorage(
                localStorage,
                () => useUiPrefsStore.getState().prefsViewStateEnabled,
            )),
            merge: (persistedState, currentState) => {
                const persisted = persistedState as Partial<IViewStateStore>;
                // Only restore if preference is enabled
                if (useUiPrefsStore.getState().prefsViewStateEnabled && persisted.viewStates) {
                    return { ...currentState, viewStates: persisted.viewStates };
                }
                return currentState;
            },
        },
    ),
);

// Auto-restore when preference is enabled
useUiPrefsStore.subscribe((state, prevState) => {
    if (state.prefsViewStateEnabled && !prevState.prefsViewStateEnabled) {
        void useViewState.persist.rehydrate();
    }
});

export default useViewState;
