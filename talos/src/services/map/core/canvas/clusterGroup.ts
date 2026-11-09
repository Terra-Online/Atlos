import L from 'leaflet';
import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import { canvasSurface } from '@/services/map/core/canvas/canvasMarkerSurface';
import { SpatialClusterCache } from '@/services/map/core/canvas/spatialClusters';

export interface CanvasClusterOptions extends L.LayerOptions {
  expandOnClick?: boolean;
  disableClusteringAtZoom?: number;
  maxClusterRadius?: number;
  iconCreateFunction(cluster: CanvasClusterMarker): L.DivIcon;
}

export class CanvasClusterMarker extends ViewportMarker {
  constructor(readonly group: CanvasClusterGroup, readonly children: readonly L.Marker[], position: L.LatLng, readonly key: string) {
    super(position, { keyboard: true, bubblingMouseEvents: false });
    this.options.icon = group.options.iconCreateFunction(this);
    this.on('click', () => group.expand(this));
  }
  getChildCount(): number { return this.children.length; }
  getAllChildMarkers(): L.Marker[] { return [...this.children]; }
}
interface Layout {
  scale: number; radius: number; disableAt: number; crs: L.CRS;
  icon: CanvasClusterOptions['iconCreateFunction'];
  markers: readonly L.Marker[];
}
const childrenOf = (marker: L.Marker): readonly L.Marker[] => marker instanceof CanvasClusterMarker ? marker.children : [marker];

