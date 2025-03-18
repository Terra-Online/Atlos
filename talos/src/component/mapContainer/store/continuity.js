// states store for map view states(continuously use)
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useContinuity = create(
  persist(
    (set, get) => ({
      // declare viewStates
      viewStates: {},

      saveViewState: (region, map) => {
        if (!map) return;

        const center = map.getCenter();
        const zoom = map.getZoom();

        set(state => ({
          viewStates: {
            ...state.viewStates,
            [region]: { lat: center.lat, lng: center.lng, zoom }
          }
        }));
      },

      getViewState: (region) => {
        return get().viewStates[region] || null;
      },

      clearAllViewStates: () => {
        set({ viewStates: {} });
      }
    }),
    {
      name: 'map-view-states'
    }
  )
);

export default useContinuity;