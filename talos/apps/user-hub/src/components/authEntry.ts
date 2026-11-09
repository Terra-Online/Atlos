import type AuthGate from './authGate';

let gate: typeof AuthGate | null = null;
let pending: Promise<typeof AuthGate> | undefined;

export const getAuthGate = () => gate;

// Share in-flight loads and successful modules. A rejected transport attempt
// must be released so an active loader can try again.
export const loadAuthGate = (): Promise<typeof AuthGate> =>
    (pending ??= import('./authGate').then((module) => {
        gate = module.default;
        return gate;
    }).catch((error: unknown) => {
        pending = undefined;
        throw error;
    }));
