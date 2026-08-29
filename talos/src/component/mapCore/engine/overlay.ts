/**
 * DOM overlay system on top of MapLibre's camera. Reproduces the subset of
 * Leaflet's DOM structure the codebase depends on: named panes with z-index,
 * marker elements with `leaflet-marker-icon` classes + iconAnchor offsets,
 * SVG vector paths, and image overlays — all repositioned every render frame
 * so overlays stay glued to the map during smooth fractional zoom.
 */
import { Point } from './point';
import { LatLng, LatLngBounds, toLatLng, toLatLngBounds, type LatLngExpression, type LatLngBoundsExpression } from './latlng';
import { createIconElement, type CompatIcon } from './icon';

/** Surface the overlay layers attach to. Implemented by TalosMap. */
export interface OverlayHost {
    latLngToContainerPoint(value: LatLngExpression): Point;
    containerPointToLatLng(point: Point): LatLng;
    getPane(name: string): HTMLElement | undefined;
    /** Register a per-frame render callback; returns unsubscribe. */
    onRender(callback: () => void): () => void;
    /** Disable/enable map panning while a marker is being dragged. */
    setMapDraggingEnabled(enabled: boolean): void;
    /** Track top-level attachments so eachLayer/removeLayer see every layer. */
    _registerLayerAttachment(layer: CompatLayer, attached: boolean): void;
}

type EventHandler = (event?: unknown) => void;

export class CompatEvented {
    private listeners: Record<string, Set<EventHandler>> = {};

    on<T = unknown>(type: string, handler: (event: T) => void): this {
        (this.listeners[type] ??= new Set()).add(handler as EventHandler);
        return this;
    }

    off<T = unknown>(type: string, handler: (event: T) => void): this {
        this.listeners[type]?.delete(handler as EventHandler);
        return this;
    }

    once<T = unknown>(type: string, handler: (event: T) => void): this {
        const wrapped: EventHandler = (event) => {
            this.off(type, wrapped);
            handler(event as T);
        };
        return this.on(type, wrapped);
    }

    addEventListener<T = unknown>(type: string, handler: (event: T) => void): this {
        return this.on(type, handler);
    }

    removeEventListener<T = unknown>(type: string, handler: (event: T) => void): this {
        return this.off(type, handler);
    }

    fire(type: string, data?: unknown): this {
        this.listeners[type]?.forEach((handler) => handler(data));
        return this;
    }

    hasListeners(type: string): boolean {
        return (this.listeners[type]?.size ?? 0) > 0;
    }
}

export abstract class CompatLayer extends CompatEvented {
    protected host?: OverlayHost;
    protected attached = false;
    /** Parent group this layer belongs to, if any. */
    group?: CompatLayerGroup;

    abstract addTo(target: OverlayHost | CompatLayerGroup): this;
    abstract remove(target?: OverlayHost | CompatLayerGroup): this;
    removeFrom(target: OverlayHost | CompatLayerGroup): this {
        return this.remove(target);
    }
    getElement(): HTMLElement | SVGElement | undefined {
        return undefined;
    }
    /** Internal: attach to host + pane; called by addTo/group. */
    abstract _attach(host: OverlayHost): void;
    abstract _detach(): void;
}

export interface CompatMarkerOptions {
    icon: CompatIcon;
    pane?: string;
    interactive?: boolean;
    draggable?: boolean;
    keyboard?: boolean;
    alt?: string;
    zIndexOffset?: number;
}

export class CompatMarker extends CompatLayer {
    private latlng: LatLng;
    private readonly options: CompatMarkerOptions;
    private readonly element: HTMLElement;
    private unsubscribeRender?: () => void;
    private domDisposers: Array<() => void> = [];
    private dragDisposers: Array<() => void> = [];
    /** While a scripted position animation plays, render-loop writes are held. */
    private positionAnimating = false;

    constructor(latlng: LatLngExpression, options: CompatMarkerOptions) {
        super();
        this.latlng = toLatLng(latlng);
        this.options = { pane: 'markerPane', interactive: true, ...options };
        this.element = createIconElement(options.icon);
        if (options.zIndexOffset !== undefined) {
            this.element.style.zIndex = String(options.zIndexOffset);
        }
        if (options.alt) {
            this.element.setAttribute('alt', options.alt);
        }
        if (this.options.interactive === false) {
            this.element.style.pointerEvents = 'none';
        }
        this.bindDomEvents();
        if (this.options.draggable) {
            this.enableDragging();
        }
    }

