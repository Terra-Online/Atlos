type Measurement = () => (() => void) | undefined;
interface Queue {
    pending: Set<Measurement>;
    targets: Map<Element, Measurement>;
    frame: number;
    observer?: ResizeObserver;
    schedule: () => void;
}
const queues = new WeakMap<Window, Queue>();

/** Bound layout work, and read every box in a batch before writing React state. */
export function measureSelector(read: Measurement, view: Window = window, target?: Element): () => void {
    let queue = queues.get(view);
    if (!queue) {
        const active: Queue = { pending: new Set(), targets: new Map(), frame: 0, schedule: () => {} };
        active.schedule = () => {
            if (active.frame || !active.pending.size) return;
            active.frame = view.requestAnimationFrame(() => {
                active.frame = 0;
                const batch = [...active.pending].slice(0, 24);
                for (const measure of batch) active.pending.delete(measure);
                const writes = batch.map(measure => measure());
                for (const write of writes) write?.();
                active.schedule();
            });
        };
        queues.set(view, active); queue = active;
    }
    const active = queue;
    if (target) {
        if (!active.observer) {
            const Observer = target.ownerDocument.defaultView?.ResizeObserver;
            if (Observer) active.observer = new Observer(entries => {
                for (const entry of entries) {
                    const measure = active.targets.get(entry.target);
                    if (measure) active.pending.add(measure);
                }
                active.schedule();
            });
        }
        active.targets.set(target, read); active.observer?.observe(target);
    }
    active.pending.add(read); active.schedule();
    return () => {
        active.pending.delete(read);
        if (target) { active.targets.delete(target); active.observer?.unobserve(target); }
        if (!active.pending.size) { view.cancelAnimationFrame(active.frame); active.frame = 0; }
        if (!active.targets.size) { active.observer?.disconnect(); active.observer = undefined; }
    };
}
