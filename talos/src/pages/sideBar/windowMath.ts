/** Half-open row interval, including one viewport of look-ahead in both directions. */
export function rowRange(top: number, height: number, rowHeight: number, count: number, viewport: number, padding = 1): [number, number] {
    const first = Math.max(0, Math.min(count, Math.floor((-viewport * padding - top) / rowHeight)));
    const last = Math.max(first, Math.min(count, Math.ceil((height + viewport * padding - top) / rowHeight)));
    return [first, last];
}

/** Hidden grids may return an unresolved repeat()/minmax() value rather than pixel tracks. */
export function columnCount(value: string, fallback: number): number {
    const repeat = /^repeat\((\d+),/.exec(value);
    if (repeat) return Number(repeat[1]);
    if (!value || value === 'none' || value.includes('(')) return fallback;
    return value.trim().split(/\s+/).length;
}
