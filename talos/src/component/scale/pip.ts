import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import L from 'leaflet';
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

type StateListener = (active: boolean) => void;
type ViewportListener = () => void;
type LeafletWithMutableDocument = typeof L & {
    DomEvent?: {
        _pointers?: Record<number, PointerEvent>;
        _pointersCount?: number;
    };
    Draggable?: {
        _dragging?: unknown;
    };
};

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
let placeholder: HTMLElement | null = null;
let rootAttributeObserver: MutationObserver | null = null;
const listeners = new Set<StateListener>();
const viewportListeners = new Set<ViewportListener>();

let nativeDocumentDescriptor: PropertyDescriptor | null = null;
let documentOverride: Document | null = null;
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
    root.style.setProperty('--app-responsive-width', `${PIP_WIDTH}px`);
    root.toggleAttribute('data-pip-mobile', isPipMobileViewport(targetWindow));
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
    window.dispatchEvent(new Event('resize'));
    emitViewport();
};

const handlePictureInPictureResize = () => {
    notifyViewportChanged();
};

const activateDocumentOverride = (targetDocument: Document) => {
    if (!nativeDocumentDescriptor) {
        nativeDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document') ?? null;
    }

    documentOverride = targetDocument;

    try {
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            get: (): Document => {
                if (documentOverride) return documentOverride;
                if (nativeDocumentDescriptor?.get) {
                    return nativeDocumentDescriptor.get.call(globalThis) as Document;
                }
                return window.document;
            },
        });
    } catch (error) {
        console.warn('[PiP] Failed to redirect global document for cross-document drag events.', error);
    }
};

const restoreDocumentOverride = () => {
    documentOverride = null;
    if (!nativeDocumentDescriptor) return;

    try {
        Object.defineProperty(globalThis, 'document', nativeDocumentDescriptor);
    } catch (error) {
        console.warn('[PiP] Failed to restore global document.', error);
    }
};

const resetLeafletDragState = () => {
    const leaflet = L as LeafletWithMutableDocument;
    if (leaflet.Draggable) {
        leaflet.Draggable._dragging = false;
    }
    if (leaflet.DomEvent) {
        leaflet.DomEvent._pointers = {};
        leaflet.DomEvent._pointersCount = 0;
    }
};

const createPlaceholder = () => {
    const node = window.document.createElement('button');
    node.type = 'button';
    node.className = 'talosPipPlaceholder';
    node.setAttribute('aria-label', 'Return map from picture-in-picture');
    node.innerHTML = `
        <span class="talosPipPlaceholderPattern" aria-hidden="true"></span>
        <span class="talosPipPlaceholderCard">
            <img class="talosPipPlaceholderLogo" src="${Icon}" alt="" draggable="false" />
            <span class="talosPipPlaceholderTitle">Picture-in-picture is active</span>
            <span class="talosPipPlaceholderDesc">Click here to return the map to this tab.</span>
        </span>
    `;
    node.addEventListener('click', closeAppPictureInPicture);
    return node;
};

const mountPlaceholder = () => {
    if (placeholder) return;
    placeholder = createPlaceholder();
    window.document.body.append(placeholder);
};

const unmountPlaceholder = () => {
    placeholder?.remove();
    placeholder = null;
};

export const closeAppPictureInPicture = () => {
    const pipWindow = activePipWindow ?? getDocumentPictureInPicture()?.window ?? null;
    const root = movedRoot;

    rootAttributeObserver?.disconnect();
    rootAttributeObserver = null;
    resetLeafletDragState();
    restoreDocumentOverride();
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
        activateDocumentOverride(pipWindow.document);
        pipWindow.addEventListener('resize', handlePictureInPictureResize);
        pipWindow.addEventListener('pagehide', closeAppPictureInPicture, { once: true });
        notifyViewportChanged();
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
