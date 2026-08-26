import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TalosMap } from '@/component/mapCore/engine';
import { useTranslateUI } from '@/locale';
import Icon from '../../assets/images/UI/observator_6.webp';
import {
    createAppViewport,
    PIP_HEIGHT,
    PIP_MIN_HEIGHT,
    PIP_WIDTH,
} from './pipViewport';

export { PIP_UI_MINIMUM_EDGE } from './pipViewport';

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
type SvgElementInstanceConstructor = {
    new(): SvgElementInstanceLike;
};

type WindowWithSvgElementInstance = Window & {
    SVGElementInstance?: SvgElementInstanceConstructor;
};

type NodeLike = {
    ownerDocument?: Document | null;
};

type MirroredStyleElement = HTMLLinkElement | HTMLStyleElement;
type FontFaceSetLoadEventLike = Event & {
    fontfaces?: readonly FontFace[];
};

const isElement = (value: unknown): value is Element => (
    typeof Element !== 'undefined' && value instanceof Element
);

const APP_ROOT_ID = 'root';
const SYNCED_ROOT_ATTRIBUTES = ['class', 'style', 'lang', 'dir', 'data-theme', 'data-schema', 'data-theme-switching'];

let activePipWindow: Window | null = null;
let movedRoot: HTMLElement | null = null;
let restoreAnchor: Comment | null = null;
let originalParent: Node | null = null;
let placeholderCleanup: (() => void) | null = null;
let rootAttributeObserver: MutationObserver | null = null;
let documentResourceMirrorCleanup: (() => void) | null = null;
let waitForMirroredStyles: (() => Promise<void>) | null = null;
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

export const waitForPictureInPictureStyles = (): Promise<void> => (
    waitForMirroredStyles?.() ?? Promise.resolve()
);

