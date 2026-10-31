import { vi } from 'vitest';

/** Explicit layout inputs: jsdom has no layout, top layer, or pointer capture. */
export function setRect(element: Element, x: number, y: number, width: number, height: number) {
    const rect = new globalThis.DOMRect(x, y, width, height);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(element, 'getClientRects').mockReturnValue({
        0: rect,
        length: 1,
        item: (index) => index === 0 ? rect : null,
        [Symbol.iterator]: () => [rect][Symbol.iterator](),
    });
    return rect;
}

export function setScrollMetrics(element: HTMLElement, clientHeight: number, scrollHeight: number, scrollTop = 0) {
    Object.defineProperties(element, {
        clientHeight: { configurable: true, value: clientHeight },
        scrollHeight: { configurable: true, value: scrollHeight },
    });
    element.scrollTop = scrollTop;
}

export function installResizeObserver() {
    const observers: Observer[] = [];
    class Observer implements ResizeObserver {
        readonly targets = new Set<Element>();
        constructor(readonly callback: ResizeObserverCallback) { observers.push(this); }
        observe(target: Element) { this.targets.add(target); }
        unobserve(target: Element) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    return {
        observers,
        notify(target?: Element) {
            for (const observer of observers) {
                const targets = [...observer.targets].filter((element) => !target || element === target);
                if (!targets.length) continue;
                observer.callback(targets.map((element) => {
                    const rect = element.getBoundingClientRect();
                    const size = [{ inlineSize: rect.width, blockSize: rect.height }];
                    return { target: element, contentRect: rect, borderBoxSize: size, contentBoxSize: size, devicePixelContentBoxSize: size };
                }), observer);
            }
        },
    };
}

/** Models API state only; it does not claim to reproduce browser paint order. */
export function installPopover() {
    const prototype = globalThis.HTMLElement.prototype;
    const originals = new Map(['showPopover', 'hidePopover'].map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
    const open = new WeakSet<Element>();
    const keyboard = new WeakSet<Element>();
    const matches = (element: HTMLElement, selector: string) => globalThis.Element.prototype.matches.call(element, selector);
    const show = vi.fn(function (this: HTMLElement) { open.add(this); });
    const hide = vi.fn(function (this: HTMLElement) { open.delete(this); });
    Object.defineProperties(prototype, {
        showPopover: { configurable: true, value: show },
        hidePopover: { configurable: true, value: hide },
    });
    const match = vi.spyOn(prototype, 'matches').mockImplementation(function (this: HTMLElement, selector) {
        if (selector === ':popover-open') return open.has(this);
        if (selector === ':focus-visible') return keyboard.has(this);
        return matches(this, selector);
    });
    return {
        show, hide,
        // The browser removes a disconnected popover from the top layer.
        isOpen: (element: Element) => element.isConnected && open.has(element),
        focusVisible(element: HTMLElement) { keyboard.add(element); element.focus(); },
        restore() {
            match.mockRestore();
            for (const [key, original] of originals) {
                if (original) Object.defineProperty(prototype, key, original);
                else Reflect.deleteProperty(prototype, key);
            }
        },
    };
}

export function installPointerCapture() {
    class Pointer extends globalThis.MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        readonly isPrimary: boolean;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerId = init.pointerId ?? 1;
            this.pointerType = init.pointerType ?? 'mouse';
            this.isPrimary = init.isPrimary ?? true;
        }
    }
    vi.stubGlobal('PointerEvent', Pointer);
    const captures = new WeakMap<Element, Set<number>>();
    const prototype = globalThis.HTMLElement.prototype;
    const originals = new Map(['setPointerCapture', 'hasPointerCapture', 'releasePointerCapture'].map((key) => [key, Object.getOwnPropertyDescriptor(prototype, key)]));
    Object.defineProperties(prototype, {
        setPointerCapture: { configurable: true, value(this: Element, id: number) {
            const ids = captures.get(this) ?? new Set<number>();
            ids.add(id);
            captures.set(this, ids);
        } },
        hasPointerCapture: { configurable: true, value(this: Element, id: number) { return captures.get(this)?.has(id) ?? false; } },
        releasePointerCapture: { configurable: true, value(this: Element, id: number) { captures.get(this)?.delete(id); } },
    });
    return () => {
        for (const [key, original] of originals) {
            if (original) Object.defineProperty(prototype, key, original);
            else Reflect.deleteProperty(prototype, key);
        }
    };
}
