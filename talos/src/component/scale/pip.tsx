import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
import { useTranslateUI } from '@/locale';
import Icon from '../../assets/images/UI/observator_6.webp';

type DocumentPictureInPictureOptions = {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
};

type DocumentPictureInPicture = EventTarget & {
    readonly window: Window | null;
    requestWindow: (options?: DocumentPictureInPictureOptions) => Promise<Window>;
};

type WindowWithDocumentPictureInPicture = Window &
    typeof globalThis & {
        documentPictureInPicture?: DocumentPictureInPicture;
    };

type SvgElementInstanceLike = Element & {
    correspondingUseElement?: Element | null;
};

type StateListener = (active: boolean) => void;
type ViewportListener = () => void;
type LeafletWithMutableDocument = typeof L & {
    DomEvent?: {
        _pointers?: Record<number, PointerEvent>;
        _pointersCount?: number;
    };
    Draggable?: {
        prototype?: LeafletDraggablePrototype;
        _dragging?: LeafletDraggableInstance | false;
    };
    Browser?: {
        touch?: boolean;
    };
};

type LeafletPointLikeEvent = Event & {
    touches?: TouchList;
    which?: number;
    button?: number;
    shiftKey?: boolean;
    clientX?: number;
    clientY?: number;
    srcElement?: EventTarget | null;
};

type SvgElementInstanceConstructor = {
    new(): SvgElementInstanceLike;
};

type WindowWithSvgElementInstance = Window & {
    SVGElementInstance?: SvgElementInstanceConstructor;
};

type LeafletDraggableInstance = {
    _enabled?: boolean;
    _moved?: boolean;
    _moving?: boolean;
    _element?: HTMLElement;
    _dragStartTarget?: HTMLElement;
    _preventOutline?: boolean;
    _startPoint?: L.Point;
    _startPos?: L.Point;
    _parentScale?: {
        x: number;
        y: number;
    };
    _newPos?: L.Point;
    _lastEvent?: Event;
    _lastTarget?: Element | null;
    options?: {
        clickTolerance?: number;
    };
    _updatePosition?: () => void;
    fire?: (type: string, data?: unknown) => LeafletDraggableInstance;
    _onDown?: (event: LeafletPointLikeEvent) => void;
    _onMove?: (event: LeafletPointLikeEvent) => void;
    _onUp?: (event?: LeafletPointLikeEvent) => void;
    finishDrag?: (noInertia?: boolean) => void;
    __talosDragDocument?: Document | null;
    __talosDragWindow?: Window | null;
    __talosDragWasMouse?: boolean;
    __talosDragCleanup?: (() => void) | null;
    __talosOutlineCleanup?: (() => void) | null;
};

type LeafletDraggablePrototype = LeafletDraggableInstance & {
    __talosPatched?: boolean;
};

type NodeLike = {
    ownerDocument?: Document | null;
};

const isElement = (value: unknown): value is Element => (
    typeof Element !== 'undefined' && value instanceof Element
);

const APP_ROOT_ID = 'root';
const PIP_WIDTH = 800;
const PIP_HEIGHT = 600;
const PIP_MOBILE_WIDTH = 500;
const PIP_MOBILE_RATIO = 0.75;
const SYNCED_ROOT_ATTRIBUTES = ['class', 'style', 'lang', 'dir', 'data-theme', 'data-schema', 'data-theme-switching'];

let activePipWindow: Window | null = null;
let movedRoot: HTMLElement | null = null;
let restoreAnchor: Comment | null = null;
let originalParent: Node | null = null;
let placeholderCleanup: (() => void) | null = null;
let rootAttributeObserver: MutationObserver | null = null;
const listeners = new Set<StateListener>();
const viewportListeners = new Set<ViewportListener>();

