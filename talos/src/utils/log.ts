class Logger {
    private onceSet = new Set<string>();

    // debug only in dev to reduce noise in production
    debug(...args: any[]) {
        // vite exposes import.meta.env.DEV
        if (typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV) {
            console.info('[DEBUG]', ...args);
        }
    }

    info(...args: any[]) {
        console.info('[INFO]', ...args);
    }

    warn(...args: any[]) {
        console.warn('[WARN]', ...args);
    }

    warnOnce(id: string, ...args: any[]) {
        if (this.onceSet.has(id)) return;
        this.onceSet.add(id);
        this.warn(...args);
    }

    error(...args: any[]) {
        console.error('[ERROR]', ...args);
    }
}
const LOGGER = new Logger();
export default LOGGER;
