// states store for map view states(continuously use)
import { IMapView } from '@/component/mapCore/type';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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

        set(state => ({
          viewStates: {
            ...state.viewStates,
            [region]: { lat: center.lat, lng: center.lng, zoom }
          }
        }));
      },

      getViewState: (region) => {
        return get().viewStates[region] || undefined;
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

export default useViewState;