/** Half-level bands (~1.41x scale) with a wider exit threshold to prevent boundary chatter. */
export class MinimapZoom {
    private level: number | undefined;
    private context = '';

    update(ideal: number, context: string): number {
        const bounded = Math.max(0, Math.min(5, ideal));
        const nearest = Math.round(bounded * 2) / 2;
        // Reset only across coordinate systems/floors, not when selecting another
        // point on the same map. A flight then keeps the current band until needed.
        if (this.level === undefined || context !== this.context) {
            this.context = context;
            this.level = nearest;
        } else if (Math.abs(bounded - this.level) >= 0.4) {
            // The normal half-step boundary is 0.25; an extra 0.15 of hysteresis
            // absorbs small height, terrain and pitch variations on either side.
            // Large jumps go straight to the appropriate band without stepping
            // through intermediate tile levels or starting an animation loop.
            this.level = nearest;
        }
        return this.level;
    }
}

/** Short eased transitions between stable bands; retarget from the displayed scale. */
export class ZoomTransition {
    private from = 0;
    private to = 0;
    private start = 0;
    private context: string | undefined;
    active = false;

    update(target: number, context: string, now: number): number {
        let value = this.sample(now);
        if (context !== this.context) {
            this.context = context;
            this.from = this.to = target;
            this.active = false;
            return target;
        }
        if (target !== this.to) {
            this.from = value;
            this.to = target;
            this.start = now;
        }
        value = this.sample(now);
        this.active = value !== this.to;
        return value;
    }

    private sample(now: number): number {
        const t = Math.min(1, Math.max(0, (now - this.start) / 240));
        return t === 1
            ? this.to
            : this.from + (this.to - this.from) * t * t * (3 - 2 * t);
    }
}
