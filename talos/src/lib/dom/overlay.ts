interface Options {
    element: HTMLElement;
    trigger?: HTMLElement | null;
    focusElement?: HTMLElement | null;
    modal?: boolean;
    active?: boolean;
    restoreFocus?: boolean;
    closeOnEscape?: boolean;
    closeOnOutside?: boolean;
    onDismiss: () => void;
}

type Entry = Options & { active: boolean; dismissed: boolean; previousFocus: HTMLElement | null; inert: boolean; zIndex: string };
const stacks = new WeakMap<Document, ReturnType<typeof createStack>>();
const focusable = 'a[href],button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])';
const contains = (element: HTMLElement | null | undefined, target: EventTarget | null) =>
    Boolean(element && target && 'nodeType' in target && element.contains(target as Node));
const dismiss = (entry: Entry) => {
    if (!entry.active || entry.dismissed) return;
    entry.dismissed = true;
    entry.onDismiss();
};

function createStack(doc: Document) {
    const entries: Entry[] = [];
    let overflow: string | undefined;
    const topModal = () => [...entries].reverse().find((entry) => entry.modal);
    const sync = () => {
        const modal = topModal();
        const modalIndex = modal ? entries.indexOf(modal) : -1;
        entries.forEach((entry, index) => {
            entry.element.style.zIndex = String(1000 + index * 10);
            entry.element.toggleAttribute('inert', entry.inert || !entry.active || index < modalIndex);
        });
        if (modal && overflow === undefined) { overflow = doc.body.style.overflow; doc.body.style.overflow = 'hidden'; }
        else if (!modal && overflow !== undefined) { doc.body.style.overflow = overflow; overflow = undefined; }
    };
    const onKey = (event: KeyboardEvent) => {
        if (event.defaultPrevented || event.isComposing) return;
        const top = entries[entries.length - 1];
        if (event.key === 'Escape' && top) {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (top.closeOnEscape !== false) dismiss(top);
        } else if (event.key === 'Tab') {
            const modal = topModal();
            if (!modal) return;
            if (!modal.active) { event.preventDefault(); return; }
            const root = modal.focusElement ?? modal.element;
            // Menus above the modal own their Tab behavior; hover tooltips do not.
            if (!contains(root, doc.activeElement)) return;
            const nodes = [...root.querySelectorAll<HTMLElement>(focusable)].filter((node) =>
                !node.closest('[inert],[hidden],[aria-hidden="true"]') && node.getClientRects().length > 0);
            const first = nodes[0];
            const last = nodes[nodes.length - 1];
            if (!first || !last) { event.preventDefault(); root.focus(); }
            else if (event.shiftKey && (doc.activeElement === first || doc.activeElement === root)) {
                event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === root)) {
                event.preventDefault(); first.focus();
            }
        }
    };
    const onPointer = (event: PointerEvent) => {
        const top = entries[entries.length - 1];
        if (top?.closeOnOutside && !contains(top.element, event.target) && !contains(top.trigger, event.target)) dismiss(top);
    };
    const onFocus = (event: FocusEvent) => {
        const modal = topModal();
        if (!modal?.active) return;
        if (entries.slice(entries.indexOf(modal)).some((entry) => contains(entry.element, event.target))) return;
        (modal.focusElement ?? modal.element).focus({ preventScroll: true });
    };
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('pointerdown', onPointer, true);
    doc.addEventListener('focusin', onFocus, true);
    return { entries, sync, dispose() {
        doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('pointerdown', onPointer, true);
        doc.removeEventListener('focusin', onFocus, true);
        stacks.delete(doc);
    } };
}

/** Each document owns one listener set, its modal focus boundary, and scroll lock. */
export function registerOverlay(options: Options) {
    const doc = options.element.ownerDocument;
    const stack = stacks.get(doc) ?? createStack(doc);
    stacks.set(doc, stack);
    const { entries, sync } = stack;
    const entry: Entry = { ...options, active: options.active ?? true, dismissed: false, previousFocus: doc.activeElement as HTMLElement | null, inert: options.element.hasAttribute('inert'), zIndex: options.element.style.zIndex };
    entries.push(entry);
    if (entry.modal) entries.filter((item) => !item.modal && !contains(entry.element, item.trigger ?? item.element)).forEach(dismiss);
    sync();
    if (entry.modal && entry.active) (entry.focusElement ?? entry.element).focus({ preventScroll: true });
    let disposed = false;
    const isTop = () => entries[entries.length - 1] === entry;
    return {
        isTop,
        setActive(active: boolean) {
            entry.active = active;
            if (active) entry.dismissed = false;
            sync();
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            const restore = (entry.restoreFocus ?? entry.modal) && (isTop() || contains(entry.element, doc.activeElement));
            entries.splice(entries.indexOf(entry), 1);
            entry.element.toggleAttribute('inert', entry.inert);
            entry.element.style.zIndex = entry.zIndex;
            sync();
            if (restore && entry.previousFocus?.isConnected && !entry.previousFocus.closest('[inert]')) entry.previousFocus.focus({ preventScroll: true });
            if (!entries.length) stack.dispose();
        },
    };
}

/** Transient UI closes before its anchors move to another document. */
export function dismissTransientOverlays(doc: Document) {
    const stack = stacks.get(doc);
    for (const entry of [...(stack?.entries ?? [])]) {
        if (entry.modal) continue;
        dismiss(entry);
        entry.active = false;
    }
    stack?.sync();
}