    private bindDomEvents() {
        const forward = (type: string) => {
            const listener = (event: MouseEvent) => {
                if (type === 'click') {
                    this.fire('click', { originalEvent: event, target: this });
                } else {
                    this.fire(type, { originalEvent: event, target: this });
                }
            };
            this.element.addEventListener(type, listener as EventListener);
            this.domDisposers.push(() =>
                this.element.removeEventListener(type, listener as EventListener),
            );
        };
        forward('click');
        forward('mouseover');
        forward('mouseout');
    }

    private enableDragging() {
        const onPointerDown = (down: PointerEvent) => {
            if (down.button !== 0 || !this.host) return;
            down.preventDefault();
            down.stopPropagation();
            const host = this.host;
            host.setMapDraggingEnabled(false);
            this.element.setPointerCapture(down.pointerId);

            const onMove = (move: PointerEvent) => {
                const rect = host
                    .getPane('markerPane')
                    ?.getBoundingClientRect();
                if (!rect) return;
                const point = new Point(
                    move.clientX - rect.left,
                    move.clientY - rect.top,
                );
                this.setLatLng(host.containerPointToLatLng(point));
                this.fire('drag', { originalEvent: move, target: this });
            };
            const onUp = (up: PointerEvent) => {
                this.element.removeEventListener('pointermove', onMove);
                this.element.removeEventListener('pointerup', onUp);
                this.element.removeEventListener('pointercancel', onUp);
                host.setMapDraggingEnabled(true);
                this.fire('dragend', {
                    originalEvent: up,
                    target: this,
                    latlng: this.getLatLng(),
                });
            };
            this.element.addEventListener('pointermove', onMove);
            this.element.addEventListener('pointerup', onUp);
            this.element.addEventListener('pointercancel', onUp);
        };
        this.element.addEventListener('pointerdown', onPointerDown);
        this.dragDisposers.push(() =>
            this.element.removeEventListener('pointerdown', onPointerDown),
        );
    }

    override getElement(): HTMLElement {
        return this.element;
    }

    getLatLng(): LatLng {
        return this.latlng;
    }

    setLatLng(value: LatLngExpression): this {
        this.latlng = toLatLng(value);
        this.updatePosition();
        return this;
    }

    private updatePosition() {
        if (!this.attached || !this.host || this.positionAnimating) return;
        const point = this.host.latLngToContainerPoint(this.latlng);
        this.element.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
    }

    /** Current container-pixel position (null when detached). */
    getContainerPoint(): Point | null {
        if (!this.host) return null;
        return this.host.latLngToContainerPoint(this.latlng);
    }

