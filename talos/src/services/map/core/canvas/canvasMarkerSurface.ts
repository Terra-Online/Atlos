import L from 'leaflet';
import { isRegionSwitching } from '@/services/map/regionLifecycle';
import { MarkerMotion, MarkerMotionPool, Motion, ease } from '@/services/map/core/canvas/canvasMarkerMotion';
import { MarkerPainter, type MarkerArt, type Sprite, type AnimatedSprite, type PulseLayers } from '@/services/map/core/canvas/canvasMarkerPaint';
import { markerClasses as classes } from '@/services/map/core/canvas/canvasMarkerStyle';
import { CanvasSpriteBatch } from '@/services/map/core/canvas/canvasSpriteBatch';
import { canvasPadding } from '@/services/map/core/canvas/canvasViewport';
import { SceneIcon, getMarkerState, setMarkerState } from '@/services/map/core/canvas/markerModel';

type CanvasMarker = L.Marker;
interface Entry {
  marker: CanvasMarker; art: MarkerArt; motion: MarkerMotion;
  x: number; y: number; base: L.Point; latlng: L.LatLng; order: number; completed: boolean; opacity: number;
  offsetX?: Motion; offsetY?: Motion;
  sprite?: Sprite;
  animatedSprite?: AnimatedSprite;
  pulseLayers?: PulseLayers;
  pulseKeys?: [object, object, object];
  usingPulseLayers?: boolean;
  visible?: boolean;
  stack: number;
  reveal?: Motion;
  clusterUntil?: number;
}
interface Ghost { marker: L.Marker; sprite: Sprite; base: L.Point; target: L.Point; alpha: number; start: number }
interface Rect { x: number; y: number; width: number; height: number }
const surfaces = new WeakMap<L.Map, CanvasMarkerSurface>();
const CELL = 32;
// Internal output quality floor, independent of the physical display density.
const MIN_CANVAS_RENDER_RATIO = 2;
const bounds = (entry: Entry): Rect => ({ x: entry.x - 38, y: entry.y - 54, width: entry.art.subImage ? 104 : 76, height: 94 });
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const compareEntries = (a: Entry, b: Entry) => a.stack - b.stack
  || (a.art.count && b.art.count ? a.base.y - b.base.y : 0) || a.order - b.order;

export function canvasSurface(map: L.Map): CanvasMarkerSurface {
  let surface = surfaces.get(map);
  if (!surface) { surface = new CanvasMarkerSurface(map); surfaces.set(map, surface); }
  return surface;
}
export const existingCanvasSurface = (map: L.Map): CanvasMarkerSurface | undefined => surfaces.get(map);


/** One paint surface, spatial hit/dirty index, and independent per-point timelines. */
export class CanvasMarkerSurface {
  private entries = new Map<CanvasMarker, Entry>();
  private grid = new Map<string, Entry[]>();
  private indexDirty = false;
  private renderScale = 1;
  private renderOrigin = L.point(0, 0);
  private ordered: Entry[] = [];
  private reorder = false;
  private dirty: Rect[] = [];
  private full = true;
  private active = new Set<Entry>();
  private moving = new Set<Entry>();
  private changed = new Set<Entry>();
  private motionPool = new MarkerMotionPool();
  private pendingMotion = new Set<Entry>();
  private ghosts = new Map<L.Marker, Ghost>();
  private artEntries = new Map<string, Set<Entry>>();
  private clusterTransition = false;
  private sequence = 0;
  private frame = 0;
  private disposed = false;
  private trimPending = false;
  private trimTimer?: ReturnType<typeof setTimeout>;
  private viewportOffset = L.point(0, 0);
  private onscreen = new Set<Entry>();
  private cachedZoom = NaN;
  private zooming = false;
  private width = 0;
  private height = 0;
  private deviceRatio = window.devicePixelRatio || 1;
  private renderRatio = Math.max(MIN_CANVAS_RENDER_RATIO, this.deviceRatio);
  private resolution?: MediaQueryList;
  private hovered?: Entry;
  private pointer?: PointerEvent;
  private pressed?: { entry?: Entry; x: number; y: number };
  private animation?: { start: number; from: Map<Entry, L.Point>; zoom: number; center: L.LatLng };
  private canvas = document.createElement('canvas');
  private canvasOffset?: L.Point;
  private context?: CanvasRenderingContext2D;
  private batch?: CanvasSpriteBatch;
  private pendingSwap?: { canvas: HTMLCanvasElement; batch: CanvasSpriteBatch };
  private backendReason?: string;
  private semantic = document.createElement('div');
  private proxy = document.createElement('button');
  private focused?: Entry;
  private painter: MarkerPainter;

