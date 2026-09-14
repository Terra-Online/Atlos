export const SESSION_REVALIDATE_EVENT = 'oem:session-revalidate';

export const requestSessionRevalidation = (): void => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(SESSION_REVALIDATE_EVENT));
    }
};
