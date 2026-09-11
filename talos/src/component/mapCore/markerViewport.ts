import L from 'leaflet';
import { canvasSurface, existingCanvasSurface } from './canvasMarkerSurface';

// Joint implementation: keep identical to Atlos/mapCore/markerViewport.ts.
// Leaflet owns logical membership and semantic nodes; the instance scene paints all points.
export class ViewportMarker extends L.Marker {
  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } { return {}; }
  override onAdd(map: L.Map): this {
    this.options.autoPanOnFocus = false;
    (this as unknown as { _zoomAnimated: boolean })._zoomAnimated = false;
    canvasSurface(map);
    try { return super.onAdd(map); }
    catch (error) { existingCanvasSurface(map)?.remove(this); throw error; }
  }
  override onRemove(map: L.Map): this {
    existingCanvasSurface(map)?.remove(this);
    return super.onRemove(map);
  }
  update(): this {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map && this.getElement()) canvasSurface(map).place(this);
    return this;
  }
  _setPos(point: L.Point): void {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map) canvasSurface(map).place(this, point);
  }
}
