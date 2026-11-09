import { retryLoad } from '@/lib/async/retryLoad';
import { getEFBindingStatus } from '@/services/endfield';

export const isBindingUnauthorized = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'status' in error && error.status === 401;

/** A failed lookup is unknown, never evidence that the account is unbound. */
export const loadBindingStatus = (signal: AbortSignal) => retryLoad(getEFBindingStatus, {
    signal,
    onRetry: (error) => {
        // Authentication needs a user action; retrying the same expired cookie
        // would keep a dead session busy indefinitely.
        if (isBindingUnauthorized(error)) throw error;
    },
});