// eslint-disable-next-line react-refresh/only-export-components
const PictureInPicturePlaceholder = ({ onReturn }: { onReturn: () => void }) => {
    const tUI = useTranslateUI();
    const hint = tUI('scale.pip.returnHint');

    return (
        <div className="PipPlaceholder">
            <span className="PipPlaceholderPattern" aria-hidden="true" />
            <span className="PipPlaceholderCard">
                <button
                    className="PipPlaceholderLogoButton"
                    type="button"
                    aria-label={hint}
                    onClick={onReturn}
                >
                    <img className="PipPlaceholderLogo" src={Icon} alt="" draggable="false" />
                </button>
                <span className="PipPlaceholderTitle">{tUI('scale.pip.activeTitle')}</span>
                <span className="PipPlaceholderDesc">{hint}</span>
            </span>
        </div>
    );
};

const mountPictureInPicturePlaceholder = (
    targetDocument: Document,
    onReturn: () => void,
): (() => void) => {
    const container = targetDocument.createElement('div');
    const root: Root = createRoot(container);
    root.render(<PictureInPicturePlaceholder onReturn={onReturn} />);
    targetDocument.body.append(container);

    return () => {
        root.unmount();
        container.remove();
    };
};

const openerDocument = typeof window === 'undefined' ? null : window.document;

const getDocumentPictureInPicture = (): DocumentPictureInPicture | null => {
    if (typeof window === 'undefined') return null;
    return (window as WindowWithDocumentPictureInPicture).documentPictureInPicture ?? null;
};

export const isDocumentPictureInPictureSupported = () => Boolean(getDocumentPictureInPicture());

export const isAppPictureInPictureActive = () => {
    const nativeWindow = getDocumentPictureInPicture()?.window;
    return Boolean((activePipWindow && !activePipWindow.closed) || (nativeWindow && !nativeWindow.closed));
};

export const getPictureInPictureWindow = () => (
    activePipWindow && !activePipWindow.closed ? activePipWindow : null
);

export const getPictureInPictureDocument = () => getPictureInPictureWindow()?.document ?? null;

export const getOpenerDocument = () => openerDocument;

export const getAppDocument = () => getPictureInPictureDocument() ?? openerDocument ?? document;

export const getAppViewport = () => {
    const pipWindow = activePipWindow && !activePipWindow.closed ? activePipWindow : null;
    const sourceWindow = pipWindow ?? window;
    const width = sourceWindow.innerWidth;
    const height = sourceWindow.innerHeight;
    const ratio = width / Math.max(height, 1);
    const inPictureInPicture = Boolean(pipWindow);
    const mobileBreakpoint = inPictureInPicture ? (ratio < PIP_MOBILE_RATIO ? PIP_MOBILE_WIDTH : 0) : 768;

    return {
        width,
        height,
        ratio,
        inPictureInPicture,
        mobileBreakpoint,
    };
};

export const subscribeAppViewport = (listener: ViewportListener) => {
    viewportListeners.add(listener);
    return () => {
        viewportListeners.delete(listener);
    };
};

const emitState = () => {
    const active = isAppPictureInPictureActive();
    listeners.forEach((listener) => listener(active));
};

const emitViewport = () => {
    viewportListeners.forEach((listener) => listener());
};

export const subscribePictureInPictureState = (listener: StateListener) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const syncRootAttributes = (source: Document, target: Document) => {
    for (const attr of SYNCED_ROOT_ATTRIBUTES) {
        const value = source.documentElement.getAttribute(attr);
        if (value === null) {
            target.documentElement.removeAttribute(attr);
        } else {
            target.documentElement.setAttribute(attr, value);
        }
    }
};

const isPipMobileViewport = (targetWindow: Window) => {
    const width = targetWindow.innerWidth;
    const height = targetWindow.innerHeight;
    return width <= PIP_MOBILE_WIDTH && width / Math.max(height, 1) < PIP_MOBILE_RATIO;
};

const syncPipViewportAttributes = (targetWindow: Window) => {
    const root = targetWindow.document.documentElement;
    root.style.setProperty('--app-responsive-width', `${targetWindow.innerWidth}px`);
    root.style.setProperty('--app-responsive-height', `${targetWindow.innerHeight}px`);
    root.toggleAttribute('data-pip-mobile', isPipMobileViewport(targetWindow));
};

