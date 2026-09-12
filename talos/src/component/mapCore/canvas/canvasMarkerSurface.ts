import L from 'leaflet';
import { MarkerMotion, MarkerMotionPool, Motion, ease } from './canvasMarkerMotion';
import { MarkerPainter, type MarkerArt, type Sprite, type AnimatedSprite } from './canvasMarkerPaint';
import { markerClasses as classes } from './canvasMarkerStyle';
import { CanvasSpriteBatch } from './canvasSpriteBatch';

type CanvasMarker = L.Marker;
interface Entry {
  marker: CanvasMarker; root: HTMLElement; inner: HTMLElement; art: MarkerArt; motion: MarkerMotion;
  x: number; y: number; base: L.Point; latlng: L.LatLng; order: number; completed: boolean; opacity: number;
  offsetX?: Motion; offsetY?: Motion;
  artDirty: boolean;
  sprite?: Sprite;
  animatedSprite?: AnimatedSprite;
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
const has = (element: HTMLElement, name: string) => element.classList.contains(classes[name]);
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
  private roots = new WeakMap<Node, Entry>();
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
  private iconTemplates = new Map<string, HTMLElement>();
  private pendingMotion = new Set<Entry>();
  private ghosts: Ghost[] = [];
  private clusterTransition = false;
  private sequence = 0;
  private frame = 0;
  private disposed = false;
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
  private context?: CanvasRenderingContext2D;
  private batch?: CanvasSpriteBatch;
  private pendingSwap?: { canvas: HTMLCanvasElement; batch: CanvasSpriteBatch };
  private backendReason?: string;
  private semantic = document.createElement('div');
  private style = document.createElement('style');
  private painter: MarkerPainter;
  private observer: MutationObserver;

