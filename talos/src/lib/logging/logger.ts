class Logger {
    private onceSet = new Set<string>();
    private enabled = false;

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
    }

    // debug only in dev to reduce noise in production
    debug(...args: unknown[]) {
        if (!this.enabled) return;
        // vite exposes import.meta.env.DEV
        if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
            console.info('[DEBUG]', ...args);
        }
    }

    info(...args: unknown[]) {
        if (!this.enabled) return;
        console.info('[INFO]', ...args);
    }

    warn(...args: unknown[]) {
        if (!this.enabled) return;
        console.warn('[WARN]', ...args);
    }

    warnOnce(id: string, ...args: unknown[]) {
        if (!this.enabled) return;
        if (this.onceSet.has(id)) return;
        this.onceSet.add(id);
        this.warn(...args);
    }

    error(...args: unknown[]) {
        if (!this.enabled) return;
        console.error('[ERROR]', ...args);
    }
}
const LOGGER = new Logger();
export default LOGGER;
