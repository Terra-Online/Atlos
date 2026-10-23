let requestHandler: (() => Promise<void>) | null = null;
const additionalRequestHandlers = new Set<() => Promise<void>>();

export const setProgressSyncRequestHandler = (handler: (() => Promise<void>) | null): void => {
    requestHandler = handler;
};

export const addProgressSyncRequestHandler = (handler: () => Promise<void>): (() => void) => {
    additionalRequestHandlers.add(handler);
    return () => additionalRequestHandlers.delete(handler);
};

export const requestProgressSyncNow = async (): Promise<void> => {
    const handlers = [
        ...(requestHandler ? [requestHandler] : []),
        ...additionalRequestHandlers,
    ];
    await Promise.all(handlers.map((handler) => handler()));
};