const syncPictureInPictureViewport = (targetWindow: Window) => {
    syncPipViewportAttributes(targetWindow);
    emitViewport();
};

const schedulePictureInPictureViewportSync = (targetWindow: Window) => {
    syncPictureInPictureViewport(targetWindow);
    targetWindow.requestAnimationFrame(() => syncPictureInPictureViewport(targetWindow));
    targetWindow.setTimeout(() => syncPictureInPictureViewport(targetWindow), 120);
};

const cloneAppStyles = (source: Document, target: Document) => {
    const nodes = source.head.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
        'link[rel="stylesheet"], style',
    );

    nodes.forEach((node) => {
        target.head.append(node.cloneNode(true));
    });
};

const preparePictureInPictureDocument = (pipWindow: Window) => {
    const pipDocument = pipWindow.document;
    pipDocument.title = document.title;
    pipDocument.head.replaceChildren();
    pipDocument.body.replaceChildren();
    pipDocument.body.style.margin = '0';
    pipDocument.body.style.overflow = 'hidden';
    cloneAppStyles(document, pipDocument);
    syncRootAttributes(document, pipDocument);
    pipDocument.documentElement.setAttribute('data-pip-window', 'true');
    syncPipViewportAttributes(pipWindow);

    rootAttributeObserver?.disconnect();
    rootAttributeObserver = new MutationObserver(() => {
        syncRootAttributes(document, pipDocument);
    });
    rootAttributeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: SYNCED_ROOT_ATTRIBUTES,
    });
};

const notifyViewportChanged = () => {
    if (activePipWindow && !activePipWindow.closed) {
        syncPipViewportAttributes(activePipWindow);
    }
    emitViewport();
};

const handlePictureInPictureResize = () => {
    notifyViewportChanged();
};

const eventDocument = (event?: Event, fallback?: HTMLElement | null) => {
    const target = event?.target as NodeLike | null | undefined;
    if (target?.ownerDocument) return target.ownerDocument;
    return fallback?.ownerDocument ?? openerDocument ?? null;
};

const eventWindow = (event?: Event, fallback?: HTMLElement | null) => (
    eventDocument(event, fallback)?.defaultView ?? window
);

const getSizedParentNodeForDocument = (element: HTMLElement, targetDocument: Document) => {
    let current: HTMLElement | null = element;
    do {
        current = current.parentElement;
    } while (current && (!current.offsetWidth || !current.offsetHeight) && current !== targetDocument.body);
    return current ?? targetDocument.body;
};

const disableScopedTextSelection = (targetWindow: Window) => {
    L.DomEvent.on(targetWindow as unknown as HTMLElement, 'selectstart', L.DomEvent.preventDefault);
    return () => {
        L.DomEvent.off(targetWindow as unknown as HTMLElement, 'selectstart', L.DomEvent.preventDefault);
    };
};

const disableScopedImageDrag = (targetWindow: Window) => {
    L.DomEvent.on(targetWindow as unknown as HTMLElement, 'dragstart', L.DomEvent.preventDefault);
    return () => {
        L.DomEvent.off(targetWindow as unknown as HTMLElement, 'dragstart', L.DomEvent.preventDefault);
    };
};

const preventScopedOutline = (draggable: LeafletDraggableInstance, targetWindow: Window) => {
    let element = draggable._element;
    if (!draggable._preventOutline || !element) return;

    while (element.tabIndex === -1 && element.parentElement) {
        element = element.parentElement;
    }
    if (!element.style) return;

    const outlineElement = element;
    draggable.__talosOutlineCleanup?.();
    const previousOutline = outlineElement.style.outlineStyle;
    outlineElement.style.outlineStyle = 'none';

    const restoreOutline = () => {
        outlineElement.style.outlineStyle = previousOutline;
        L.DomEvent.off(targetWindow as unknown as HTMLElement, 'keydown', restoreOutline);
        if (draggable.__talosOutlineCleanup === restoreOutline) {
            draggable.__talosOutlineCleanup = null;
        }
    };

    draggable.__talosOutlineCleanup = restoreOutline;
    L.DomEvent.on(targetWindow as unknown as HTMLElement, 'keydown', restoreOutline);
};

