import type { Step } from 'react-joyride';

/** Timers and frames belong to one visible walkthrough/step, not the page. */
export class GuideTasks {
    private controller = new AbortController();
    private cleanup = new Set<() => void>();
    readonly signal = this.controller.signal;

    constructor(parent?: AbortSignal) {
        if (parent?.aborted) this.cancel();
        else if (parent) {
            parent.addEventListener('abort', this.cancel, { once: true });
            this.cleanup.add(() => parent.removeEventListener('abort', this.cancel));
        }
    }

    cancel = (): void => {
        if (this.signal.aborted) return;
        this.controller.abort();
        for (const dispose of this.cleanup) dispose();
        this.cleanup.clear();
    };

    after(callback: () => void, delay = 0): void {
        if (this.signal.aborted) return;
        const dispose = () => window.clearTimeout(timer);
        const timer = window.setTimeout(() => {
            this.cleanup.delete(dispose);
            if (!this.signal.aborted) callback();
        }, delay);
        this.cleanup.add(dispose);
    }

    frame(callback: () => void): void {
        if (this.signal.aborted) return;
        const dispose = () => window.cancelAnimationFrame(frame);
        const frame = window.requestAnimationFrame(() => {
            this.cleanup.delete(dispose);
            if (!this.signal.aborted) callback();
        });
        this.cleanup.add(dispose);
    }

    wait(delay: number): Promise<boolean> {
        if (this.signal.aborted) return Promise.resolve(false);
        return new Promise((resolve) => {
            const abort = () => resolve(false);
            this.signal.addEventListener('abort', abort, { once: true });
            this.after(() => {
                this.signal.removeEventListener('abort', abort);
                resolve(true);
            }, delay);
        });
    }
}

export type GuideStep = Step & {
    id: string;
    intro?: boolean;
    hideProgress?: boolean;
    onBefore?: (tasks: GuideTasks) => void | Promise<void>;
    onNext?: (tasks: GuideTasks) => void | Promise<void>;
    delay?: number;
    disableAutoScroll?: boolean;
};
