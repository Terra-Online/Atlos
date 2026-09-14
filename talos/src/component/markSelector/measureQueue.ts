type Measurement = () => (() => void) | undefined;
const pending = new Set<Measurement>();
let firstFrame = 0, secondFrame = 0;

/** All selectors read layout before any selector writes React state. */
export function measureSelector(read: Measurement): () => void {
    pending.add(read);
    if (!firstFrame && !secondFrame) firstFrame = requestAnimationFrame(() => {
        firstFrame = 0;
        secondFrame = requestAnimationFrame(() => {
            secondFrame = 0;
            const batch = [...pending]; pending.clear();
            const writes = batch.map(measure => measure());
            for (const write of writes) write?.();
        });
    });
    return () => {
        pending.delete(read);
        if (!pending.size) { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); firstFrame = secondFrame = 0; }
    };
}