const cleanupScopedDragGuards = (draggable: LeafletDraggableInstance) => {
    draggable.__talosDragCleanup?.();
    draggable.__talosDragCleanup = null;
    draggable.__talosOutlineCleanup?.();
    draggable.__talosOutlineCleanup = null;
};

const installLeafletDraggableDocumentPatch = () => {
    const leaflet = L as LeafletWithMutableDocument;
    const draggablePrototype = leaflet.Draggable?.prototype;
    if (!draggablePrototype || draggablePrototype.__talosPatched) return;

    const originalOnDown = draggablePrototype._onDown;
    const originalOnMove = draggablePrototype._onMove;
    const originalOnUp = draggablePrototype._onUp;
    const originalFinishDrag = draggablePrototype.finishDrag;
    if (!originalOnDown || !originalOnMove || !originalOnUp || !originalFinishDrag) return;

    draggablePrototype._onDown = function patchedOnDown(this: LeafletDraggableInstance, event: LeafletPointLikeEvent) {
        const isPipDrag = eventDocument(event, this._dragStartTarget) === getPictureInPictureDocument();
        if (!isPipDrag) {
            originalOnDown.call(this, event);
            return;
        }

        if (!this._enabled) return;
        this._moved = false;

        if (!this._element || L.DomUtil.hasClass(this._element, 'leaflet-zoom-anim')) return;

        if (event.touches && event.touches.length !== 1) {
            if (leaflet.Draggable?._dragging === this) {
                this.finishDrag?.();
            }
            return;
        }

        if (
            leaflet.Draggable?._dragging ||
            event.shiftKey ||
            (event.which !== 1 && event.button !== 1 && !event.touches)
        ) {
            return;
        }

        const targetDocument = eventDocument(event, this._dragStartTarget);
        const targetWindow = eventWindow(event, this._dragStartTarget);
        if (!targetDocument || !leaflet.Draggable) return;

        const first = event.touches ? event.touches[0] : event;
        if (typeof first?.clientX !== 'number' || typeof first.clientY !== 'number') return;

        cleanupScopedDragGuards(this);
        this.__talosDragDocument = targetDocument;
        this.__talosDragWindow = targetWindow;
        this.__talosDragWasMouse = event.type === 'mousedown';
        leaflet.Draggable._dragging = this;

        preventScopedOutline(this, targetWindow);
        const restoreImageDrag = disableScopedImageDrag(targetWindow);
        const restoreTextSelection = disableScopedTextSelection(targetWindow);
        this.__talosDragCleanup = () => {
            restoreImageDrag();
            restoreTextSelection();
        };

        if (this._moving) return;

        this.fire?.('down');

        const sizedParent = getSizedParentNodeForDocument(this._element, targetDocument);

        this._startPoint = new L.Point(first.clientX, first.clientY);
        this._startPos = L.DomUtil.getPosition(this._element);
        this._parentScale = L.DomUtil.getScale(sizedParent);

        L.DomEvent.on(
            targetDocument as unknown as HTMLElement,
            this.__talosDragWasMouse ? 'mousemove' : 'touchmove',
            this._onMove as (moveEvent: Event) => void,
            this,
        );
        L.DomEvent.on(
            targetDocument as unknown as HTMLElement,
            this.__talosDragWasMouse ? 'mouseup' : 'touchend touchcancel',
            this._onUp as (upEvent: Event) => void,
            this,
        );
    };

    draggablePrototype._onMove = function patchedOnMove(this: LeafletDraggableInstance, event: LeafletPointLikeEvent) {
        if (!this.__talosDragDocument) {
            originalOnMove.call(this, event);
            return;
        }

        if (!this._enabled || !this._startPoint || !this._startPos || !this._parentScale) return;

        if (event.touches && event.touches.length > 1) {
            this._moved = true;
            return;
        }

        const first = event.touches && event.touches.length === 1 ? event.touches[0] : event;
        if (typeof first?.clientX !== 'number' || typeof first.clientY !== 'number') return;
        const offset = new L.Point(first.clientX, first.clientY).subtract(this._startPoint);

        if (!offset.x && !offset.y) return;
        if (Math.abs(offset.x) + Math.abs(offset.y) < (this.options?.clickTolerance ?? 3)) return;

        offset.x /= this._parentScale.x;
        offset.y /= this._parentScale.y;

        L.DomEvent.preventDefault(event);

        const targetDocument = this.__talosDragDocument ?? eventDocument(event, this._dragStartTarget);
        const targetWindow = this.__talosDragWindow ?? eventWindow(event, this._dragStartTarget);

        if (!this._moved) {
            this.fire?.('dragstart');
            this._moved = true;

            if (targetDocument) {
                L.DomUtil.addClass(targetDocument.body, 'leaflet-dragging');
            }

            const rawTarget = event.target || event.srcElement;
            const target = isElement(rawTarget) ? rawTarget : null;
            const svgElementInstance = (targetWindow as WindowWithSvgElementInstance).SVGElementInstance;
            if (svgElementInstance && target instanceof svgElementInstance) {
                this._lastTarget = target.correspondingUseElement;
            } else {
                this._lastTarget = target;
            }
            if (this._lastTarget) {
                L.DomUtil.addClass(this._lastTarget as HTMLElement, 'leaflet-drag-target');
            }
        }

        this._newPos = this._startPos.add(offset);
        this._moving = true;
        this._lastEvent = event;
        this._updatePosition?.();
    };

    draggablePrototype._onUp = function patchedOnUp(this: LeafletDraggableInstance, event?: LeafletPointLikeEvent) {
        if (!this.__talosDragDocument) {
            originalOnUp.call(this, event);
            return;
        }

        if (!this._enabled) return;
        this.finishDrag?.();
    };

    draggablePrototype.finishDrag = function patchedFinishDrag(this: LeafletDraggableInstance, noInertia?: boolean) {
        if (!this.__talosDragDocument) {
            originalFinishDrag.call(this, noInertia);
            return;
        }

        const targetDocument = this.__talosDragDocument ?? this._dragStartTarget?.ownerDocument ?? openerDocument;
        if (targetDocument) {
            L.DomUtil.removeClass(targetDocument.body, 'leaflet-dragging');
        }

        if (this._lastTarget) {
            L.DomUtil.removeClass(this._lastTarget as HTMLElement, 'leaflet-drag-target');
            this._lastTarget = null;
        }

        const listenerDocument = (targetDocument ?? document) as unknown as HTMLElement;
        L.DomEvent.off(listenerDocument, 'mousemove touchmove', this._onMove as (moveEvent: Event) => void, this);
        L.DomEvent.off(listenerDocument, 'mouseup touchend touchcancel', this._onUp as (upEvent: Event) => void, this);
        cleanupScopedDragGuards(this);

        const fireDragend = Boolean(this._moved && this._moving && this._newPos && this._startPos);

        this._moving = false;
        if (leaflet.Draggable) {
            leaflet.Draggable._dragging = false;
        }

        if (fireDragend) {
            this.fire?.('dragend', {
                noInertia,
                distance: this._newPos?.distanceTo(this._startPos as L.Point) ?? 0,
            });
        }

        this.__talosDragDocument = null;
        this.__talosDragWindow = null;
        this.__talosDragWasMouse = false;
    };

    draggablePrototype.__talosPatched = true;
};