export const getAppViewport = () => {
    const pipWindow = activePipWindow && !activePipWindow.closed ? activePipWindow : null;
    const sourceWindow = pipWindow ?? window;
    return createAppViewport(
        sourceWindow.innerWidth,
        sourceWindow.innerHeight,
        Boolean(pipWindow),
    );
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
    return createAppViewport(targetWindow.innerWidth, targetWindow.innerHeight, true).isPipMobile;
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

const STYLE_SOURCE_SELECTOR = 'link[rel="stylesheet"], style';

const cloneStyleElement = (source: MirroredStyleElement): MirroredStyleElement => {
    const clone = source.cloneNode(true) as MirroredStyleElement;
    if (source instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) {
        clone.href = source.href;
        clone.disabled = source.disabled;
    }
    return clone;
};

const syncStyleElement = (source: MirroredStyleElement, clone: MirroredStyleElement) => {
    for (const attribute of Array.from(clone.attributes)) {
        if (!source.hasAttribute(attribute.name)) clone.removeAttribute(attribute.name);
    }
    for (const attribute of Array.from(source.attributes)) {
        if (source instanceof HTMLLinkElement && attribute.name === 'href') continue;
        if (clone.getAttribute(attribute.name) !== attribute.value) {
            clone.setAttribute(attribute.name, attribute.value);
        }
    }

    if (source instanceof HTMLLinkElement && clone instanceof HTMLLinkElement) {
        if (clone.href !== source.href) clone.href = source.href;
        clone.disabled = source.disabled;
    } else if (source instanceof HTMLStyleElement && clone instanceof HTMLStyleElement
        && clone.textContent !== source.textContent) {
        clone.textContent = source.textContent;
    }
};

const mirrorDocumentStyles = (source: Document, target: Document) => {
    const clones = new Map<MirroredStyleElement, MirroredStyleElement>();
    const pendingLinks = new Map<HTMLLinkElement, Promise<void>>();

    const trackLink = (link: HTMLLinkElement) => {
        const ready = new Promise<void>((resolve) => {
            const settle = () => {
                link.removeEventListener('load', settle);
                link.removeEventListener('error', settle);
                resolve();
            };
            link.addEventListener('load', settle, { once: true });
            link.addEventListener('error', settle, { once: true });
            queueMicrotask(() => {
                if (link.sheet || link.disabled) settle();
            });
        });
        pendingLinks.set(link, ready);
    };

    const reconcile = () => {
        const sources = Array.from(
            source.head.querySelectorAll<MirroredStyleElement>(STYLE_SOURCE_SELECTOR),
        );
        const currentSources = new Set(sources);

        for (const [sourceNode, clone] of clones) {
            if (!currentSources.has(sourceNode)) {
                clone.remove();
                if (clone instanceof HTMLLinkElement) pendingLinks.delete(clone);
                clones.delete(sourceNode);
            }
        }

        sources.forEach((sourceNode, index) => {
            let clone = clones.get(sourceNode);
            if (!clone) {
                clone = cloneStyleElement(sourceNode);
                clones.set(sourceNode, clone);
                if (clone instanceof HTMLLinkElement) trackLink(clone);
            } else {
                syncStyleElement(sourceNode, clone);
            }

            const nextClone = sources
                .slice(index + 1)
                .map((candidate) => clones.get(candidate))
                .find((candidate): candidate is MirroredStyleElement => Boolean(candidate));
            if (!clone.isConnected || (nextClone && clone.nextElementSibling !== nextClone)) {
                target.head.insertBefore(clone, nextClone ?? null);
            }
        });
    };

    const observer = new MutationObserver(reconcile);
    observer.observe(source.head, {
        attributes: true,
        characterData: true,
        childList: true,
        subtree: true,
    });
    reconcile();

    return {
        cleanup: () => {
            observer.disconnect();
            clones.forEach((clone) => clone.remove());
            clones.clear();
            pendingLinks.clear();
        },
        waitForReady: async () => {
            reconcile();
            await Promise.all(pendingLinks.values());
        },
    };
};

const mirrorDocumentFonts = (source: Document, target: Document): (() => void) => {
    const addFaces = (faces: Iterable<FontFace>) => {
        for (const face of faces) {
            try {
                target.fonts.add(face);
            } catch {
                // CSS-connected faces are supplied by the mirrored stylesheets.
            }
        }
    };
    const handleLoadingDone = (event: Event) => {
        addFaces((event as FontFaceSetLoadEventLike).fontfaces ?? []);
    };

    addFaces(source.fonts);
    source.fonts.addEventListener('loadingdone', handleLoadingDone);
    return () => source.fonts.removeEventListener('loadingdone', handleLoadingDone);
};

const preparePictureInPictureDocument = (pipWindow: Window) => {
    const pipDocument = pipWindow.document;
    pipDocument.title = document.title;
    pipDocument.head.replaceChildren();
    pipDocument.body.replaceChildren();
    pipDocument.body.style.margin = '0';
    pipDocument.body.style.overflow = 'hidden';
    const base = pipDocument.createElement('base');
    base.href = document.baseURI;
    pipDocument.head.append(base);
    documentResourceMirrorCleanup?.();
    const styleMirror = mirrorDocumentStyles(document, pipDocument);
    const cleanupFonts = mirrorDocumentFonts(document, pipDocument);
    waitForMirroredStyles = styleMirror.waitForReady;
    documentResourceMirrorCleanup = () => {
        styleMirror.cleanup();
        cleanupFonts();
        waitForMirroredStyles = null;
    };
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

// ---------------------------------------------------------------------------
// PiP 地图拖拽转发
//
// 旧实现 monkeypatch L.Draggable 原型，把 PiP document 内的指针事件接进
// Leaflet 的拖拽状态机。迁移后改为独立实现：在地图容器上以捕获阶段监听
// mousedown/touchstart，仅当事件发生在 PiP document 时接管（阻断 MapLibre
// 原生 dragPan，避免双重平移），随后用 jumpToGame 同步驱动相机，并通过
// beginCameraGesture/endCameraGesture 把整次拖拽合并成一对
// movestart/moveend（与原生拖拽一致）。
// ---------------------------------------------------------------------------

const PIP_DRAG_CLICK_TOLERANCE = 3;

type PipDragSession = {
    map: TalosMap;
    container: HTMLElement;
    targetDocument: Document;
    targetWindow: Window;
    isTouch: boolean;
    startClientX: number;
    startClientY: number;
    lastClientX: number;
    lastClientY: number;
    moved: boolean;
    lastTarget: Element | null;
    restoreOutline: (() => void) | null;
    cleanupGuards: () => void;
    onMove: (event: Event) => void;
    onUp: (event: Event) => void;
};

let pipDragSession: PipDragSession | null = null;
const pipDragForwardingContainers = new WeakSet<HTMLElement>();

const preventEventDefault = (event: Event) => {
    event.preventDefault();
};

const disableScopedTextSelection = (targetWindow: Window) => {
    targetWindow.addEventListener('selectstart', preventEventDefault);
    return () => {
        targetWindow.removeEventListener('selectstart', preventEventDefault);
    };
};

const disableScopedImageDrag = (targetWindow: Window) => {
    targetWindow.addEventListener('dragstart', preventEventDefault);
    return () => {
        targetWindow.removeEventListener('dragstart', preventEventDefault);
    };
};

// 拖拽期间隐藏焦点 outline（keydown 或拖拽结束时恢复），与旧补丁一致
const preventScopedOutline = (container: HTMLElement, targetWindow: Window): (() => void) | null => {
    let element: HTMLElement | null = container;
    while (element && element.tabIndex === -1 && element.parentElement) {
        element = element.parentElement;
    }
    if (!element?.style) return null;

    const outlineElement = element;
    const previousOutline = outlineElement.style.outlineStyle;
    outlineElement.style.outlineStyle = 'none';

    const restoreOutline = () => {
        outlineElement.style.outlineStyle = previousOutline;
        targetWindow.removeEventListener('keydown', restoreOutline);
    };
    targetWindow.addEventListener('keydown', restoreOutline);
    return restoreOutline;
};

// 越过 clickTolerance 后正式开始拖拽：class 与事件对齐原生拖拽语义
const startPipDrag = (session: PipDragSession, event: Event) => {
    session.moved = true;
    session.map.beginCameraGesture(false);
    session.container.classList.add('leaflet-dragging');
    session.targetDocument.body.classList.add('leaflet-dragging');
    session.map.fire('dragstart');

    const rawTarget = event.target;
    const target = isElement(rawTarget) ? rawTarget : null;
    const svgElementInstance = (session.targetWindow as WindowWithSvgElementInstance).SVGElementInstance;
    session.lastTarget = svgElementInstance && target instanceof svgElementInstance
        ? (target.correspondingUseElement ?? null)
        : target;
    session.lastTarget?.classList.add('leaflet-drag-target');
};

const handlePipDragMove = (session: PipDragSession, event: Event) => {
    const touchEvent = session.isTouch ? (event as TouchEvent) : null;
    if (touchEvent && touchEvent.touches.length > 1) {
        // 多点触摸：标记为已移动（等价旧补丁的点击抑制语义），不再平移
        session.moved = true;
        return;
    }

    const pointer = touchEvent ? touchEvent.touches[0] : (event as MouseEvent);
    if (!pointer || typeof pointer.clientX !== 'number' || typeof pointer.clientY !== 'number') return;

    const totalX = pointer.clientX - session.startClientX;
    const totalY = pointer.clientY - session.startClientY;
    if (!totalX && !totalY) return;

    if (!session.moved) {
        if (Math.abs(totalX) + Math.abs(totalY) < PIP_DRAG_CLICK_TOLERANCE) return;
        startPipDrag(session, event);
    }

    event.preventDefault();

    const deltaX = pointer.clientX - session.lastClientX;
    const deltaY = pointer.clientY - session.lastClientY;
    session.lastClientX = pointer.clientX;
    session.lastClientY = pointer.clientY;
    if (!deltaX && !deltaY) return;

    // 指针与地图内容同向移动：相机中心按反向屏幕像素平移
    const centerPoint = session.map.latLngToContainerPoint(session.map.getCenter());
    const nextCenter = session.map.containerPointToLatLng([
        centerPoint.x - deltaX,
        centerPoint.y - deltaY,
    ]);
    session.map.jumpToGame(nextCenter, session.map.getZoom());
    session.map.fire('drag');
};

// 结束拖拽（noInertia 保留在 dragend payload 中，与旧补丁一致）
const finishPipDrag = (noInertia?: boolean) => {
    const session = pipDragSession;
    if (!session) return;
    pipDragSession = null;

    session.targetDocument.removeEventListener('mousemove', session.onMove);
    session.targetDocument.removeEventListener('touchmove', session.onMove);
    session.targetDocument.removeEventListener('mouseup', session.onUp);
    session.targetDocument.removeEventListener('touchend', session.onUp);
    session.targetDocument.removeEventListener('touchcancel', session.onUp);
    session.cleanupGuards();
    session.restoreOutline?.();

    session.container.classList.remove('leaflet-dragging');
    session.targetDocument.body.classList.remove('leaflet-dragging');
    session.lastTarget?.classList.remove('leaflet-drag-target');
    session.lastTarget = null;

    if (session.moved) {
        const distance = Math.hypot(
            session.lastClientX - session.startClientX,
            session.lastClientY - session.startClientY,
        );
        session.map.fire('dragend', { noInertia, distance });
        session.map.endCameraGesture(false);

        // 与 Leaflet 一致：拖拽结束后紧跟的 click 不再派发到地图
        const suppressClick = (clickEvent: Event) => {
            clickEvent.stopImmediatePropagation();
            session.container.removeEventListener('click', suppressClick, true);
        };
        session.container.addEventListener('click', suppressClick, true);
    }
};

const beginPipDrag = (map: TalosMap, container: HTMLElement, event: MouseEvent | TouchEvent) => {
    const pipDocument = getPictureInPictureDocument();
    // 非 PiP 文档的事件交给 MapLibre 原生 dragPan
    if (!pipDocument || eventDocument(event, container) !== pipDocument) return;

    // 拖拽被禁用时不接管（原生 dragPan 同样处于禁用态，无需阻断）
    if (!map.dragging.isEnabled()) return;
    // 动画缩放期间不启动拖拽（等价旧补丁的 leaflet-zoom-anim 检查）
    if (container.classList.contains('leaflet-zoom-anim')) {
        event.stopImmediatePropagation();
        return;
    }

    const touches = (event as TouchEvent).touches;
    if (touches && touches.length !== 1) {
        // 多点触摸：结束进行中的拖拽，交给原生捏合手势
        finishPipDrag(true);
        return;
    }

    if (pipDragSession || event.shiftKey
        || (!touches && (event as MouseEvent).which !== 1 && (event as MouseEvent).button !== 1)) {
        // 与旧补丁一致：这些情况不启动拖拽，同时阻断原生 handler 保持行为一致
        event.stopImmediatePropagation();
        return;
    }

    const first = touches ? touches[0] : (event as MouseEvent);
    if (typeof first?.clientX !== 'number' || typeof first.clientY !== 'number') return;

    event.stopImmediatePropagation();
    finishPipDrag(true); // 防御：清理残留会话

    const targetWindow = eventWindow(event, container);
    const restoreImageDrag = disableScopedImageDrag(targetWindow);
    const restoreTextSelection = disableScopedTextSelection(targetWindow);

    const session: PipDragSession = {
        map,
        container,
        targetDocument: pipDocument,
        targetWindow,
        isTouch: Boolean(touches),
        startClientX: first.clientX,
        startClientY: first.clientY,
        lastClientX: first.clientX,
        lastClientY: first.clientY,
        moved: false,
        lastTarget: null,
        restoreOutline: preventScopedOutline(container, targetWindow),
        cleanupGuards: () => {
            restoreImageDrag();
            restoreTextSelection();
        },
        onMove: () => undefined,
        onUp: () => undefined,
    };
    session.onMove = (moveEvent) => handlePipDragMove(session, moveEvent);
    session.onUp = () => finishPipDrag();
    pipDragSession = session;

    if (session.isTouch) {
        // touchmove 需要 passive: false 才能 preventDefault
        pipDocument.addEventListener('touchmove', session.onMove, { passive: false });
        pipDocument.addEventListener('touchend', session.onUp);
        pipDocument.addEventListener('touchcancel', session.onUp);
    } else {
        pipDocument.addEventListener('mousemove', session.onMove);
        pipDocument.addEventListener('mouseup', session.onUp);
    }
};

// 每个地图容器只安装一次（WeakSet 防重，UIOverlay 与 Scale 都会触发 hook）
const installPipDragForwarding = (map: TalosMap) => {
    const container = map.getContainer();
    if (pipDragForwardingContainers.has(container)) return;
    pipDragForwardingContainers.add(container);

    const onMouseDown = (event: MouseEvent) => beginPipDrag(map, container, event);
    const onTouchStart = (event: TouchEvent) => beginPipDrag(map, container, event);
    container.addEventListener('mousedown', onMouseDown, true);
    container.addEventListener('touchstart', onTouchStart, true);
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
    documentResourceMirrorCleanup?.();
    documentResourceMirrorCleanup = null;
    waitForMirroredStyles = null;
    finishPipDrag(true); // 结束未完成的 PiP 拖拽（等价旧 resetLeafletDragState）
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
            height: Math.min(PIP_HEIGHT, Math.max(PIP_MIN_HEIGHT, Math.round(window.innerHeight * 0.6))),
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

export const useAppPictureInPicture = (map?: TalosMap) => {
    const supported = useMemo(() => isDocumentPictureInPictureSupported(), []);
    const [active, setActive] = useState(isAppPictureInPictureActive);

    useEffect(() => subscribePictureInPictureState(setActive), []);

    useEffect(() => {
        requestAnimationFrame(() => {
            map?.invalidateSize();
        });
    }, [active, map]);
    // 安装 PiP 拖拽转发（每容器幂等一次）
    useEffect(() => {
        if (!map) return;
        installPipDragForwarding(map);
    }, [map]);

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