    /**
     * Cluster morph animation: glide from a previous screen position to the
     * current one (Leaflet.markercluster split/merge parity). The camera is
     * static when this runs (post zoomend), so holding render-loop writes for
     * the duration is safe.
     */
    /**
     * Merge fly-in counterpart of animatePositionFrom: glide from the current
     * screen position to an arbitrary target (e.g. the absorbing cluster's
     * position). The caller detaches/removes the marker when it finishes.
     */
    animatePositionTo(target: Point, durationMs = 300): void {
        if (!this.attached || !this.host || this.positionAnimating) return;
        const from = this.host.latLngToContainerPoint(this.latlng);
        if (from.distanceTo(target) < 1) return;

        this.positionAnimating = true;
        const el = this.element;
        el.style.transition = 'none';
        el.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`;
        void el.offsetWidth;
        el.style.transition = `transform ${durationMs}ms ease-out`;
        el.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            el.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallbackTimer);
            el.style.transition = '';
            this.positionAnimating = false;
            this.updatePosition();
        };
        const onEnd = (event: TransitionEvent) => {
            if (event.propertyName === 'transform') finish();
        };
        const fallbackTimer = window.setTimeout(finish, durationMs + 50);
        el.addEventListener('transitionend', onEnd);
    }

    animatePositionFrom(from: Point, durationMs = 300): void {
        if (!this.attached || !this.host || this.positionAnimating) return;
        const target = this.host.latLngToContainerPoint(this.latlng);
        if (from.distanceTo(target) < 1) return;

        this.positionAnimating = true;
        const el = this.element;
        el.style.transition = 'none';
        el.style.transform = `translate3d(${from.x}px, ${from.y}px, 0)`;
        void el.offsetWidth; // flush so the transition actually plays
        el.style.transition = `transform ${durationMs}ms ease-out`;
        el.style.transform = `translate3d(${target.x}px, ${target.y}px, 0)`;

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            el.removeEventListener('transitionend', onEnd);
            window.clearTimeout(fallbackTimer);
            el.style.transition = '';
            this.positionAnimating = false;
            this.updatePosition();
        };
        const onEnd = (event: TransitionEvent) => {
            if (event.propertyName === 'transform') finish();
        };
        const fallbackTimer = window.setTimeout(finish, durationMs + 50);
        el.addEventListener('transitionend', onEnd);
    }

    addTo(target: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.addLayer(this);
            return this;
        }
        if (target) this._attach(target);
        return this;
    }

    remove(target?: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.removeLayer(this);
            return this;
        }
        this._detach();
        return this;
    }

    _attach(host: OverlayHost): void {
        if (this.attached && this.host === host) return;
        this._detach();
        this.host = host;
        const pane = host.getPane(this.options.pane ?? 'markerPane');
        if (!pane) return;
        pane.appendChild(this.element);
        this.attached = true;
        host._registerLayerAttachment(this, true);
        this.updatePosition();
        this.unsubscribeRender = host.onRender(() => this.updatePosition());
        this.fire('add', { target: this });
    }

    _detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.host?._registerLayerAttachment(this, false);
        this.unsubscribeRender?.();
        this.unsubscribeRender = undefined;
        this.element.remove();
        this.host = undefined;
        this.fire('remove', { target: this });
    }
}

export interface CompatLayerGroupOptions {
    pane?: string;
}

export class CompatLayerGroup extends CompatLayer {
    private layers = new Set<CompatLayer>();

    constructor(
        layers: CompatLayer[] = [],
        readonly options: CompatLayerGroupOptions = {},
    ) {
        super();
        layers.forEach((layer) => this.addLayer(layer));
    }

    addLayer(layer: CompatLayer): this {
        if (this.layers.has(layer)) return this;
        this.layers.add(layer);
        layer.group = this;
        if (this.attached && this.host) {
            layer._attach(this.host);
        }
        return this;
    }

    removeLayer(layer: CompatLayer): this {
        if (!this.layers.delete(layer)) return this;
        layer._detach();
        layer.group = undefined;
        return this;
    }

    hasLayer(layer: CompatLayer): boolean {
        return this.layers.has(layer);
    }

    clearLayers(): this {
        [...this.layers].forEach((layer) => this.removeLayer(layer));
        return this;
    }

    eachLayer(callback: (layer: CompatLayer) => void): this {
        this.layers.forEach(callback);
        return this;
    }

    getLayers(): CompatLayer[] {
        return [...this.layers];
    }

    addTo(target: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.addLayer(this);
            return this;
        }
        this._attach(target);
        return this;
    }

    remove(target?: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.removeLayer(this);
            return this;
        }
        this._detach();
        return this;
    }

    _attach(host: OverlayHost): void {
        if (this.attached) return;
        this.host = host;
        this.attached = true;
        host._registerLayerAttachment(this, true);
        this.layers.forEach((layer) => layer._attach(host));
    }

    _detach(): void {
        if (!this.attached) return;
        this.host?._registerLayerAttachment(this, false);
        this.layers.forEach((layer) => layer._detach());
        this.attached = false;
        this.host = undefined;
    }
}

export const layerGroup = (
    layers: CompatLayer[] = [],
    options?: CompatLayerGroupOptions,
): CompatLayerGroup => new CompatLayerGroup(layers, options);

// ---------------------------------------------------------------------------
// SVG vector paths (polygon / rectangle)
// ---------------------------------------------------------------------------

export interface CompatPathOptions {
    pane?: string;
    color?: string;
    /** Leaflet parity: stroke:false disables the outline regardless of color. */
    stroke?: boolean;
    weight?: number;
    opacity?: number;
    fill?: boolean;
    fillColor?: string;
    fillOpacity?: number;
    className?: string;
    interactive?: boolean;
}

/** One SVG per (host, pane), holding all vector paths of that pane. */
const paneSvgRegistry = new WeakMap<HTMLElement, SVGSVGElement>();

const getPaneSvg = (pane: HTMLElement): SVGSVGElement => {
    let svg = paneSvgRegistry.get(pane);
    if (svg) return svg;
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('leaflet-zoom-animated');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    pane.appendChild(svg);
    paneSvgRegistry.set(pane, svg);
    return svg;
};

export class CompatPolygon extends CompatLayer {
    protected latlngs: LatLng[];
    protected readonly options: CompatPathOptions;
    private path?: SVGPathElement;
    private unsubscribeRender?: () => void;

    constructor(latlngs: LatLngExpression[], options: CompatPathOptions = {}) {
        super();
        this.latlngs = latlngs.map(toLatLng);
        this.options = { pane: 'overlayPane', interactive: false, ...options };
    }

    override getElement(): SVGPathElement | undefined {
        return this.path;
    }
    setLatLngs(latlngs: LatLngExpression[]): this {
        this.latlngs = latlngs.map(toLatLng);
        this.renderPath();
        return this;
    }

    bringToFront(): this {
        if (this.path?.parentNode) {
            this.path.parentNode.appendChild(this.path);
        }
        return this;
    }

    private renderPath() {
        const host = this.host;
        if (!this.path || !host) return;
        const points = this.latlngs.map((latlng) =>
            host.latLngToContainerPoint(latlng),
        );
        if (points.length === 0) return;
        const d =
            `M ${points[0].x} ${points[0].y} ` +
            points
                .slice(1)
                .map((point) => `L ${point.x} ${point.y}`)
                .join(' ') +
            ' Z';
        this.path.setAttribute('d', d);
    }

    addTo(target: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.addLayer(this);
            return this;
        }
        this._attach(target);
        return this;
    }

    remove(target?: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.removeLayer(this);
            return this;
        }
        this._detach();
        return this;
    }

    _attach(host: OverlayHost): void {
        if (this.attached) return;
        this.host = host;
        const pane = host.getPane(this.options.pane ?? 'overlayPane');
        if (!pane) return;
        const svg = getPaneSvg(pane);

        const path = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'path',
        );
        const {
            color,
            stroke,
            weight,
            opacity,
            fill,
            fillColor,
            fillOpacity,
            className,
            interactive,
        } = this.options;
        if (className) path.setAttribute('class', className);
        path.setAttribute(
            'stroke',
            stroke === false ? 'none' : (color ?? '#3388ff'),
        );
        if (weight !== undefined) path.setAttribute('stroke-width', String(weight));
        if (opacity !== undefined) path.setAttribute('stroke-opacity', String(opacity));
        if (fill === false || (fill === undefined && (fillOpacity ?? 0) <= 0)) {
            path.setAttribute('fill', 'none');
        } else {
            path.setAttribute('fill', fillColor ?? color ?? '#3388ff');
            path.setAttribute('fill-opacity', String(fillOpacity ?? 0.2));
        }
        // 'all' (not 'auto'): transparent hit areas (fillOpacity:0) must still
        // receive hover — 'auto' computes to visiblePainted and misses them.
        path.style.pointerEvents = interactive ? 'all' : 'none';
        svg.appendChild(path);
        this.path = path;

        if (interactive) {
            path.addEventListener('mouseover', this.forwardPathEvent);
            path.addEventListener('mouseout', this.forwardPathEvent);
            path.addEventListener('click', this.forwardPathEvent);
        }

        this.attached = true;
        host._registerLayerAttachment(this, true);
        this.renderPath();
        this.unsubscribeRender = host.onRender(() => this.renderPath());
        this.fire('add', { target: this });
    }

    private forwardPathEvent = (event: Event) => {
        this.fire(event.type, { originalEvent: event, target: this });
    };

    _detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.host?._registerLayerAttachment(this, false);
        this.unsubscribeRender?.();
        this.unsubscribeRender = undefined;
        if (this.path) {
            this.path.removeEventListener('mouseover', this.forwardPathEvent);
            this.path.removeEventListener('mouseout', this.forwardPathEvent);
            this.path.removeEventListener('click', this.forwardPathEvent);
            this.path.remove();
            this.path = undefined;
        }
        this.host = undefined;
        this.fire('remove', { target: this });
    }
}

/**
 * Rectangle as a polygon subclass (not a wrapper): group membership, the
 * layer registry, and event subscription all live on one object, so
 * removeFrom(group)/once()/addEventListener behave exactly like on polygons.
 */
export class CompatRectangle extends CompatPolygon {
    private bounds: LatLngBounds;

    constructor(bounds: LatLngBoundsExpression, options: CompatPathOptions = {}) {
        const resolvedBounds = toLatLngBounds(bounds);
        super(rectangleCorners(resolvedBounds), options);
        this.bounds = resolvedBounds;
    }

    setBounds(bounds: LatLngBoundsExpression): this {
        this.bounds = toLatLngBounds(bounds);
        this.setLatLngs(rectangleCorners(this.bounds));
        return this;
    }

    getBounds(): LatLngBounds {
        return this.bounds;
    }
}

const rectangleCorners = (bounds: LatLngBounds): LatLngExpression[] => [
    [bounds.getNorth(), bounds.getWest()],
    [bounds.getNorth(), bounds.getEast()],
    [bounds.getSouth(), bounds.getEast()],
    [bounds.getSouth(), bounds.getWest()],
];

export const polygon = (
    latlngs: LatLngExpression[],
    options?: CompatPathOptions,
): CompatPolygon => new CompatPolygon(latlngs, options);

export const rectangle = (
    bounds: LatLngBoundsExpression,
    options?: CompatPathOptions,
): CompatRectangle => new CompatRectangle(bounds, options);

// ---------------------------------------------------------------------------
// Image overlay
// ---------------------------------------------------------------------------

export interface CompatImageOverlayOptions {
    pane?: string;
    interactive?: boolean;
    className?: string;
    opacity?: number;
}

export class CompatImageOverlay extends CompatLayer {
    private readonly options: CompatImageOverlayOptions;
    private readonly bounds: LatLngBounds;
    private element?: HTMLImageElement;
    private unsubscribeRender?: () => void;

    constructor(
        private readonly url: string,
        bounds: LatLngBoundsExpression,
        options: CompatImageOverlayOptions = {},
    ) {
        super();
        this.options = { pane: 'overlayPane', interactive: false, ...options };
        this.bounds = toLatLngBounds(bounds);
    }

    override getElement(): HTMLImageElement | undefined {
        return this.element;
    }

    private renderImage() {
        if (!this.element || !this.host) return;
        const northWest = new LatLng(
            this.bounds.getNorth(),
            this.bounds.getWest(),
        );
        const southEast = new LatLng(
            this.bounds.getSouth(),
            this.bounds.getEast(),
        );
        const topLeft = this.host.latLngToContainerPoint(northWest);
        const bottomRight = this.host.latLngToContainerPoint(southEast);
        this.element.style.transform = `translate3d(${topLeft.x}px, ${topLeft.y}px, 0)`;
        this.element.style.width = `${bottomRight.x - topLeft.x}px`;
        this.element.style.height = `${bottomRight.y - topLeft.y}px`;
    }

    addTo(target: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.addLayer(this);
            return this;
        }
        this._attach(target);
        return this;
    }

    remove(target?: OverlayHost | CompatLayerGroup): this {
        if (target instanceof CompatLayerGroup) {
            target.removeLayer(this);
            return this;
        }
        this._detach();
        return this;
    }

    _attach(host: OverlayHost): void {
        if (this.attached) return;
        this.host = host;
        const pane = host.getPane(this.options.pane ?? 'overlayPane');
        if (!pane) return;

        const element = document.createElement('img');
        element.src = this.url;
        element.classList.add('leaflet-image-layer', 'leaflet-zoom-animated');
        if (this.options.className) {
            this.options.className
                .split(/\s+/)
                .filter(Boolean)
                .forEach((name) => element.classList.add(name));
        }
        element.style.position = 'absolute';
        element.style.pointerEvents = this.options.interactive ? 'auto' : 'none';
        if (this.options.opacity !== undefined) {
            element.style.opacity = String(this.options.opacity);
        }
        pane.appendChild(element);
        this.element = element;

        this.attached = true;
        host._registerLayerAttachment(this, true);
        this.renderImage();
        this.unsubscribeRender = host.onRender(() => this.renderImage());
        this.fire('add', { target: this });
    }

    _detach(): void {
        if (!this.attached) return;
        this.attached = false;
        this.host?._registerLayerAttachment(this, false);
        this.unsubscribeRender?.();
        this.unsubscribeRender = undefined;
        this.element?.remove();
        this.element = undefined;
        this.host = undefined;
        this.fire('remove', { target: this });
    }
}

export const imageOverlay = (
    url: string,
    bounds: LatLngBoundsExpression,
    options?: CompatImageOverlayOptions,
): CompatImageOverlay => new CompatImageOverlay(url, bounds, options);