installLeafletDraggableDocumentPatch();

const resetLeafletDragState = () => {
    const leaflet = L as LeafletWithMutableDocument;
    const activeDraggable = leaflet.Draggable?._dragging;
    if (activeDraggable) {
        activeDraggable.finishDrag?.(true);
    }
    if (leaflet.Draggable) {
        leaflet.Draggable._dragging = false;
    }
    if (leaflet.DomEvent) {
        leaflet.DomEvent._pointers = {};
        leaflet.DomEvent._pointersCount = 0;
    }
};

const mountPlaceholder = () => {
    if (placeholderCleanup) return;
    placeholderCleanup = mountPictureInPicturePlaceholder(window.document, closeAppPictureInPicture);
};

const unmountPlaceholder = () => {
    placeholderCleanup?.();
    placeholderCleanup = null;
};

export const closeAppPictureInPicture = () => {
    const pipWindow = activePipWindow ?? getDocumentPictureInPicture()?.window ?? null;
    const root = movedRoot;

    rootAttributeObserver?.disconnect();
    rootAttributeObserver = null;
    resetLeafletDragState();
    pipWindow?.removeEventListener('resize', handlePictureInPictureResize);

    if (root && originalParent && restoreAnchor?.parentNode === originalParent) {
        originalParent.insertBefore(root, restoreAnchor);
        restoreAnchor.remove();
    }

    movedRoot = null;
    restoreAnchor = null;
    originalParent = null;
    activePipWindow = null;
    unmountPlaceholder();

    if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
    }

    notifyViewportChanged();
    emitState();
};

