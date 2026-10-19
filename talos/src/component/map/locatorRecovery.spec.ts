import { describe, expect, it } from 'vitest';
import { LOCATOR_SOCKET_TICKET_REUSE_MS, selectLocatorRecovery } from './locatorRecovery';

describe('locator connection recovery', () => {
    it('reuses a fresh socket ticket without another authenticated position read', () => {
        expect(selectLocatorRecovery({
            ticket: 'ticket',
            ticketIssuedAt: 10_000,
            ticketRejected: false,
            now: 10_000 + LOCATOR_SOCKET_TICKET_REUSE_MS,
        })).toBe('socket');
    });

    it.each([
        { ticket: null, ticketIssuedAt: 0, ticketRejected: false },
        { ticket: 'ticket', ticketIssuedAt: 10_000, ticketRejected: true },
        { ticket: 'ticket', ticketIssuedAt: 10_000, ticketRejected: false, now: 10_000 + LOCATOR_SOCKET_TICKET_REUSE_MS + 1 },
    ])('refreshes the ticket when direct reconnect is unsafe', (input) => {
        expect(selectLocatorRecovery(input)).toBe('poll');
    });
});
