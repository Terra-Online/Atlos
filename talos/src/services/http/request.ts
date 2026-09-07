import { requestSessionRevalidation } from '@/services/auth/sessionEvents';

export class HttpRequestError extends Error {
    readonly status: number;
    readonly payload?: unknown;

    constructor(message: string, status: number, payload?: unknown) {
        super(message);
        this.name = 'HttpRequestError';
        this.status = status;
        this.payload = payload;
    }
}

export type HttpErrorDecoder = (response: Response) => Promise<Error>;

export const requestJson = async <T,>(
    baseUrl: string,
    path: string,
    init: RequestInit = {},
    decodeError?: HttpErrorDecoder,
): Promise<T> => {
    const headers = new Headers(init.headers);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && init.body !== null && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        credentials: init.credentials ?? 'include',
        headers,
    });

    if (!response.ok) {
        if (response.status === 401) requestSessionRevalidation();
        if (decodeError) throw await decodeError(response);
        throw new HttpRequestError(`HTTP ${response.status}`, response.status);
    }

    return response.json() as Promise<T>;
};
