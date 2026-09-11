import L from 'leaflet';

// Joint implementation: keep identical to Atlos/mapCore/markerViewport.ts.
// Only DOM attachment is virtualized. Leaflet membership, data, state and
// cluster/lasso semantics are unchanged, including getElement() while parked.
const OVERSCAN = 128;
interface NativeMarker {
  _icon?: HTMLElement;
  _shadow?: HTMLElement;
  _map?: L.Map;
  _latlng: L.LatLng;
  _spiderLeg?: L.Layer;
  _setPos(point: L.Point): void;
}
interface AnimatedMap extends L.Map {
  _latLngToNewLayerPoint(position: L.LatLng, zoom: number, center: L.LatLng): L.Point;
}
interface Entry { marker: ViewportMarker; point?: L.Point; origin?: L.Point }
const native = L.Marker.prototype as unknown as NativeMarker;
const viewports = new WeakMap<L.Map, MarkerViewport>();

class MarkerViewport {
  private entries = new Map<ViewportMarker, Entry>();
  private origin?: L.Point;
  private panePosition?: L.Point;
  private bounds?: L.Bounds;
  private hasSize = false;
  private animating = false;

  constructor(private map: L.Map) {
    map.on('move moveend', this.sync);
    map.on('resize', this.resize);
    map.on('zoomanim', this.prepareAnimation);
    map.on('zoomend', this.finishAnimation);
    map.on('unload', this.dispose);
  }
  add(marker: ViewportMarker) { this.entries.set(marker, { marker }); }
  remove(marker: ViewportMarker) {
    this.entries.delete(marker);
    if (!this.entries.size) this.dispose();
  }
  private viewport(): L.Bounds | undefined {
    const origin = this.map.getPixelOrigin();
    const panePosition = L.DomUtil.getPosition(this.map.getPane('mapPane')!);
    if (this.origin !== origin || this.panePosition !== panePosition) {
      this.origin = origin; this.panePosition = panePosition;
      const size = this.map.getSize();
      this.hasSize = size.x > 0 && size.y > 0;
      const start = this.map.containerPointToLayerPoint(L.point(-OVERSCAN, -OVERSCAN));
      this.bounds = L.bounds(start, start.add(size).add([2 * OVERSCAN, 2 * OVERSCAN]));
    }
    return this.hasSize ? this.bounds : undefined;
  }
  private pinned(marker: ViewportMarker, icon: HTMLElement): boolean {
    // Leaflet 1.9 isTooltipOpen() dereferences an absent tooltip on ordinary markers.
    return icon.contains(icon.ownerDocument.activeElement) || marker.isPopupOpen() || !!marker.getTooltip()?.isOpen()
      || !!(marker as unknown as NativeMarker)._spiderLeg;
  }
  private attach(entry: Entry, point: L.Point) {
    const marker = entry.marker;
    const internals = marker as unknown as NativeMarker;
    native._setPos.call(marker, point);
    if (internals._icon && internals._icon.parentNode !== marker.getPane()) marker.getPane()!.appendChild(internals._icon);
    if (internals._shadow) {
      const pane = marker.getPane('shadowPane')!;
      if (internals._shadow.parentNode !== pane) pane.appendChild(internals._shadow);
    }
  }
  private park(entry: Entry, notify: boolean) {
    const marker = entry.marker as unknown as NativeMarker;
    const attached = marker._icon?.parentNode === entry.marker.getPane();
    marker._icon?.remove(); marker._shadow?.remove();
    if (attached && notify) entry.marker.fire('viewporthide');
  }
  place(marker: ViewportMarker, point: L.Point) {
    const entry = this.entries.get(marker);
    const internals = marker as unknown as NativeMarker;
    if (!entry || !internals._icon) { native._setPos.call(marker, point); return; }
    const placed = !!entry.point;
    entry.point = point; entry.origin = this.map.getPixelOrigin();
    const bounds = this.viewport();
    if (!bounds || bounds.contains(point) || this.pinned(marker, internals._icon)
      || (this.animating && internals._icon.parentNode === marker.getPane())) this.attach(entry, point);
    else this.park(entry, placed);
  }
  private sync = () => {
    if (this.animating) return;
    const origin = this.map.getPixelOrigin();
    const bounds = this.viewport();
    for (const entry of this.entries.values()) {
      if (!entry.point || entry.origin !== origin) { entry.marker.update(); continue; }
      const icon = (entry.marker as unknown as NativeMarker)._icon;
      if (!icon) continue;
      const visible = !bounds || bounds.contains(entry.point) || this.pinned(entry.marker, icon);
      if (visible) {
        if (icon.parentNode !== entry.marker.getPane()) this.attach(entry, entry.point);
      } else this.park(entry, true);
    }
  };
  private resize = () => { this.origin = undefined; this.sync(); };
  private prepareAnimation = (event: L.ZoomAnimEvent) => {
    this.animating = true;
    const bounds = this.viewport();
    let attached = false;
    for (const entry of this.entries.values()) {
      if (!entry.point) continue;
      const marker = entry.marker as unknown as NativeMarker;
      if (marker._icon?.parentNode === entry.marker.getPane()) continue;
      const target = (this.map as AnimatedMap)._latLngToNewLayerPoint(entry.marker.getLatLng(), event.zoom, event.center);
      if (!bounds || bounds.contains(target)) { this.attach(entry, entry.point); attached = true; }
    }
    // Establish start positions once, so newly entering icons follow the same
    // native CSS zoom transition as already mounted icons.
    if (attached) void this.map.getPane('markerPane')!.offsetWidth;
  };
  private finishAnimation = () => { this.animating = false; this.origin = undefined; this.sync(); };
  private dispose = () => {
    this.map.off('move moveend', this.sync);
    this.map.off('resize', this.resize);
    this.map.off('zoomanim', this.prepareAnimation);
    this.map.off('zoomend', this.finishAnimation);
    this.map.off('unload', this.dispose);
    this.entries.clear(); viewports.delete(this.map);
  };
}

export class ViewportMarker extends L.Marker {
  override onAdd(map: L.Map): this {
    let viewport = viewports.get(map);
    if (!viewport) { viewport = new MarkerViewport(map); viewports.set(map, viewport); }
    viewport.add(this);
    try { return super.onAdd(map); }
    catch (error) { viewport.remove(this); throw error; }
  }
  override onRemove(map: L.Map): this {
    viewports.get(map)?.remove(this);
    return super.onRemove(map);
  }
  update(): this {
    const marker = this as unknown as NativeMarker;
    if (marker._icon && marker._map) this._setPos(marker._map.latLngToLayerPoint(marker._latlng));
    return this;
  }
  _animateZoom(event: L.ZoomAnimEvent): void {
    const marker = this as unknown as NativeMarker;
    if (marker._map) this._setPos((marker._map as AnimatedMap)._latLngToNewLayerPoint(marker._latlng, event.zoom, event.center));
  }
  _setPos(point: L.Point): void {
    const map = (this as unknown as NativeMarker)._map;
    const viewport = map && viewports.get(map);
    if (viewport) viewport.place(this, point); else native._setPos.call(this, point);
  }
}