/** Logical members and visible representations are separate; no external cluster runtime is needed. */
export class CanvasClusterGroup extends L.Layer {
  declare options: CanvasClusterOptions;
  private owner?: L.Map;
  private members = new Map<number, L.Marker>();
  private others = L.layerGroup();
  private display = L.featureGroup();
  private parents = new Map<L.Marker, L.Marker>();
  private layouts = new Map<number, Layout>();
  private geometry = new SpatialClusterCache();
  private displayed?: Layout;
  private expanded = new Set<L.Marker>();
  private pending?: readonly L.Marker[];
  private pendingFrame = 0;
  private callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(options: CanvasClusterOptions) { super(options); L.setOptions(this, options); }
  override onAdd(map: L.Map): this {
    this.owner = map; this.display.addTo(map); this.others.addTo(map);
    this.refresh(false); map.on('zoomend', this.zoomEnd); return this;
  }
  override onRemove(map: L.Map): this {
    map.off('zoomend', this.zoomEnd); this.cancelPending();
    this.display.remove(); this.display.clearLayers(); this.others.remove();
    this.parents.clear(); this.expanded.clear(); this.owner = undefined; this.displayed = undefined;
    for (const [timer, callback] of this.callbacks) { clearTimeout(timer); callback(); }
    this.callbacks.clear(); return this;
  }
  addLayer(layer: L.Layer): this { return this.addLayers([layer]); }
  addLayers(layers: readonly L.Layer[]): this {
    let changed = false;
    const add = (layer: L.Layer) => {
      if (layer instanceof L.LayerGroup) { layer.eachLayer(add); return; }
      if (!(layer instanceof L.Marker)) { this.others.addLayer(layer); return; }
      const id = L.stamp(layer);
      if (this.members.has(id)) return;
      this.members.set(id, layer); layer.on('move', this.memberMoved); changed = true;
      this.fire('layeradd', { layer });
    };
    layers.forEach(add); if (changed) this.membersChanged(); return this;
  }
  removeLayer(layer: L.Layer | number): this { return this.removeLayers([layer]); }
  removeLayers(layers: readonly (L.Layer | number)[]): this {
    let changed = false;
    for (const layer of layers) {
      const id = typeof layer === 'number' ? layer : L.stamp(layer), marker = this.members.get(id);
      if (marker) {
        marker.off('move', this.memberMoved); this.members.delete(id); changed = true;
        this.fire('layerremove', { layer: marker });
      } else this.others.removeLayer(layer);
    }
    if (changed) this.membersChanged(); return this;
  }
  clearLayers(): this {
    for (const marker of this.members.values()) marker.off('move', this.memberMoved);
    this.members.clear(); this.others.clearLayers(); this.membersChanged(); return this;
  }
  hasLayer(layer: L.Layer | number): boolean {
    const id = typeof layer === 'number' ? layer : L.stamp(layer);
    return this.members.has(id) || !!this.others.getLayer(id);
  }
  getLayers(): L.Layer[] { return [...this.members.values(), ...this.others.getLayers()]; }
  getVisibleLayers(): L.Marker[] { return this.display.getLayers() as L.Marker[]; }
  getVisibleParent(marker: L.Marker): L.Marker | null { return this.parents.get(marker) ?? null; }
  refreshClusters(): this {
    for (const layer of this.getVisibleLayers()) if (layer instanceof CanvasClusterMarker) layer.setIcon(this.options.iconCreateFunction(layer));
    return this;
  }
  private memberMoved = (): void => { this.membersChanged(); };
  private membersChanged(): void {
    this.cancelPending(); this.layouts.clear(); this.expanded.clear(); this.refresh(false);
  }
  private cancelPending(): void { cancelAnimationFrame(this.pendingFrame); this.pendingFrame = 0; this.pending = undefined; }
  private layout(level: number): Layout {
    const map = this.owner!, scale = map.getZoomScale(level, 0), radius = this.options.maxClusterRadius ?? 60;
    const disableAt = this.options.disableClusteringAtZoom ?? 2, crs = map.options.crs!;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Identity only; invocation keeps the options receiver.
    const icon = this.options.iconCreateFunction;
    const cached = this.layouts.get(level);
    if (cached && cached.scale === scale && cached.radius === radius && cached.disableAt === disableAt
      && cached.crs === crs && cached.icon === icon) return cached;
    let result: L.Marker[];
    if (level >= disableAt) result = [...this.members.values()];
    else {
      const previous = new Map(this.getVisibleLayers().filter((marker): marker is CanvasClusterMarker => marker instanceof CanvasClusterMarker).map(marker => [marker.key, marker]));
      const positions = [...this.members.values()].map(marker => ({ item: marker, ...map.project(marker.getLatLng(), 0) }));
      result = this.geometry.get(positions, scale, radius).map(bucket => {
        const members = bucket.members.map(index => positions[index].item);
        if (members.length === 1) return members[0];
        const key = members.map(marker => L.stamp(marker)).join(','), position = map.unproject([bucket.x, bucket.y], 0);
        const retained = previous.get(key);
        if (!retained) return new CanvasClusterMarker(this, members, position, key);
        if (!retained.getLatLng().equals(position)) retained.setLatLng(position);
        if (this.displayed?.icon !== icon) retained.setIcon(this.options.iconCreateFunction(retained));
        return retained;
      });
    }
    const layout = { scale, radius, disableAt, crs, icon, markers: result };
    this.layouts.set(level, layout); return layout;
  }
  private refresh(animate: boolean): void {
    const map = this.owner;
    if (!map) return;
    const surface = canvasSurface(map), before = this.getVisibleLayers(), retained = new Set(before);
    const origins = new Map<L.Marker, L.LatLng>();
    if (animate) for (const marker of before) {
      const position = surface.visualPosition(marker) ?? marker.getLatLng();
      for (const child of childrenOf(marker)) origins.set(child, position);
    }
    const layout = this.layout(Math.round(map.getZoom())); this.displayed = layout;
    const desired = new Set<L.Marker>(); this.parents.clear();
    for (const marker of layout.markers) {
      const members = childrenOf(marker);
      if (marker instanceof CanvasClusterMarker && members.some(child => this.expanded.has(child))) {
        for (const child of members) { desired.add(child); this.parents.set(child, child); }
      } else { desired.add(marker); for (const child of members) this.parents.set(child, marker); }
    }
    if (animate) surface.beginClusterTransition();
    try {
      for (const marker of before) if (!desired.has(marker)) this.display.removeLayer(marker);
      for (const marker of desired) if (!this.display.hasLayer(marker)) this.display.addLayer(marker);
      if (animate) {
        for (const marker of desired) {
          let lat = 0, lng = 0, count = 0;
          for (const child of childrenOf(marker)) { const origin = origins.get(child); if (origin) { lat += origin.lat; lng += origin.lng; count++; } }
          if (count) surface.animateFrom(marker, L.latLng(lat / count, lng / count), !retained.has(marker));
        }
        for (const marker of before) {
          let lat = 0, lng = 0, count = 0;
          for (const child of childrenOf(marker)) { const parent = this.parents.get(child); if (parent) { lat += parent.getLatLng().lat; lng += parent.getLatLng().lng; count++; } }
          if (count) surface.animateRemovedTo(marker, L.latLng(lat / count, lng / count));
        }
      }
    } finally { if (animate) surface.endClusterTransition(); }
  }
  expand(cluster: CanvasClusterMarker, force = false): void {
    const map = this.owner;
    if (!map || (!force && this.options.expandOnClick === false)) return;
    if ((map as L.Map & { _animatingZoom?: boolean })._animatingZoom) { this.pending = cluster.children; return; }
    for (const child of cluster.children) if (this.members.has(L.stamp(child))) this.expanded.add(child);
    this.refresh(true); this.fire('expand', { cluster, members: cluster.getAllChildMarkers() });
  }
  private zoomEnd = (): void => {
    const pending = this.pending;
    const expanded = this.expanded.size > 0;
    this.expanded.clear();
    // Fractional wheel gestures often finish inside the same aggregation level.
    // Keep parent links and timelines unless the layout or expansion actually changed.
    if (expanded || this.layout(Math.round(this.owner!.getZoom())) !== this.displayed) this.refresh(true);
    if (pending) this.pendingFrame = requestAnimationFrame(() => {
      this.cancelPending();
      const clusters = new Set<CanvasClusterMarker>();
      for (const child of pending) { const parent = this.parents.get(child); if (parent instanceof CanvasClusterMarker) clusters.add(parent); }
      for (const cluster of clusters) this.expand(cluster);
    });
  };
  zoomToShowLayer(layer: L.Layer, callback: () => void): void {
    if (!(layer instanceof L.Marker) || !this.owner || !this.hasLayer(layer)) { callback(); return; }
    const parent = this.parents.get(layer);
    if (parent instanceof CanvasClusterMarker) this.expand(parent, true);
    if (!this.owner.getBounds().contains(layer.getLatLng())) this.owner.panTo(layer.getLatLng());
    const timer = setTimeout(() => { this.callbacks.delete(timer); callback(); }, 340);
    this.callbacks.set(timer, callback);
  }
}
