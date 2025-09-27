class Logger {
    constructor() {
        // this.isDebugEnabled = process.env.NODE_ENV === 'development';
        // if (!this.isDebugEnabled) {
        //     console.debug = function() {};
        // }
    }

    debug(...args) {
        console.info('[DEBUG]', ...args);
    }

    info(...args) {
        console.info('[INFO]', ...args);
    }

    warn(...args) {
        //console.warn('[WARN]', ...args);
    }

    error(...args) {
        console.error('[ERROR]', ...args);
    }
}
const LOGGER = new Logger();
export default LOGGER;
