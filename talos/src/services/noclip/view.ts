/** Approximate the perspective footprint on the local ground plane, within the minimap's tile zooms. */
export const minimapZoom = ({
    altitude,
    down,
    fovY,
    aspect,
    width,
    height,
    unitsPerMeter,
}: {
    altitude: number;
    down: number;
    fovY: number;
    aspect: number;
    width: number;
    height: number;
    unitsPerMeter: number;
}): number => {
    // Keep ground-level and horizon views finite, including cameras below the selected floor.
    const distance = Math.max(8, altitude) / Math.max(0.25, down);
    const span = 2 * distance * Math.tan(fovY / 2) * unitsPerMeter;
    const scale = Math.min(
        Math.max(1, width) / (span * aspect),
        Math.max(1, height) / span,
    );
    return Math.min(4, Math.max(0, Math.log2(scale)));
};
