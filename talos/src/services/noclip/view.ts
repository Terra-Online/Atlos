/** Place the original offscreen icon at the rectangle edge, allowing for its artwork bounds. */
export const targetEdge = (
    point: { x: number; y: number },
    size: { x: number; y: number },
    padding: { left: number; right: number; top: number; bottom: number },
): { x: number; y: number } | null => {
    if (
        size.x <= 2 * Math.max(padding.left, padding.right) ||
        size.y <= 2 * Math.max(padding.top, padding.bottom) ||
        (point.x >= 0 && point.x <= size.x && point.y >= 0 && point.y <= size.y)
    )
        return null;
    const dx = point.x - size.x / 2,
        dy = point.y - size.y / 2;
    const scale = Math.min(
        (size.x / 2 - (dx > 0 ? padding.right : padding.left)) / Math.abs(dx),
        (size.y / 2 - (dy > 0 ? padding.bottom : padding.top)) / Math.abs(dy),
    );
    return { x: size.x / 2 + dx * scale, y: size.y / 2 + dy * scale };
};

/** Heading in unrounded map coordinates; a vertical look has no planar heading. */
export const minimapBearing = (
    origin: { mapX: number; mapZ: number },
    forward: { mapX: number; mapZ: number },
): number | null => {
    const dx = forward.mapX - origin.mapX,
        dz = forward.mapZ - origin.mapZ;
    return Math.hypot(dx, dz) < 1e-9
        ? null
        : (Math.atan2(-dz, dx) * 180) / Math.PI + 90;
};

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