  constructor(private map: L.Map) {
    this.batch = CanvasSpriteBatch.create(this.canvas, () => this.fallback2D('graphics context lost'));
    if (!this.batch) { this.canvas = document.createElement('canvas'); this.context = this.canvas.getContext('2d')!; }
    this.canvas.className = 'oem-canvas-markers';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:1;';
    // Connected compatibility nodes keep existing store mutations, links and keyboard events.
    // They are clipped and never used to paint a point or as a per-frame hit target.
    this.semantic.className = 'oem-canvas-semantics';
    this.semantic.style.cssText = 'position:absolute;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;clip-path:inset(100%);contain:strict;content-visibility:auto;pointer-events:none;';
    this.style.textContent = '.oem-canvas-semantics *{animation:none!important;transition:none!important;will-change:auto!important;}';
    map.getPane('markerPane')!.append(this.canvas, this.semantic, this.style);
    // Both the viewport and cached artwork retain at least Retina-density pixels.
    // Integer sprite density also avoids fractional texture-bound rounding.
    this.painter = new MarkerPainter(Math.ceil(this.renderRatio), url => {
      for (const entry of this.entries.values()) {
        if (entry.art.image === url || entry.art.subImage === url || entry.art.subImage
          && (url === this.painter.hoverDecoration || url === this.painter.selectedDecoration)) this.invalidate(entry);
      }
    }, this.batch ? () => this.fallback2D('image does not allow GPU texture access') : undefined);
    this.readOfficialStyles();
    this.observer = new MutationObserver(records => {
      for (const record of records) {
        let node: Node | null = record.target;
        while (node && node !== this.semantic) {
          const entry = this.roots.get(node);
          if (entry) {
            if (record.type === 'childList' || record.attributeName === 'src' || record.attributeName === 'data-tier') entry.artDirty = true;
            this.changed.add(entry); break;
          }
          node = node.parentNode;
        }
      }
      if (this.changed.size) this.request();
    });
    this.observer.observe(this.semantic, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'data-tier', 'src', 'style', 'tabindex', 'data-oem-point'] });
    const container = map.getContainer();
    container.addEventListener('pointermove', this.pointerMove, true);
    container.addEventListener('pointerleave', this.pointerLeave);
    container.addEventListener('pointerdown', this.pointerDown, true);
    container.addEventListener('click', this.click, true);
    container.addEventListener('dblclick', this.doubleClick, true);
    this.semantic.addEventListener('focusin', this.focus);
    this.semantic.addEventListener('focusout', this.focus);
    document.fonts?.addEventListener('loadingdone', this.fontsLoaded);
    this.watchResolution();
    window.addEventListener('resize', this.displayChanged);
    map.on('move resize viewreset', this.move);
    map.on('zoomanim', this.zoom);
    map.on('zoomend', this.zoomEnd);
    map.on('unload', this.dispose);
  }
  place(marker: CanvasMarker, point?: L.Point): void {
    const root = marker.getElement();
    if (!root) return;
    let entry = this.entries.get(marker);
    if (entry && entry.root !== root) { this.remove(marker, false); entry = undefined; }
    if (!entry) {
      const inner = root.querySelector<HTMLElement>(`.${classes.markerInner},.${classes.noFrameInner}`);
      if (!inner) return;
      entry = { marker, root, inner, art: { image: '', subImage: '', noFrame: has(inner, 'noFrameInner'), tier: '' },
        motion: this.motionPool.initial, x: NaN, y: NaN, base: this.map.project(marker.getLatLng(), 0), latlng: marker.getLatLng(), artDirty: true,
        order: this.sequence++, completed: false, stack: 1, opacity: 1 };
      this.entries.set(marker, entry); this.roots.set(root, entry);
      this.reorder = true; this.indexDirty = true;
      this.changed.add(entry);
    }
    if (entry.latlng !== marker.getLatLng()) {
      entry.latlng = marker.getLatLng(); entry.base = this.map.project(entry.latlng, 0);
      this.indexDirty = true;
    }
    if (point) {
      // Keep Leaflet's logical position without creating a DOM transform or forcing layout.
      (root as HTMLElement & { _leaflet_pos: L.Point })._leaflet_pos = point;
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
    if (root.parentNode !== this.semantic) this.semantic.appendChild(root);
    (marker as unknown as { _shadow?: HTMLElement })._shadow?.remove();
    // Native _setPos would create thousands of DOM transform/style invalidations here.
    this.full = true; this.request();
  }
  getIconTemplate(icon: L.DivIcon, html: string): HTMLElement {
    let template = this.iconTemplates.get(html);
    if (!template) {
      template = icon.createIcon();
      if (this.iconTemplates.size >= 256) this.iconTemplates.delete(this.iconTemplates.keys().next().value!);
      this.iconTemplates.set(html, template);
    }
    return template;
  }
  getSemanticPane(): HTMLElement { return this.semantic; }
  private readOfficialStyles(loadFonts = true): void {
    // A tiny live probe reads CSS once. The semantic tree can then skip layout while offscreen,
    // retaining keyboard/accessibility semantics through content-visibility:auto.
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
    this.batch?.release(entry);
    if (this.clusterTransition && entry.visible) {
      const now = performance.now();
      const sprite = entry.sprite ?? (entry.motion.paintActive(now) ? this.painter.snapshot(entry.art, entry.motion, now)
        : this.painter.sprite(entry.art, entry.motion, now));
      const base = this.map.project(this.visualPosition(marker) ?? entry.latlng, 0);
      this.ghosts.push({ marker, sprite, base, target: base, alpha: entry.opacity * entry.motion.opacity(now), start: NaN });
    }
    if (this.hovered === entry) this.setHovered(undefined);
    this.dirty.push(bounds(entry)); this.entries.delete(marker); this.roots.delete(entry.root);
    this.active.delete(entry); this.moving.delete(entry); this.changed.delete(entry); this.pendingMotion.delete(entry); this.reorder = true; this.full = true; this.indexDirty = true;
    // Keep the instance through an atomic cluster replacement (including an empty intermediate set).
    // unload owns final disposal; empty filter sets also reuse decoded assets on their next update.
    void disposeEmpty;
    this.request();
  }
  visualPosition(marker: L.Marker): L.LatLng | undefined {
    const entry = this.entries.get(marker);
    return entry && (Number.isFinite(entry.x) ? this.map.containerPointToLatLng([entry.x, entry.y]) : entry.latlng);
  }
  beginClusterTransition(): void { this.clusterTransition = true; }
  endClusterTransition(): void { this.clusterTransition = false; this.full = true; this.request(); }
  animateFrom(marker: L.Marker, origin: L.LatLng, introducing = false): void {
    const entry = this.entries.get(marker);
    if (!entry) return;
    const start = this.map.latLngToContainerPoint(origin), target = this.map.latLngToContainerPoint(entry.latlng);
    (entry.offsetX ??= new Motion(0)).jump(start.x - target.x); (entry.offsetY ??= new Motion(0)).jump(start.y - target.y);
    this.moving.add(entry);
    entry.clusterUntil = Infinity;
    const same = this.ghosts.find(ghost => ghost.marker === marker);
    if (same) { this.batch?.release(same); this.ghosts = this.ghosts.filter(ghost => ghost !== same); }
    else if (introducing) entry.reveal = new Motion(0);
    this.pendingMotion.add(entry); this.changed.add(entry); this.full = true;
  }
  animateRemovedTo(marker: L.Marker, target: L.LatLng): void {
    for (const ghost of this.ghosts) if (ghost.marker === marker) ghost.target = this.map.project(target, 0);
  }
  private read(entry: Entry, now: number): void {
    const { root } = entry;
    if (entry.artDirty) entry.inner = root.querySelector<HTMLElement>(`.${classes.markerInner},.${classes.noFrameInner}`) ?? entry.inner;
    const { inner } = entry;
    if (entry.clusterUntil && has(inner, 'appearing')) {
      // A deferred plugin fade-in must not restart when the user hovers after the expansion.
      inner.classList.remove(classes.appearing);
    }
    if (entry.clusterUntil && now >= entry.clusterUntil) entry.clusterUntil = undefined;
    if (entry.artDirty) {
      const image = inner.querySelector<HTMLImageElement>('img');
      const sub = inner.querySelector<HTMLElement>(`.${classes.subIcon}`);
      const background = (node?: HTMLElement | null) => node?.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] ?? '';
      entry.art = { noFrame: has(inner, 'noFrameInner'), image: image?.getAttribute('src') ?? background(inner.firstElementChild as HTMLElement),
        subImage: sub instanceof HTMLImageElement ? sub.getAttribute('src') ?? '' : background(sub), tier: inner.dataset.tier ?? '',
        count: inner.querySelector(`.${classes.clusterCount}`)?.textContent ?? undefined };
      this.painter.preload(entry.art.image); this.painter.preload(entry.art.subImage); entry.artDirty = false;
    }
    const completed = has(root, 'completedMarker');
    if (entry.completed !== completed) { entry.completed = completed; this.reorder = true; }
    this.updateStack(entry);
    entry.opacity = root.style.opacity === '' ? 1 : Number(root.style.opacity);
    const flags = +has(inner, 'selected') | (+has(inner, 'checked') << 1) | (+has(inner, 'offLayer') << 2)
      | (+(this.hovered === entry) << 3) | (+root.contains(document.activeElement) << 4) | (+has(inner, 'pulsing') << 5)
      | (+(has(inner, 'appearing') && !(entry.clusterUntil && now < entry.clusterUntil)) << 6) | (+has(inner, 'disappearing') << 7);
    entry.motion = this.motionPool.transition(entry.motion, flags, now, entry.art.noFrame, !!entry.art.count);
    this.invalidate(entry);
  }
  private invalidate(entry: Entry): void {
    entry.sprite = undefined;
    entry.animatedSprite = undefined;
    this.dirty.push(bounds(entry)); this.active.add(entry); this.request();
  }
  private updateStack(entry: Entry): void {
    const stack = entry.art.count ? 2 : entry.completed ? 0 : 1;
    if (stack !== entry.stack) { entry.stack = stack; this.reorder = true; }
  }
  private request(): void {
    if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.draw);
  }
  private fallback2D(reason: string): void {
    if (!this.batch || this.disposed) return;
    this.backendReason = reason;
    this.pendingSwap = { canvas: this.canvas, batch: this.batch };
    this.batch = undefined;
    this.canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
    this.context = this.canvas.getContext('2d')!;
    this.full = true; this.request();
  }
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
    for (const entry of this.pendingMotion) {
      entry.offsetX?.to(0, now, 320); entry.offsetY?.to(0, now, 320); entry.reveal?.to(1, now, 160); entry.clusterUntil = now + 320;
    }
    this.pendingMotion.clear();
    for (const entry of this.changed) this.read(entry, now);
    this.changed.clear();
    for (const ghost of this.ghosts) if (!Number.isFinite(ghost.start)) ghost.start = now;
    if (this.ghosts.length) {
      this.full = true;
      this.ghosts = this.ghosts.filter(ghost => { if (now < ghost.start + 320) return true; this.batch?.release(ghost); return false; });
    }
    if (this.reorder) {
      this.ordered = [...this.entries.values()].sort(compareEntries);
      this.reorder = false; this.full = true;
    }
    if (this.indexDirty) this.rebuildIndex();
    const size = this.map.getSize();
    const pixelWidth = Math.ceil(size.x * this.renderRatio), pixelHeight = Math.ceil(size.y * this.renderRatio);
    if (size.x !== this.width || size.y !== this.height || this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.width = size.x; this.height = size.y;
      this.canvas.width = pixelWidth; this.canvas.height = pixelHeight;
      // Preserve the CSS coordinate space; the browser downsamples the complete scene
      // when physical DPR is lower than our internal rendering density.
      this.canvas.style.width = `${pixelWidth / this.renderRatio}px`; this.canvas.style.height = `${pixelHeight / this.renderRatio}px`; this.full = true;
    }
    const offset = this.map.containerPointToLayerPoint(L.point(0, 0));
    L.DomUtil.setPosition(this.canvas, offset);
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
          entry.x = from ? from.x + (targetX - from.x) * progress : targetX;
          entry.y = from ? from.y + (targetY - from.y) * progress : targetY;
        } else {
          entry.x = entry.base.x * scale - origin.x + (entry.offsetX?.value(now) ?? 0);
          entry.y = entry.base.y * scale - origin.y + (entry.offsetY?.value(now) ?? 0);
        }
      }
      this.full = true;
      for (const entry of this.ordered) {
        const visible = entry.x + (entry.art.subImage ? 66 : 38) > 0 && entry.x - 38 < this.width
          && entry.y + 40 > 0 && entry.y - 54 < this.height;
        if (entry.visible && !visible) { this.batch?.release(entry); entry.marker.fire('viewporthide'); }
        entry.visible = visible;
      }
      if (this.pointer && !this.pointer.buttons) this.setHovered(this.hit(this.pointer), this.pointer);
      // Include the terminal frame before retiring motion; otherwise the previous subpixel pose sticks.
      for (const entry of this.moving) if (!entry.offsetX?.active(now) && !entry.offsetY?.active(now)) this.moving.delete(entry);
    }
    for (const entry of this.active) this.dirty.push(bounds(entry));
    if (this.dirty.length > 32) this.full = true;
    if (this.batch && this.width > 0 && this.height > 0) {
      try { this.paintBatch(now); }
      catch (error) { this.fallback2D(error instanceof Error ? error.message : 'GPU raster unavailable'); }
    }
    if (!this.batch) {
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
          for (const entry of this.query(aligned)) found.add(entry);
        }
        ctx.clip(); ctx.clearRect(0, 0, this.width, this.height);
        ctx.beginPath();
        candidates = [...found].sort(compareEntries);
      }
      for (const entry of candidates) {
        if (!entry.visible) continue;
        ctx.globalAlpha = entry.opacity * entry.motion.opacity(now) * (entry.reveal?.value(now) ?? 1);
        const sprite = entry.sprite ?? (entry.motion.paintActive(now) ? (entry.animatedSprite ??= this.painter.animation(entry.art, entry.motion)).render(now)
          : entry.sprite = this.painter.sprite(entry.art, entry.motion, now));
        ctx.drawImage(sprite.canvas, entry.x + sprite.x, entry.y + sprite.y, sprite.width, sprite.height);
      }
      if (this.ghosts.length) {
        const origin = this.map.getPixelOrigin().add(offset), scale = this.map.getZoomScale(this.map.getZoom(), 0);
        for (const ghost of this.ghosts) {
          const progress = ease((now - ghost.start) / 320, [0.6, 0, 0, 1]);
          const x = (ghost.base.x + (ghost.target.x - ghost.base.x) * progress) * scale - origin.x;
          const y = (ghost.base.y + (ghost.target.y - ghost.base.y) * progress) * scale - origin.y;
          ctx.globalAlpha = ghost.alpha * (1 - progress);
          ctx.drawImage(ghost.sprite.canvas, x + ghost.sprite.x, y + ghost.sprite.y, ghost.sprite.width, ghost.sprite.height);
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    if (this.pendingSwap) {
      this.pendingSwap.canvas.replaceWith(this.canvas); this.pendingSwap.batch.dispose(); this.pendingSwap = undefined;
    }
    this.full = false; this.dirty = [];
    const viewport = { x: 0, y: 0, width: this.width, height: this.height };
    for (const entry of this.active) {
      if (entry.motion.state?.appearing && now >= entry.motion.fadeStart + 150) {
        // The scene owns appearance cleanup; semantic nodes do not run CSS animations.
        entry.inner.classList.remove(classes.appearing);
      }
      if (!entry.motion.active(now) && !entry.offsetX?.active(now) && !entry.offsetY?.active(now) && !entry.reveal?.active(now)) this.active.delete(entry);
    }
    if (this.animation || this.ghosts.length || [...this.active].some(entry => intersects(bounds(entry), viewport))) this.request();
  };
  private paintBatch(now: number): void {
    const batch = this.batch!;
    let clip: Rect | undefined, candidates = this.ordered;
    if (!this.full && this.dirty.length) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const rect of this.dirty) { left = Math.min(left, rect.x); top = Math.min(top, rect.y); right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height); }
      clip = { x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right) - Math.floor(left) + 2, height: Math.ceil(bottom) - Math.floor(top) + 2 };
      candidates = [...this.query(clip)].sort(compareEntries);
    }
    batch.begin(this.canvas.width, this.canvas.height, this.renderRatio, candidates.length + this.ghosts.length, clip);
    for (const entry of candidates) {
      if (!entry.visible) continue;
      const alpha = entry.opacity * entry.motion.opacity(now) * (entry.reveal?.value(now) ?? 1);
      if (alpha <= 0) continue;
      const sprite = entry.sprite ?? (entry.motion.paintActive(now) ? (entry.animatedSprite ??= this.painter.animation(entry.art, entry.motion)).render(now)
        : entry.sprite = this.painter.sprite(entry.art, entry.motion, now));
      batch.add(entry, sprite, entry.x, entry.y, alpha);
    }
    const origin = this.map.getPixelOrigin().add(this.map.containerPointToLayerPoint(L.point(0, 0))), scale = this.map.getZoomScale(this.map.getZoom(), 0);
    for (const ghost of this.ghosts) {
      const progress = ease((now - ghost.start) / 320, [0.6, 0, 0, 1]);
      batch.add(ghost, ghost.sprite, (ghost.base.x + (ghost.target.x - ghost.base.x) * progress) * scale - origin.x,
        (ghost.base.y + (ghost.target.y - ghost.base.y) * progress) * scale - origin.y, ghost.alpha * (1 - progress));
    }
    batch.end();
  }
  private move = (): void => {
    this.full = true;
    // Fractional wheel zoom already runs in rAF. Paint in that frame with the new tile origin.
    if (!this.animation) this.draw(performance.now());
  };
  private zoom = (event: L.ZoomAnimEvent): void => {
    this.animation = { start: performance.now(), from: new Map(this.ordered.map(entry => [entry, Number.isFinite(entry.x) ? L.point(entry.x, entry.y) : this.map.latLngToContainerPoint(entry.latlng)])),
      zoom: event.zoom, center: event.center };
    for (const entry of this.entries.values()) { entry.offsetX?.jump(0); entry.offsetY?.jump(0); }
    this.moving.clear();
    this.request();
  };
  private zoomEnd = (): void => { this.animation = undefined; this.full = true; this.draw(performance.now()); };
  private hit(event: MouseEvent): Entry | undefined {
    if (event.target instanceof Element && event.target.closest('.leaflet-control,button,input,select,textarea,a,[role="button"],.leaflet-marker-icon')) return undefined;
    const point = this.map.mouseEventToContainerPoint(event);
    let hit: Entry | undefined;
    for (const entry of this.query({ x: point.x, y: point.y, width: 0, height: 0 })) {
      if (!(entry.marker.options.interactive || entry.root.classList.contains('leaflet-interactive')) || entry.opacity === 0) continue;
      const size = entry.art.noFrame ? 50 : 32;
      const y = entry.y + (entry.art.noFrame ? entry.motion.shift.value(performance.now()) : -16);
      if (Math.abs(point.x - entry.x) <= size / 2 && Math.abs(point.y - y) <= size / 2
        && (!hit || compareEntries(entry, hit) > 0)) hit = entry;
    }
    return hit;
  }
  private dispatch(entry: Entry, type: string, event?: MouseEvent): void {
    const init: MouseEventInit = { bubbles: true, cancelable: true, clientX: event?.clientX, clientY: event?.clientY,
      screenX: event?.screenX, screenY: event?.screenY, ctrlKey: event?.ctrlKey, metaKey: event?.metaKey,
      shiftKey: event?.shiftKey, altKey: event?.altKey, button: event?.button, detail: event?.detail ?? 1 };
    entry.inner.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init));
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
    return event.target instanceof Node && this.semantic.contains(event.target);
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
    if (this.pressed && (this.pressed.entry !== entry || Math.hypot(event.clientX - this.pressed.x, event.clientY - this.pressed.y) > 3)) return;
    event.stopImmediatePropagation(); event.preventDefault();
    this.dispatch(entry, 'click', event); this.pressed = undefined;
  };
  private doubleClick = (event: MouseEvent): void => {
    if (this.nativeTarget(event)) return;
    const entry = this.hit(event);
    if (entry) { event.stopImmediatePropagation(); event.preventDefault(); this.dispatch(entry, 'dblclick', event); }
  };
  private focus = (event: FocusEvent): void => {
    let node = event.target as Node | null;
    while (node && node !== this.semantic) {
      const entry = this.roots.get(node);
      if (entry) {
        this.changed.add(entry); this.request();
        if (event.type === 'focusin' && !this.map.getBounds().contains(entry.latlng)) this.map.panTo(entry.latlng);
        break;
      }
      node = node.parentNode;
    }
  };
  private fontsLoaded = (): void => {
    if (this.disposed) return;
    this.readOfficialStyles(false);
    this.painter.fontVersion++;
    for (const entry of this.entries.values()) if (entry.art.tier || entry.art.count) this.invalidate(entry);
  };
  private dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect(); this.painter.dispose();
    this.batch?.dispose(); this.pendingSwap?.batch.dispose();
    this.iconTemplates.clear();
    this.map.off('move resize viewreset', this.move); this.map.off('zoomanim', this.zoom); this.map.off('zoomend', this.zoomEnd); this.map.off('unload', this.dispose);
    const container = this.map.getContainer();
    container.removeEventListener('pointermove', this.pointerMove, true); container.removeEventListener('pointerleave', this.pointerLeave);
    container.removeEventListener('pointerdown', this.pointerDown, true); container.removeEventListener('click', this.click, true); container.removeEventListener('dblclick', this.doubleClick, true);
    this.semantic.removeEventListener('focusin', this.focus); this.semantic.removeEventListener('focusout', this.focus);
    document.fonts?.removeEventListener('loadingdone', this.fontsLoaded);
    this.resolution?.removeEventListener('change', this.displayChanged);
    window.removeEventListener('resize', this.displayChanged);
    this.canvas.remove(); this.pendingSwap?.canvas.remove(); this.semantic.remove(); this.style.remove(); container.style.cursor = '';
    this.entries.clear(); this.grid.clear(); this.ordered = []; this.active.clear(); this.moving.clear(); this.changed.clear(); this.pendingMotion.clear(); this.animation = undefined; this.ghosts = [];
    surfaces.delete(this.map);
  };
}
