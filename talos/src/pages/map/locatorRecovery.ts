export const LOCATOR_SOCKET_TICKET_REUSE_MS = 90_000;

export type LocatorRecovery = 'socket' | 'poll';

export const selectLocatorRecovery = (input: {
    ticket: string | null;
    ticketIssuedAt: number;
    ticketRejected: boolean;
    now?: number;
}): LocatorRecovery => {
    const now = input.now ?? Date.now();
    return !input.ticketRejected
        && Boolean(input.ticket)
        && input.ticketIssuedAt > 0
        && now - input.ticketIssuedAt <= LOCATOR_SOCKET_TICKET_REUSE_MS
        ? 'socket'
        : 'poll';
};