export const openAppPictureInPicture = async () => {
    const documentPictureInPicture = getDocumentPictureInPicture();
    if (!documentPictureInPicture) {
        throw new Error('Document Picture-in-Picture is not supported in this browser.');
    }

    if (isAppPictureInPictureActive()) {
        closeAppPictureInPicture();
        return false;
    }

    const root = document.getElementById(APP_ROOT_ID);
    if (!root?.parentNode) {
        throw new Error(`Cannot find #${APP_ROOT_ID} to move into Picture-in-Picture.`);
    }

    originalParent = root.parentNode;
    restoreAnchor = document.createComment('talos-pip-root-anchor');
    originalParent.insertBefore(restoreAnchor, root);

    try {
        const pipWindow = await documentPictureInPicture.requestWindow({
            width: PIP_WIDTH,
            height: Math.min(PIP_HEIGHT, Math.max(320, Math.round(window.innerHeight * 0.6))),
            disallowReturnToOpener: false,
            preferInitialWindowPlacement: true,
        });

        activePipWindow = pipWindow;
        movedRoot = root;
        preparePictureInPictureDocument(pipWindow);
        mountPlaceholder();
        pipWindow.document.body.append(root);
        pipWindow.addEventListener('resize', handlePictureInPictureResize);
        pipWindow.addEventListener('pagehide', closeAppPictureInPicture, { once: true });
        schedulePictureInPictureViewportSync(pipWindow);
        emitState();
        return true;
    } catch (error) {
        closeAppPictureInPicture();
        throw error;
    }
};

export const toggleAppPictureInPicture = () => (
    isAppPictureInPictureActive() ? Promise.resolve(closeAppPictureInPicture()).then(() => false) : openAppPictureInPicture()
);

export const useAppPictureInPicture = (map?: LeafletMap) => {
    const supported = useMemo(() => isDocumentPictureInPictureSupported(), []);
    const [active, setActive] = useState(isAppPictureInPictureActive);

    useEffect(() => subscribePictureInPictureState(setActive), []);

    useEffect(() => {
        requestAnimationFrame(() => {
            map?.invalidateSize();
        });
    }, [active, map]);

    useEffect(() => subscribeAppViewport(() => {
        requestAnimationFrame(() => {
            map?.invalidateSize();
        });
    }), [map]);

    const toggle = useCallback(async () => {
        if (!supported) return;
        await toggleAppPictureInPicture();
    }, [supported]);

    return {
        active,
        supported,
        toggle,
    };
};
