import L from 'leaflet';
import { canvasSurface, existingCanvasSurface } from '@/services/map/core/canvas/canvasMarkerSurface';
import { setMarkerState } from '@/services/map/core/canvas/markerModel';

/** Leaflet owns logical membership and overlays; the scene owns each point's pixels and input. */
export class ViewportMarker extends L.Marker {
  override getEvents(): { [name: string]: L.LeafletEventHandlerFn } { return {}; }
  override onAdd(map: L.Map): this {
    this.on('visualchange', this.visualChanged, this);
    // Re-admission replaces the old icon lifecycle: an earlier filter fade must
    // not survive while a cluster represents this logical member off-map.
    setMarkerState(this, { opacity: this.options.opacity ?? 1, disappearing: false });
    try { canvasSurface(map).place(this); }
    catch (error) { this.off('visualchange', this.visualChanged, this); existingCanvasSurface(map)?.remove(this); throw error; }
    return this;
  }
  override onRemove(map: L.Map): this {
    this.off('visualchange', this.visualChanged, this);
    existingCanvasSurface(map)?.remove(this);
    return this;
  }
  // Leaflet setIcon also refreshes popup anchors; its initialization must stay node-free.
  _initIcon(): void {}
  update(): this {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map) canvasSurface(map).place(this);
    return this;
  }
  override setOpacity(opacity: number): this {
    this.options.opacity = opacity; setMarkerState(this, { opacity }); return this;
  }
  _setPos(point: L.Point): void {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map) canvasSurface(map).place(this, point);
  }
  private visualChanged = (): void => {
    const map = (this as unknown as { _map?: L.Map })._map;
    if (map) existingCanvasSurface(map)?.change(this);
  };
}
