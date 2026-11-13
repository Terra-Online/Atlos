/** Coalesce camera updates per display frame; animate only while requested. */
export function scheduleMinimap(draw: () => boolean | void) {
    let pending = false;
    let disposed = false;
    let frame: number | undefined;
    const cancel = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
    };
    const schedule = () => {
        if (disposed || !pending || document.hidden || frame !== undefined)
            return;
        frame = requestAnimationFrame(() => {
            frame = undefined;
            if (document.hidden || disposed) return;
            pending = false;
            if (draw()) pending = true;
            schedule();
        });
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
