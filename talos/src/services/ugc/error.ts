export class UGCClientError extends Error {
    readonly code: string;
    readonly status?: number;

    constructor(message: string, code = 'UGC_ERROR', status?: number) {
        super(message);
        this.name = 'UGCClientError';
        this.code = code;
        this.status = status;
    }
}
