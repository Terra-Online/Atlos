import type L from 'leaflet';
import { CanvasClusterGroup, type CanvasClusterOptions } from './clusterGroup';

export function createCanvasAwareClusterGroup(_map: L.Map, options: CanvasClusterOptions): CanvasClusterGroup {
  return new CanvasClusterGroup(options);
}
