import type AuthGate from './authGate';

let gate: typeof AuthGate | null = null;
let pending: Promise<typeof AuthGate> | undefined;

export const getAuthGate = () => gate;

// The overview request and renderer share one load. Keep failures for the loader's
// retry UI; a full reload also recovers a stale or failed module URL.
export const loadAuthGate = (): Promise<typeof AuthGate> =>
    (pending ??= import('./authGate').then((module) => {
        gate = module.default;
        return gate;
    }));
