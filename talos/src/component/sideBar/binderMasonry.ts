import type { BinderGroup } from '@/data/marker/binder';

/**
 * Distributes binder groups into two columns using a greedy height-balancing algorithm.
 *
 * Phase 1 – non-1:1 binders (renderableCount > 1): assign each to the shorter column.
 * Phase 2 – 1:1 binders (renderableCount ≤ 1): continue filling the shorter column.
 *
 * Height units: header = 1, each extra child type ≈ 1 (proportional approximation).
 * Invisible binders (renderableCount = 0, totalTotal = 0) are assigned height 0
 * so they don't skew the balance while still being tracked per-column.
 */
export function computeBinderColumns(
    groups: BinderGroup[],
    binderTypeCountMap: Map<string, { collected: number; total: number }>,
): { left: BinderGroup[]; right: BinderGroup[] } {
    const withMeta = groups.map((group) => {
        const renderableCount = group.types.reduce(
            (sum, typeInfo) => sum + ((binderTypeCountMap.get(typeInfo.key)?.total ?? 0) > 0 ? 1 : 0),
            0,
        );
        // height = 0 for invisible, 1 for 1:1 header-only, 1+n for multi-type
        const estimatedHeight = renderableCount === 0 ? 0 : renderableCount <= 1 ? 1 : 1 + renderableCount;
        return { group, renderableCount, estimatedHeight };
    });

    const multiGroups = withMeta.filter((g) => g.renderableCount > 1);
    const oneToOneGroups = withMeta.filter((g) => g.renderableCount <= 1);

    const left: BinderGroup[] = [];
    const right: BinderGroup[] = [];
    let leftHeight = 0;
    let rightHeight = 0;

    for (const item of multiGroups) {
        if (leftHeight <= rightHeight) {
            left.push(item.group);
            leftHeight += item.estimatedHeight;
        } else {
            right.push(item.group);
            rightHeight += item.estimatedHeight;
        }
    }

    for (const item of oneToOneGroups) {
        if (leftHeight <= rightHeight) {
            left.push(item.group);
            leftHeight += item.estimatedHeight;
        } else {
            right.push(item.group);
            rightHeight += item.estimatedHeight;
        }
    }

    return { left, right };
}
