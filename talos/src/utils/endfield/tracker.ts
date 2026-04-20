import { EndfieldBrowserClient } from './client';
import {
    EndfieldAuthError,
    type EndfieldTrackerOptions,
    type EndfieldTrackerSubscriber,
    type PositionResponse,
} from './types';

const DEFAULT_INTERVAL_MS = 1500;
const DEFAULT_MAX_BACKOFF_MS = 30000;

const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

export class MapTracker {
    private readonly options: Required<Omit<EndfieldTrackerOptions, 'roleId' | 'serverId' | 'cred' | 'token'>> & {
        roleId: string;
        serverId: number;
        cred: string;
        token: string;
        onError: (error: unknown) => void;
    };

    private readonly client: EndfieldBrowserClient;
    private readonly subscribers = new Set<EndfieldTrackerSubscriber>();

    private running = false;
    private pausedByOffline = false;
    private pollTimer: number | null = null;
    private failureCount = 0;

    constructor(options: EndfieldTrackerOptions) {
        this.options = {
            ...options,
            baseUrl: options.baseUrl ?? '',
            intervalMs: clamp(options.intervalMs ?? DEFAULT_INTERVAL_MS, 1000, 2000),
            maxBackoffMs: options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS,
            pauseWhenHidden: options.pauseWhenHidden ?? true,
            debug: options.debug ?? false,
            onError: options.onError ?? (() => {}),
        };

        this.client = new EndfieldBrowserClient({
            baseUrl: this.options.baseUrl,
        });

        if (this.options.pauseWhenHidden) {
            document.addEventListener('visibilitychange', this.handleVisibilityChange);
        }
    }

    private log(...args: unknown[]): void {
        if (!this.options.debug) return;
        console.log('[EndfieldTracker]', ...args);
    }

    private handleVisibilityChange = (): void => {
        if (!this.running) return;

        if (document.hidden) {
            this.log('document hidden, pausing active polling tick');
            this.clearPollTimer();
            return;
        }

        this.log('document visible, resuming polling');
        this.scheduleNextPoll(0);
    };

    private clearPollTimer(): void {
        if (this.pollTimer === null) return;
        window.clearTimeout(this.pollTimer);
        this.pollTimer = null;
    }

    private scheduleNextPoll(delayMs: number): void {
        if (!this.running) return;
        this.clearPollTimer();
        this.pollTimer = window.setTimeout(() => {
            void this.pollOnce();
        }, Math.max(0, delayMs));
    }

    private notify(data: PositionResponse['data']): void {
        this.subscribers.forEach((subscriber) => {
            try {
                subscriber(data);
            } catch (error) {
                this.log('subscriber threw', error);
            }
        });
    }

    private computeBackoffDelay(): number {
        if (this.failureCount <= 0) return this.options.intervalMs;
        const expDelay = this.options.intervalMs * 2 ** Math.max(0, this.failureCount - 1);
        return Math.min(expDelay, this.options.maxBackoffMs);
    }

    private stopForAuthFailure(error: EndfieldAuthError): void {
        this.log('stopping due to auth failure', error.reason, error.message);
        this.options.onError(error);
        this.stop();
    }

    private async pollOnce(): Promise<void> {
        if (!this.running) return;
        if (this.options.pauseWhenHidden && document.hidden) {
            this.scheduleNextPoll(this.options.intervalMs);
            return;
        }

        try {
            const response = await this.client.getMapMePositionBrowser(
                this.options.roleId,
                this.options.serverId,
                this.options.cred,
                this.options.token,
            );

            this.failureCount = 0;

            if (response.data.isOnline === false) {
                this.pausedByOffline = true;
                this.log('player offline, slowing polling cadence');
                this.scheduleNextPoll(this.options.intervalMs * 3);
                return;
            }

            this.pausedByOffline = false;
            this.notify(response.data);
            this.scheduleNextPoll(this.options.intervalMs);
        } catch (error) {
            if (error instanceof EndfieldAuthError) {
                this.stopForAuthFailure(error);
                return;
            }

            this.log('poll failed, stopping tracker', { error });
            this.options.onError(error);
            this.stop();
        }
    }

    start(): void {
        if (this.running) return;
        this.running = true;
        this.failureCount = 0;
        this.pausedByOffline = false;
        this.log('tracker started');
        this.scheduleNextPoll(0);
    }

    stop(): void {
        if (!this.running) return;
        this.running = false;
        this.clearPollTimer();
        this.log('tracker stopped');
    }

    subscribe(cb: EndfieldTrackerSubscriber): void {
        this.subscribers.add(cb);
    }

    unsubscribe(cb: EndfieldTrackerSubscriber): void {
        this.subscribers.delete(cb);
    }

    isRunning(): boolean {
        return this.running;
    }

    isPausedByOffline(): boolean {
        return this.pausedByOffline;
    }

    destroy(): void {
        this.stop();
        if (this.options.pauseWhenHidden) {
            document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        }
        this.subscribers.clear();
    }
}
