import L from 'leaflet';
import type { MarkerArt } from '@/services/map/core/canvas/canvasMarkerPaint';
import type { MarkerState } from '@/services/map/core/canvas/canvasMarkerMotion';

/** Leaflet retains icon anchors; the scene consumes artwork without creating an icon element. */
export class SceneIcon extends L.DivIcon {
  constructor(readonly art: MarkerArt, readonly label: string, options: L.DivIconOptions = {}) {
    super({ iconSize: art.noFrame ? [50, 50] : [32, 32],
      iconAnchor: art.noFrame ? [25, 25] : [16, 32], popupAnchor: [0, 0], tooltipAnchor: [0, 0], ...options, html: false });
  }
}

export interface SceneState extends MarkerState {
  completed: boolean;
  opacity: number;
  tier: string;
}
const initial: Readonly<SceneState> = Object.freeze({ selected: false, checked: false, offLayer: false,
  hover: false, focus: false, pulsing: false, appearing: false, disappearing: false,
  completed: false, opacity: 1, tier: '' });
const states = new WeakMap<L.Marker, Readonly<SceneState>>();

export const getMarkerState = (marker: L.Marker): Readonly<SceneState> => states.get(marker) ?? initial;

/** State remains valid while a cluster represents a point or filters detach it. */
export function setMarkerState(marker: L.Marker, patch: Partial<SceneState>): void {
  const previous = getMarkerState(marker);
  if ((Object.keys(patch) as (keyof SceneState)[]).every(key => patch[key] === previous[key])) return;
  states.set(marker, { ...previous, ...patch });
  marker.fire('visualchange');
}
