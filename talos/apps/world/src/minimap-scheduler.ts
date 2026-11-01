/** Sample only when needed, at most 30 Hz; hidden tabs retain one pending update. */
export function scheduleMinimap(draw: () => void) {
    let pending = false;
    let disposed = false;
    let last = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame: number | undefined;
    const cancel = () => {
        clearTimeout(timer);
        if (frame !== undefined) cancelAnimationFrame(frame);
        timer = undefined;
        frame = undefined;
    };
    const schedule = () => {
        if (
            disposed ||
            !pending ||
            document.hidden ||
            timer !== undefined ||
            frame !== undefined
        )
            return;
        const wait = Math.max(0, 1000 / 30 - (performance.now() - last));
        timer = setTimeout(() => {
            timer = undefined;
            frame = requestAnimationFrame(() => {
                frame = undefined;
                if (document.hidden || disposed) return;
                pending = false;
                last = performance.now();
                draw();
            });
        }, wait);
    };
    const visibility = () => {
        if (document.hidden) cancel();
        else schedule();
    };
    document.addEventListener('visibilitychange', visibility);
    return {
        request: () => {
            pending = true;
            schedule();
        },
        destroy() {
            disposed = true;
            cancel();
            document.removeEventListener('visibilitychange', visibility);
        },
    };
}
