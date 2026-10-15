/**
 * Keep the first marker of each type at an exact 3D position, matching the map.
 * Apply this before checking collected IDs so hidden duplicate IDs never add
 * progress for a marker that the map does not render.
 *
 * @template {{ type: string, x: number, y: number, z: number }} T
 * @param {readonly T[]} markers
 * @returns {T[]}
 */
export const deduplicateMarkersByPositionAndType = (markers) => {
    const seen = new Set();
    return markers.filter((marker) => {
        const key = JSON.stringify([marker.type, marker.x, marker.y, marker.z]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