  constructor(private map: L.Map) {
    this.batch = CanvasSpriteBatch.create(this.canvas, () => this.fallback2D('graphics context lost'));
    if (!this.batch) {
      this.backendReason = 'WebGL2 unavailable or initialization failed';
      this.canvas = document.createElement('canvas'); this.context = this.canvas.getContext('2d')!;
    }
    this.canvas.className = 'oem-canvas-markers';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;';
    // A single keyboard proxy is independent of the number of logical points.
    this.semantic.className = 'oem-canvas-semantics';
    this.semantic.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;clip-path:inset(100%);contain:strict;pointer-events:none;';
    this.proxy.type = 'button'; this.proxy.tabIndex = -1;
    this.proxy.setAttribute('aria-label', 'Map markers');
    this.semantic.append(this.proxy);
    map.getPane('markerPane')!.append(this.canvas);
    map.getContainer().append(this.semantic);
    // Both the viewport and cached artwork retain at least Retina-density pixels.
    // Integer sprite density also avoids fractional texture-bound rounding.
    this.painter = new MarkerPainter(Math.ceil(this.renderRatio), url => {
      const affected = url === this.painter.hoverDecoration || url === this.painter.selectedDecoration
        ? this.entries.values() : this.artEntries.get(url)?.values();
      if (affected) for (const entry of affected) {
        if (entry.art.image === url || entry.art.subImage === url || entry.art.subImage
          && (url === this.painter.hoverDecoration || url === this.painter.selectedDecoration)) this.invalidate(entry);
      }
    }, this.batch ? () => this.fallback2D('image does not allow GPU texture access') : undefined);
    this.readOfficialStyles();
    const container = map.getContainer();
    container.addEventListener('pointermove', this.pointerMove, true);
    container.addEventListener('pointerleave', this.pointerLeave);
    container.addEventListener('pointerdown', this.pointerDown, true);
    container.addEventListener('click', this.click, true);
    container.addEventListener('dblclick', this.doubleClick, true);
    container.addEventListener('contextmenu', this.contextMenu, true);
    this.semantic.addEventListener('focusin', this.focus);
    this.proxy.addEventListener('keydown', this.keyDown);
    this.proxy.addEventListener('click', this.proxyClick);
    this.semantic.addEventListener('focusout', this.focus);
    document.fonts?.addEventListener('loadingdone', this.fontsLoaded);
    this.watchResolution();
    window.addEventListener('resize', this.displayChanged);
    map.on('move resize viewreset', this.move);
    map.on('zoomstart', this.zoomStart);
    map.on('zoomanim', this.zoom);
    map.on('zoomend', this.zoomEnd);
    map.on('unload', this.dispose);
    map.on('talos:regionSwitchStart', this.retireRegion);
    map.on('talos:regionSwitched', this.commitRegion);
    map.on('moveend', this.queueTrim);
    map.on('movestart', this.cancelTrim);
  }
  place(marker: CanvasMarker, point?: L.Point): void {
    const icon = marker.options.icon;
    if (!(icon instanceof SceneIcon)) throw new TypeError('Canvas markers require a SceneIcon artwork descriptor');
    let entry = this.entries.get(marker);
    if (!entry) {
      entry = { marker, art: icon.art, motion: this.motionPool.initial,
        x: NaN, y: NaN, base: this.map.project(marker.getLatLng(), 0), latlng: marker.getLatLng(),
        order: this.sequence++, completed: false, stack: 1, opacity: 1 };
      this.entries.set(marker, entry); this.indexArt(entry);
      this.reorder = true; this.indexDirty = true;
      this.refreshProxy();
    }
    this.changed.add(entry);
    if (entry.latlng !== marker.getLatLng()) {
      entry.latlng = marker.getLatLng(); entry.base = this.map.project(entry.latlng, 0);
      this.indexDirty = true;
    }
    if (point) {
      (marker as unknown as { _zIndex: number })._zIndex = point.y + (marker.options.zIndexOffset ?? 0);
      this.updateStack(entry);
      if (!this.animation) {
        const reference = this.map.latLngToLayerPoint(entry.latlng);
        const duration = 0;
        const now = performance.now();
        if (point.x !== reference.x || entry.offsetX) (entry.offsetX ??= new Motion(0)).to(point.x - reference.x, now, duration, [0, 0, 0.25, 1]);
        if (point.y !== reference.y || entry.offsetY) (entry.offsetY ??= new Motion(0)).to(point.y - reference.y, now, duration, [0, 0, 0.25, 1]);
        if (entry.offsetX?.active(now) || entry.offsetY?.active(now)) { this.active.add(entry); this.moving.add(entry); }
      }
    }
    this.full = true; this.request();
    if (this.focused === entry) this.refreshProxy();
  }
  change(marker: CanvasMarker): void {
    const entry = this.entries.get(marker);
    if (!entry) return;
    this.changed.add(entry); this.request();
  }
  private readOfficialStyles(loadFonts = true): void {
    // A short-lived probe reads official typography and decoration styles once.
    const probe = document.createElement('div'), sub = document.createElement('div');
    probe.className = classes.markerInner; probe.dataset.tier = 'L1';
    probe.style.cssText = 'position:absolute;visibility:hidden;width:32px;height:32px;pointer-events:none';
    sub.className = classes.subIconContainer; probe.append(sub); this.map.getPane('markerPane')!.append(probe);
    // Official canvas typography is slightly smaller; retain our centered line box.
    // Read individual fields because the shorthand is empty with OpenType features.
    const font = (style: CSSStyleDeclaration, scale: number) => `${style.fontStyle} ${style.fontWeight} ${parseFloat(style.fontSize) * scale}px ${style.fontFamily}`;
    this.painter.font = font(getComputedStyle(probe, '::after'), 10.5 / 11);
    const count = document.createElement('span'); count.className = classes.clusterCount;
    probe.classList.add(classes.clusterMarker); probe.append(count);
    this.painter.countFont = font(getComputedStyle(count), 11.5 / 12);
    const url = (pseudo: string) => getComputedStyle(sub, pseudo).backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] ?? '';
    this.painter.hoverDecoration = url('::before'); this.painter.selectedDecoration = url('::after');
    probe.remove();
    this.painter.preload(this.painter.hoverDecoration); this.painter.preload(this.painter.selectedDecoration);
    if (loadFonts && document.fonts) void Promise.all([
      document.fonts.load(this.painter.font, '0123456789BL'),
      document.fonts.load(this.painter.countFont, '0123456789'),
    ]).then(this.fontsLoaded, () => {});
  }
  private watchResolution(): void {
    this.resolution?.removeEventListener('change', this.displayChanged);
    this.resolution = window.matchMedia?.(`(resolution: ${this.deviceRatio}dppx)`);
    this.resolution?.addEventListener('change', this.displayChanged);
  }
  private displayChanged = (): void => {
    if (this.disposed) return;
    this.deviceRatio = window.devicePixelRatio || 1;
    this.renderRatio = Math.max(MIN_CANVAS_RENDER_RATIO, this.deviceRatio);
    this.painter.setRatio(Math.ceil(this.renderRatio));
    for (const entry of this.entries.values()) this.invalidate(entry);
    this.watchResolution(); this.fontsLoaded();
    this.full = true; this.request();
  };
  remove(marker: CanvasMarker, disposeEmpty = true): void {
    const entry = this.entries.get(marker);
    if (!entry) return;
    this.releaseEntry(entry);
    if (this.clusterTransition && entry.visible) {
      const now = performance.now();
      const sprite = entry.sprite ?? (entry.motion.paintActive(now) ? this.painter.snapshot(entry.art, entry.motion, now)
        : this.painter.sprite(entry.art, entry.motion, now));
      const base = this.map.project(this.visualPosition(marker) ?? entry.latlng, 0);
      const previous = this.ghosts.get(marker);
      if (previous) this.batch?.release(previous);
      this.ghosts.set(marker, { marker, sprite, base, target: base, alpha: entry.opacity * entry.motion.opacity(now), start: NaN });
    }
    if (this.hovered === entry) this.setHovered(undefined);
    this.dirty.push(bounds(entry)); this.unindexArt(entry); this.entries.delete(marker);
    this.active.delete(entry); this.onscreen.delete(entry); this.moving.delete(entry); this.changed.delete(entry); this.pendingMotion.delete(entry); this.reorder = true; this.full = true; this.indexDirty = true;
    // Keep the instance through an atomic cluster replacement (including an empty intermediate set).
    // unload owns final disposal; empty filter sets also reuse decoded assets on their next update.
    void disposeEmpty;
    if (this.focused === entry) this.focused = undefined;
    this.refreshProxy(); this.request();
  }
  visualPosition(marker: L.Marker): L.LatLng | undefined {
    const entry = this.entries.get(marker);
    // Discrete zooms commit all cluster groups before painting. Their transition
    // origins still belong to the previously rendered camera coordinate space.
    if (entry && Number.isFinite(entry.x) && !this.animation && this.cachedZoom !== this.map.getZoom()) {
      return this.map.unproject(L.point(entry.x, entry.y).add(this.renderOrigin).divideBy(this.renderScale), 0);
    }
    return entry && (Number.isFinite(entry.x) ? this.map.containerPointToLatLng(L.point(entry.x, entry.y).subtract(this.viewportOffset)) : entry.latlng);
  }
  beginClusterTransition(): void { this.clusterTransition = true; }
  endClusterTransition(): void { this.clusterTransition = false; this.full = true; this.request(); }
  animateFrom(marker: L.Marker, origin: L.LatLng, introducing = false): void {
    const entry = this.entries.get(marker);
    if (!entry) return;
    if (!introducing && !this.ghosts.has(marker) && origin.equals(entry.latlng)) return;
    const start = this.map.latLngToContainerPoint(origin), target = this.map.latLngToContainerPoint(entry.latlng);
    (entry.offsetX ??= new Motion(0)).jump(start.x - target.x); (entry.offsetY ??= new Motion(0)).jump(start.y - target.y);
    this.moving.add(entry);
    entry.clusterUntil = Infinity;
    const same = this.ghosts.get(marker);
    if (same) { this.batch?.release(same); this.ghosts.delete(marker); }
    else if (introducing) entry.reveal = new Motion(0);
    this.pendingMotion.add(entry); this.changed.add(entry); this.full = true;
  }
  animateRemovedTo(marker: L.Marker, target: L.LatLng): void {
    const ghost = this.ghosts.get(marker);
    if (ghost) ghost.target = this.map.project(target, 0);
  }
  private read(entry: Entry, now: number): void {
    const icon = entry.marker.options.icon;
    if (!(icon instanceof SceneIcon)) return;
    const state = getMarkerState(entry.marker);
    if (entry.clusterUntil && state.appearing) setMarkerState(entry.marker, { appearing: false });
    if (entry.clusterUntil && now >= entry.clusterUntil) entry.clusterUntil = undefined;
    const art = icon.art, tier = state.tier || art.tier;
    const urlsChanged = art.image !== entry.art.image || art.subImage !== entry.art.subImage;
    const artChanged = urlsChanged || art.noFrame !== entry.art.noFrame || tier !== entry.art.tier || art.count !== entry.art.count;
    if (artChanged) {
      if (urlsChanged) this.unindexArt(entry);
      entry.art = tier === art.tier ? art : { ...art, tier };
      if (urlsChanged) this.indexArt(entry);
    }
    this.painter.preload(entry.art.image); this.painter.preload(entry.art.subImage);
    const stackChanged = entry.completed !== state.completed;
    if (stackChanged) { entry.completed = state.completed; this.reorder = true; }
    this.updateStack(entry);
    const opacity = state.opacity;
    const focused = this.focused === entry && this.proxy === this.proxy.ownerDocument.activeElement;
    const flags = +state.selected | (+state.checked << 1) | (+state.offLayer << 2)
      | (+(this.hovered === entry || state.hover) << 3) | (+(focused || state.focus) << 4) | (+state.pulsing << 5)
      | (+(state.appearing && !entry.clusterUntil) << 6) | (+state.disappearing << 7);
    const motion = this.motionPool.transition(entry.motion, flags, now, entry.art.noFrame, !!entry.art.count);
    if (!artChanged && !stackChanged && motion === entry.motion && opacity === entry.opacity) return;
    entry.motion = motion; entry.opacity = opacity;
    this.invalidate(entry);
  }
  private indexArt(entry: Entry): void {
    for (const url of [entry.art.image, entry.art.subImage]) {
      if (!url) continue;
      let entries = this.artEntries.get(url);
      if (!entries) this.artEntries.set(url, entries = new Set());
      entries.add(entry);
    }
  }
  private unindexArt(entry: Entry): void {
    for (const url of [entry.art.image, entry.art.subImage]) {
      const entries = this.artEntries.get(url);
      if (!entries) continue;
      entries.delete(entry);
      if (!entries.size) this.artEntries.delete(url);
    }
  }
  private invalidate(entry: Entry): void {
    entry.sprite = undefined;
    entry.animatedSprite = undefined;
    entry.pulseLayers = undefined;
    this.dirty.push(bounds(entry)); this.active.add(entry); this.request();
  }
  private pulseParts(entry: Entry, now: number, alpha: number): PulseLayers | undefined {
    // Group opacity cannot be applied to overlapping layers independently.
    // Preserve the original single-sprite path during fades and geometry changes.
    return alpha === 1 && entry.motion.pulseOnly(now)
      ? entry.pulseLayers ??= this.painter.pulseLayers(entry.art, entry.motion, now) : undefined;
  }
  private releasePulse(entry: Entry): void {
    if (entry.pulseKeys) for (const key of entry.pulseKeys) this.batch?.release(key);
    entry.usingPulseLayers = false;
  }
  private releaseEntry(entry: Entry): void {
    this.batch?.release(entry); this.releasePulse(entry);
  }
  private updateStack(entry: Entry): void {
    const stack = entry.art.count ? 2 : entry.completed ? 0 : 1;
    if (stack !== entry.stack) { entry.stack = stack; this.reorder = true; }
  }
  private request(): void {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.drawFrame);
  }
  private drawFrame = (now: number): void => {
    // The browser already consumed this request. Only an external synchronous
    // draw (for example a camera move) needs to cancel a still-pending frame.
    this.frame = 0;
    this.draw(now);
  };
  private fallback2D(reason: string): void {
    if (!this.batch || this.disposed) return;
    this.backendReason = reason;
    this.pendingSwap = { canvas: this.canvas, batch: this.batch };
    this.batch = undefined;
    this.canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
    this.canvasOffset = undefined;
    this.context = this.canvas.getContext('2d')!;
    this.full = true; this.request();
  }
  /** Move an already scheduled animation behind a newly queued input preview. */
  deferFrame(): void {
    if (this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; this.request(); }
  }
  /** Finish a batched input preview in its current animation frame. */
  flush(): void { this.draw(performance.now()); }
  getRendererStats() {
    return this.batch?.stats ?? { backend: 'canvas2d', reason: this.backendReason, instances: this.ordered.filter(entry => entry.visible).length };
  }
  readPixels(x: number, y: number, width: number, height: number): Uint8ClampedArray {
    return this.batch ? this.batch.readPixels(x, y, width, height) : this.context!.getImageData(x, y, width, height).data;
  }
  private rebuildIndex(): void {
    this.grid.clear();
    for (const entry of this.ordered) {
      const key = `${Math.floor(entry.base.x / CELL)}:${Math.floor(entry.base.y / CELL)}`;
      let cell = this.grid.get(key);
      if (!cell) this.grid.set(key, cell = []);
      cell.push(entry);
    }
    this.indexDirty = false;
  }
  private cells(rect: Rect, visit: (key: string) => void): void {
    for (let x = Math.floor(rect.x / CELL); x <= Math.floor((rect.x + rect.width) / CELL); x++)
      for (let y = Math.floor(rect.y / CELL); y <= Math.floor((rect.y + rect.height) / CELL); y++) visit(`${x}:${y}`);
  }
  private query(rect: Rect): Set<Entry> {
    const found = new Set<Entry>();
    // The index lives in map coordinates, so a camera change does not rebuild 10k entries.
    this.cells({ x: (rect.x - 66 + this.renderOrigin.x) / this.renderScale,
      y: (rect.y - 42 + this.renderOrigin.y) / this.renderScale,
      width: (rect.width + 104) / this.renderScale, height: (rect.height + 96) / this.renderScale },
    key => { for (const entry of this.grid.get(key) ?? []) found.add(entry); });
    // A point moving out of a cluster may temporarily be outside its final spatial cell.
    for (const entry of this.active) if (intersects(bounds(entry), rect)) found.add(entry);
    return found;
  }
  private draw = (now: number): void => {
    // Some embedded browsers/emulators change DPR without a resolution event.
    // Reconcile on the next paint as well; no polling timer or idle rendering needed.
    if (!this.disposed && this.deviceRatio !== (window.devicePixelRatio || 1)) this.displayChanged();
    if (this.disposed) return;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    // A region transaction changes the camera before replacing membership. Paint
    // only its complete scene; ordinary fractional camera moves remain synchronous.
    if (isRegionSwitching(this.map)) { this.full = true; return; }
    this.painter.beginFrame(now);
    for (const entry of this.pendingMotion) {
      entry.offsetX?.to(0, now, 320); entry.offsetY?.to(0, now, 320); entry.reveal?.to(1, now, 160); entry.clusterUntil = now + 320;
    }
    this.pendingMotion.clear();
    for (const entry of this.changed) this.read(entry, now);
    this.changed.clear();
    for (const ghost of this.ghosts.values()) if (!Number.isFinite(ghost.start)) ghost.start = now;
    if (this.ghosts.size) {
      this.full = true;
      for (const [marker, ghost] of this.ghosts) if (now >= ghost.start + 320) {
        this.batch?.release(ghost); this.ghosts.delete(marker);
      }
    }
    if (this.reorder) {
      this.ordered = [...this.entries.values()].sort(compareEntries);
      this.reorder = false; this.full = true;
    }
    if (this.indexDirty) this.rebuildIndex();
    const viewportSize = this.map.getSize();
    // Keep the bounded pan buffer through zooms. Shrinking and regrowing the GPU
    // drawing buffer around each zoom can stall the driver and has the same peak allocation.
    const padding = canvasPadding(viewportSize.x, viewportSize.y);
    const size = viewportSize.add([padding * 2, padding * 2]);
    const pixelWidth = Math.ceil(size.x * this.renderRatio), pixelHeight = Math.ceil(size.y * this.renderRatio);
    const resized = size.x !== this.width || size.y !== this.height || this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight;
    if (resized) {
      this.width = size.x; this.height = size.y;
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
      this.canvas.style.width = `${pixelWidth / this.renderRatio}px`; this.canvas.style.height = `${pixelHeight / this.renderRatio}px`; this.full = true;
    }
    const viewportLayer = this.map.containerPointToLayerPoint(L.point(0, 0));
    const viewportOrigin = this.map.getPixelOrigin().add(viewportLayer);
    const shift = viewportOrigin.subtract(this.renderOrigin);
    const retained = padding > 0 && !resized && !this.animation && this.cachedZoom === this.map.getZoom()
      && shift.x >= 0 && shift.y >= 0 && shift.x + viewportSize.x <= this.width && shift.y + viewportSize.y <= this.height;
    const offset = retained ? this.renderOrigin.subtract(this.map.getPixelOrigin()) : viewportLayer.subtract([padding, padding]);
    if (!retained && (!this.viewportOffset.equals(shift) || this.cachedZoom !== this.map.getZoom())) this.full = true;
    this.viewportOffset = retained ? shift : L.point(padding, padding);
    this.cachedZoom = this.map.getZoom();
    if (!this.canvasOffset?.equals(offset)) { L.DomUtil.setPosition(this.canvas, offset); this.canvasOffset = offset; }
    if (this.full || this.animation || this.moving.size) {
      const origin = this.map.getPixelOrigin().add(offset);
      const scale = this.map.getZoomScale(this.map.getZoom(), 0);
      const animation = this.animation;
      const progress = animation ? ease((now - animation.start) / 250, [0, 0, 0.25, 1]) : 1;
      const targetScale = animation ? this.map.getZoomScale(animation.zoom, 0) : scale;
      const targetOrigin = animation ? (this.map as L.Map & { _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point })
        ._getNewPixelOrigin(animation.center, animation.zoom).add(offset) : origin;
      this.renderScale = scale + (targetScale - scale) * progress;
      this.renderOrigin = L.point(origin.x + (targetOrigin.x - origin.x) * progress, origin.y + (targetOrigin.y - origin.y) * progress);
      for (const entry of this.ordered) {
        if (animation) {
          const targetX = entry.base.x * targetScale - targetOrigin.x, targetY = entry.base.y * targetScale - targetOrigin.y;
          const from = animation.from.get(entry);
          entry.x = from ? from.x + this.viewportOffset.x + (targetX - from.x - this.viewportOffset.x) * progress : targetX;
          entry.y = from ? from.y + this.viewportOffset.y + (targetY - from.y - this.viewportOffset.y) * progress : targetY;
        } else {
          entry.x = entry.base.x * scale - origin.x + (entry.offsetX?.value(now) ?? 0);
          entry.y = entry.base.y * scale - origin.y + (entry.offsetY?.value(now) ?? 0);
        }
      }
      this.full = true;
      for (const entry of this.ordered) {
        const visible = entry.x + (entry.art.subImage ? 66 : 38) > 0 && entry.x - 38 < this.width
          && entry.y + 40 > 0 && entry.y - 54 < this.height;
        if (entry.visible && !visible) this.releaseEntry(entry);
        entry.visible = visible;
      }
      // Include the terminal frame before retiring motion; otherwise the previous subpixel pose sticks.
      for (const entry of this.moving) if (!entry.offsetX?.active(now) && !entry.offsetY?.active(now)) this.moving.delete(entry);
    }
    // A stationary pointer can change its target when the cached image moves.
    if (this.pointer && !this.pointer.buttons) this.setHovered(this.hit(this.pointer), this.pointer);
    // Viewport membership is distinct from cache membership. Query the world index
    // so moving within the retained surface never scans the entire point collection.
    const view = { x: this.viewportOffset.x, y: this.viewportOffset.y, width: viewportSize.x, height: viewportSize.y };
    const next = new Set([...this.query(view)].filter(entry => intersects(bounds(entry), view)));
    for (const entry of this.onscreen) if (!next.has(entry)) entry.marker.fire('viewporthide');
    this.onscreen = next;
    for (const entry of this.active) this.dirty.push(bounds(entry));
    if (!this.batch && this.dirty.length > 32) this.full = true;
    const needsPaint = this.full || this.dirty.length > 0;
    if (needsPaint && this.batch && this.width > 0 && this.height > 0) {
      try { this.paintBatch(now); }
      catch (error) { this.fallback2D(error instanceof Error ? error.message : 'GPU raster unavailable'); }
    }
    if (needsPaint && !this.batch) {
      const ctx = this.context!;
      ctx.setTransform(this.renderRatio, 0, 0, this.renderRatio, 0, 0);
      // Paths are NOT part of save/restore. A previous dirty union must not survive this frame.
      ctx.beginPath();
      let candidates: Entry[];
      ctx.save();
      if (this.full) {
        ctx.clearRect(0, 0, this.width, this.height);
        candidates = this.ordered;
      } else {
        // Clip the union once. Overlapping dirty rectangles never blend a point twice.
        ctx.beginPath();
        const found = new Set<Entry>();
        for (const rect of this.dirty) {
          const aligned = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width) + 2, height: Math.ceil(rect.height) + 2 };
          ctx.rect(aligned.x, aligned.y, aligned.width, aligned.height);
          for (const entry of this.query(aligned)) if (intersects(bounds(entry), aligned)) found.add(entry);
        }
        ctx.clip(); ctx.clearRect(0, 0, this.width, this.height);
        ctx.beginPath();
        candidates = [...found].sort(compareEntries);
      }
      const draw = (sprite: Sprite, x: number, y: number) => {
        const raster = this.painter.raster(sprite);
        ctx.drawImage(raster.canvas, x + raster.x, y + raster.y, raster.width, raster.height);
      };
      for (const entry of candidates) {
        if (!entry.visible) continue;
        if (!this.painter.isArtReady(entry.art)) continue;
        const alpha = entry.opacity * entry.motion.opacity(now) * (entry.reveal?.value(now) ?? 1);
        ctx.globalAlpha = alpha;
        const parts = this.pulseParts(entry, now, alpha);
        if (parts) {
          if (parts.underlay) draw(parts.underlay, entry.x, entry.y);
          draw(this.painter.pulse(entry.motion, now), entry.x, entry.y + (entry.art.noFrame ? entry.motion.shift.target : -16));
          draw(parts.overlay, entry.x, entry.y);
        } else draw(entry.sprite ?? (entry.motion.paintActive(now) ? (entry.animatedSprite ??= this.painter.animation(entry.art, entry.motion)).render(now)
          : entry.sprite = this.painter.sprite(entry.art, entry.motion, now)), entry.x, entry.y);
      }
      if (this.ghosts.size) {
        const origin = this.map.getPixelOrigin().add(offset), scale = this.map.getZoomScale(this.map.getZoom(), 0);
        for (const ghost of this.ghosts.values()) {
          const progress = ease((now - ghost.start) / 320, [0.6, 0, 0, 1]);
          const x = (ghost.base.x + (ghost.target.x - ghost.base.x) * progress) * scale - origin.x;
          const y = (ghost.base.y + (ghost.target.y - ghost.base.y) * progress) * scale - origin.y;
          ctx.globalAlpha = ghost.alpha * (1 - progress);
          draw(ghost.sprite, x, y);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    if (this.pendingSwap) {
      this.pendingSwap.canvas.replaceWith(this.canvas); this.pendingSwap.batch.dispose(); this.pendingSwap = undefined;
    }
    this.full = false; this.dirty = [];
    const viewport = { x: this.viewportOffset.x, y: this.viewportOffset.y, width: viewportSize.x, height: viewportSize.y };
    for (const entry of this.active) {
      if (entry.motion.state?.appearing && now >= entry.motion.fadeStart + 150) {
        setMarkerState(entry.marker, { appearing: false });
      }
      if (!entry.motion.active(now) && !entry.offsetX?.active(now) && !entry.offsetY?.active(now) && !entry.reveal?.active(now)) this.active.delete(entry);
    }
    if (this.animation || this.ghosts.size || [...this.active].some(entry => intersects(bounds(entry), viewport))) this.request();
  };
  private paintBatch(now: number): void {
    let clip: Rect | undefined, candidates = this.ordered;
    if (!this.full && this.dirty.length) {
      let left = this.width, top = this.height, right = 0, bottom = 0;
      for (const rect of this.dirty) {
        const x = Math.max(0, rect.x), y = Math.max(0, rect.y);
        const r = Math.min(this.width, rect.x + rect.width), b = Math.min(this.height, rect.y + rect.height);
        if (r <= x || b <= y) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, r); bottom = Math.max(bottom, b);
      }
      if (right <= left || bottom <= top) { clip = { x: 0, y: 0, width: 0, height: 0 }; candidates = []; }
      else {
        const area = { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right) - Math.floor(left) + 2, height: Math.ceil(bottom) - Math.floor(top) + 2 };
        if (area.width * area.height < this.width * this.height * 0.75) {
          clip = area;
          // Cull coarse spatial cells precisely; dense changes reuse the existing
          // paint order instead of sorting thousands of points every frame.
          const found = this.query(area);
          if (found.size > this.ordered.length / 2) candidates = this.ordered.filter(entry => entry.visible && intersects(bounds(entry), area));
          else candidates = [...found].filter(entry => entry.visible && intersects(bounds(entry), area)).sort(compareEntries);
        }
      }
    }
    const batch = this.batch!;
    batch.begin(this.canvas.width, this.canvas.height, this.renderRatio, candidates.length + 2 * this.active.size + this.ghosts.size, clip);
    for (const entry of candidates) {
      if (!entry.visible) continue;
      if (!this.painter.isArtReady(entry.art)) continue;
      const alpha = entry.opacity * entry.motion.opacity(now) * (entry.reveal?.value(now) ?? 1);
      if (alpha <= 0) continue;
      const parts = this.pulseParts(entry, now, alpha);
      if (parts) {
        if (!entry.usingPulseLayers) { batch.release(entry); entry.usingPulseLayers = true; }
        const keys = entry.pulseKeys ??= [{}, {}, {}];
        if (parts.underlay) batch.add(keys[0], parts.underlay, entry.x, entry.y, 1);
        batch.add(keys[1], this.painter.pulse(entry.motion, now), entry.x,
          entry.y + (entry.art.noFrame ? entry.motion.shift.target : -16), 1);
        batch.add(keys[2], parts.overlay, entry.x, entry.y, 1);
      } else {
        if (entry.usingPulseLayers) this.releasePulse(entry);
        const sprite = entry.sprite ?? (entry.motion.paintActive(now) ? (entry.animatedSprite ??= this.painter.animation(entry.art, entry.motion)).render(now)
          : entry.sprite = this.painter.gpuSprite(entry.art, entry.motion, now));
        batch.add(entry, sprite, entry.x, entry.y, alpha);
      }
    }
    const origin = this.map.getPixelOrigin().add(this.canvasOffset ?? L.point(0, 0)), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    for (const ghost of this.ghosts.values()) {
      const progress = ease((now - ghost.start) / 320, [0.6, 0, 0, 1]);
      batch.add(ghost, ghost.sprite, (ghost.base.x + (ghost.target.x - ghost.base.x) * progress) * scale - origin.x,
        (ghost.base.y + (ghost.target.y - ghost.base.y) * progress) * scale - origin.y, ghost.alpha * (1 - progress));
    }
    batch.end();
  }

  private move = (event: L.LeafletEvent & { pinch?: boolean }): void => {
    // A discrete zoom replaces cluster groups later in this event dispatch. Do
    // not paint thousands of outgoing points or admit their offscreen ghosts.
    if (this.zooming && !this.animation && !event.pinch) { this.full = true; this.request(); return; }
    // Fractional wheel/pinch zoom already runs in rAF and paints in that frame.
    if (!this.animation) this.draw(performance.now());
  };
  private cancelTrim = (): void => { clearTimeout(this.trimTimer); this.trimTimer = undefined; };
  private retireRegion = (): void => {
    this.trimPending = true; this.cancelTrim();
    this.animation = undefined; this.zooming = false;
    for (const ghost of this.ghosts.values()) this.batch?.release(ghost);
    this.ghosts.clear();
    this.pressed = undefined; this.setHovered(undefined);
    // Retire the previous region before its coordinate space changes.
    // GPU composition also presents into a 2D output. Clearing it directly is
    // safe even between context loss and the queued fallback notification.
    for (const canvas of this.pendingSwap ? [this.canvas, this.pendingSwap.canvas] : [this.canvas]) {
      const context = canvas.getContext('2d')!;
      context.save(); context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height); context.restore();
    }
    this.full = true;
  };
  private commitRegion = (): void => { this.draw(performance.now()); this.queueTrim(); };
  private queueTrim = (): void => {
    this.cancelTrim();
    if (!this.trimPending || this.disposed) return;
    this.trimTimer = setTimeout(() => {
      this.trimTimer = undefined;
      if (this.animation || this.zooming || this.ghosts.size || this.moving.size) { this.queueTrim(); return; }
      this.trimPending = false;
      this.painter.retainAssets(new Set([...this.entries.values()].flatMap(entry => [entry.art.image, entry.art.subImage])));
      try { this.batch?.compact(); }
      catch { this.fallback2D('atlas compaction failed'); }
    }, 500);
  };
  private zoomStart = (): void => { this.zooming = true; };
  private zoom = (event: L.ZoomAnimEvent): void => {
    this.animation = { start: performance.now(), from: new Map(this.ordered.map(entry => [entry, Number.isFinite(entry.x) ? L.point(entry.x, entry.y).subtract(this.viewportOffset) : this.map.latLngToContainerPoint(entry.latlng)])),
      zoom: event.zoom, center: event.center };
    for (const entry of this.entries.values()) { entry.offsetX?.jump(0); entry.offsetY?.jump(0); }
    this.moving.clear();
    this.request();
  };
  private zoomEnd = (): void => { this.zooming = false; this.animation = undefined; this.full = true; this.request(); };
  private hit(event: MouseEvent): Entry | undefined {
    if (isRegionSwitching(this.map)) return;
    const target = event.target as Element | null;
    if (target?.nodeType === 1 && target.closest('.leaflet-control,button,input,select,textarea,a,[role="button"],.leaflet-marker-icon')) return undefined;
    const point = this.map.mouseEventToContainerPoint(event).add(this.viewportOffset);
    let hit: Entry | undefined;
    for (const entry of this.query({ x: point.x, y: point.y, width: 0, height: 0 })) {
      if (!entry.marker.options.interactive || getMarkerState(entry.marker).opacity === 0) continue;
      const size = entry.art.noFrame ? 50 : 32;
      const y = entry.y + (entry.art.noFrame ? entry.motion.shift.value(performance.now()) : -16);
      if (Math.abs(point.x - entry.x) <= size / 2 && Math.abs(point.y - y) <= size / 2
        && (!hit || compareEntries(entry, hit) > 0)) hit = entry;
    }
    return hit;
  }
  private dispatch(entry: Entry, type: string, event: Event = new MouseEvent(type)): void {
    // Leaflet's Canvas event adapter retains originalEvent, preclick, marker coordinates,
    // FeatureGroup propagation and bubblingMouseEvents without a synthetic DOM target.
    (this.map as L.Map & { _fireDOMEvent(event: Event, type: string, targets: L.Layer[]): void })
      ._fireDOMEvent(event, type, [entry.marker]);
  }
  private setHovered(entry?: Entry, event?: MouseEvent): void {
    if (entry === this.hovered) return;
    const previous = this.hovered; this.hovered = entry;
    if (previous) {
      this.read(previous, performance.now()); this.dispatch(previous, 'pointerout', event); this.dispatch(previous, 'mouseout', event);
    }
    if (entry) {
      this.read(entry, performance.now()); this.dispatch(entry, 'pointerover', event); this.dispatch(entry, 'mouseover', event);
    }
    this.map.getContainer().style.cursor = entry ? 'pointer' : '';
  }
  private nativeTarget(event: Event): boolean {
    return !!event.target && this.semantic.contains(event.target as Node);
  }
  private pointerMove = (event: PointerEvent): void => {
    if (this.nativeTarget(event)) return;
    this.pointer = event;
    this.setHovered(event.buttons ? undefined : this.hit(event), event);
  };
  private pointerLeave = (): void => { this.pointer = undefined; this.setHovered(undefined); };
  private pointerDown = (event: PointerEvent): void => {
    if (!this.nativeTarget(event)) this.pressed = { entry: this.hit(event), x: event.clientX, y: event.clientY };
  };
  private click = (event: MouseEvent): void => {
    if (this.nativeTarget(event)) return;
    const entry = this.hit(event);
    if (!entry) return;
    // Canvas targets bypass Leaflet's DOM target search, including its drag guard.
    if ((this.map as L.Map & { _draggableMoved(layer: L.Layer): boolean })._draggableMoved(entry.marker)) {
      this.pressed = undefined; return;
    }
    if (this.pressed && (this.pressed.entry !== entry || Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y) > 3)) return;
    event.stopImmediatePropagation(); event.preventDefault();
    this.dispatch(entry, 'click', event); this.pressed = undefined;
  };
  private doubleClick = (event: MouseEvent): void => {
    if (this.nativeTarget(event)) return;
    const entry = this.hit(event);
    if (entry) { event.stopImmediatePropagation(); event.preventDefault(); this.dispatch(entry, 'dblclick', event); }
  };
  private contextMenu = (event: MouseEvent): void => {
    if (this.nativeTarget(event)) return;
    if (event.altKey) return;
    const entry = this.hit(event);
    if (!entry) return;
    event.stopImmediatePropagation(); event.preventDefault();
    this.dispatch(entry, 'contextmenu', event);
  };
  private refreshProxy(): void {
    if (!this.focused) for (const entry of this.entries.values()) {
      if (entry.marker.options.keyboard && entry.marker.options.interactive) { this.focused = entry; break; }
    }
    const icon = this.focused?.marker.options.icon;
    const tabIndex = this.focused ? 0 : -1, label = icon instanceof SceneIcon ? icon.label : 'Map markers';
    if (this.proxy.tabIndex !== tabIndex) this.proxy.tabIndex = tabIndex;
    if (this.proxy.getAttribute('aria-label') !== label) this.proxy.setAttribute('aria-label', label);
  }
  private focus = (): void => {
    if (this.focused) { this.changed.add(this.focused); this.request(); }
  };
  private keyDown = (event: KeyboardEvent): void => {
    const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!delta) return;
    const entries = this.ordered.filter(entry => entry.marker.options.keyboard && entry.marker.options.interactive);
    if (!entries.length) return;
    event.preventDefault(); event.stopPropagation();
    if (this.focused) this.changed.add(this.focused);
    this.focused = entries[(entries.indexOf(this.focused!) + delta + entries.length) % entries.length];
    this.refreshProxy(); this.changed.add(this.focused); this.request();
    if (!this.map.getBounds().contains(this.focused.latlng)) this.map.panTo(this.focused.latlng);
  };
  private proxyClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (this.focused) this.dispatch(this.focused, 'click', event);
  };
  private fontsLoaded = (): void => {
    if (this.disposed) return;
    this.readOfficialStyles(false);
    this.painter.fontVersion++;
    for (const entry of this.entries.values()) if (entry.art.tier || entry.art.count) this.invalidate(entry);
  };
  private dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.painter.dispose();
    this.cancelTrim();
    this.batch?.dispose(); this.pendingSwap?.batch.dispose();
    this.map.off('move resize viewreset', this.move); this.map.off('zoomstart', this.zoomStart); this.map.off('zoomanim', this.zoom); this.map.off('zoomend', this.zoomEnd); this.map.off('unload', this.dispose);
    this.map.off('talos:regionSwitchStart', this.retireRegion);
    this.map.off('talos:regionSwitched', this.commitRegion);
    this.map.off('moveend', this.queueTrim); this.map.off('movestart', this.cancelTrim);
    const container = this.map.getContainer();
    container.removeEventListener('pointermove', this.pointerMove, true); container.removeEventListener('pointerleave', this.pointerLeave);
    container.removeEventListener('pointerdown', this.pointerDown, true); container.removeEventListener('click', this.click, true); container.removeEventListener('dblclick', this.doubleClick, true);
    container.removeEventListener('contextmenu', this.contextMenu, true);
    this.proxy.removeEventListener('keydown', this.keyDown); this.proxy.removeEventListener('click', this.proxyClick);
    this.semantic.removeEventListener('focusin', this.focus); this.semantic.removeEventListener('focusout', this.focus);
    document.fonts?.removeEventListener('loadingdone', this.fontsLoaded);
    this.resolution?.removeEventListener('change', this.displayChanged);
    window.removeEventListener('resize', this.displayChanged);
    this.canvas.remove(); this.pendingSwap?.canvas.remove(); this.semantic.remove(); container.style.cursor = '';
    this.entries.clear(); this.onscreen.clear(); this.grid.clear(); this.ordered = []; this.active.clear(); this.moving.clear(); this.changed.clear(); this.pendingMotion.clear(); this.animation = undefined; this.ghosts.clear(); this.artEntries.clear();
    this.focused = undefined; this.hovered = undefined; this.pointer = undefined; this.pressed = undefined;
    surfaces.delete(this.map);
  };
}
