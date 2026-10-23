interface Options {
    element: HTMLElement;
    trigger?: HTMLElement | null;
    focusElement?: HTMLElement | null;
    modal?: boolean;
    closeOnEscape?: boolean;
    closeOnOutside?: boolean;
    onDismiss: () => void;
}

type Entry = Options & { restoreFocus: HTMLElement | null; inert: boolean; zIndex: string };
const stacks = new WeakMap<Document, Entry[]>();
const scrollLocks = new WeakMap<Document, string>();
const focusable = 'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';
const contains = (element: HTMLElement | null | undefined, target: EventTarget | null) =>
    Boolean(element && target && 'nodeType' in target && element.contains(target as Node));

/** A document owns its listeners, focus boundary, scroll lock, and overlay order. */
export function registerOverlay(options: Options) {
    const doc = options.element.ownerDocument;
    let stack = stacks.get(doc);
    if (!stack) {
        stack = [];
        stacks.set(doc, stack);
    }
    const entries = stack;
    const entry: Entry = { ...options, restoreFocus: doc.activeElement as HTMLElement | null, inert: Boolean(options.element.inert), zIndex: options.element.style.zIndex };
    // Each registration has a paired cleanup; the first modal restores the
    // original overflow only once the last modal has left this document.
    const previousModal = entries.find((item) => item.modal);
    if (entry.modal) {
        for (const item of [...entries]) {
            if (!item.modal && !contains(entry.element, item.trigger ?? item.element)) item.onDismiss();
        }
    }
    entries.push(entry);
    let disposed = false;
    const sync = () => {
        const topModal = [...entries].reverse().find((item) => item.modal);
        entries.forEach((item, index) => {
            item.element.style.zIndex = String(1000 + index * 10);
            if (item.modal) item.element.inert = item !== topModal || item.inert;
        });
    };
    sync();
    if (entry.modal && !previousModal) {
        scrollLocks.set(doc, doc.body.style.overflow);
        doc.body.style.overflow = 'hidden';
    }

    const isTop = () => entries[entries.length - 1] === entry;
    const onKey = (event: KeyboardEvent) => {
        if (!isTop() || event.defaultPrevented || event.isComposing) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (entry.closeOnEscape !== false) entry.onDismiss();
        } else if (event.key === 'Tab' && entry.modal) {
            const root = entry.focusElement ?? entry.element;
            const nodes = [...root.querySelectorAll<HTMLElement>(focusable)].filter((node) => !node.closest('[inert],[aria-hidden="true"]'));
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (!first || !last) { event.preventDefault(); root.focus(); return; }
            if (event.shiftKey && (doc.activeElement === first || doc.activeElement === root)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === root)) {
                event.preventDefault(); first.focus();
            }
        }
    };
    const onPointer = (event: PointerEvent) => {
        if (isTop() && entry.closeOnOutside && !contains(entry.element, event.target) && !contains(entry.trigger, event.target)) entry.onDismiss();
    };
    const onFocus = (event: FocusEvent) => {
        if (!entry.modal || [...entries].reverse().find((item) => item.modal) !== entry) return;
        const index = entries.indexOf(entry);
        if (entries.slice(index).some((item) => contains(item.element, event.target))) return;
        (entry.focusElement ?? entry.element).focus({ preventScroll: true });
    };
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPointer, true);
    doc.addEventListener('focusin', onFocus, true);
    if (entry.modal) (entry.focusElement ?? entry.element).focus({ preventScroll: true });

    return {
        isTop,
        dispose() {
            if (disposed) return;
            disposed = true;
            const wasTop = isTop();
            entries.splice(entries.indexOf(entry), 1);
            doc.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('pointerdown', onPointer, true);
            doc.removeEventListener('focusin', onFocus, true);
            entry.element.inert = entry.inert;
            entry.element.style.zIndex = entry.zIndex;
            sync();
            if (entry.modal && !entries.some((item) => item.modal)) {
                doc.body.style.overflow = scrollLocks.get(doc) ?? '';
                scrollLocks.delete(doc);
            }
            if (entry.modal && wasTop && entry.restoreFocus?.isConnected && !entry.restoreFocus.closest('[inert]')) entry.restoreFocus.focus({ preventScroll: true });
            if (!entries.length) stacks.delete(doc);
        },
    };
}
