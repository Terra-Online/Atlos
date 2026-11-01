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
