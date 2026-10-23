import type { BinderGroup } from '@/data/marker/binder';

/**
 * Distributes binder groups into two columns using a greedy height-balancing algorithm.
 *
 * Phase 1 – non-1:1 binders (renderableCount > 1): sort by estimated height desc,
 * then assign each to the shorter column.
 * Phase 2 – 1:1 binders (renderableCount ≤ 1): apply the same greedy rule.
 *
 * Height units: header = 1, each extra child type ≈ 1 (proportional approximation).
 * Invisible binders (renderableCount = 0, totalTotal = 0) are assigned height 0
 * so they don't skew the balance while still being tracked per-column.
 */
export function computeBinderColumns(
    groups: BinderGroup[],
    binderTypeCountMap: Map<string, { collected: number; total: number }>,
    typeVisiblePredicate?: (typeKey: string) => boolean,
): { left: BinderGroup[]; right: BinderGroup[] } {
    const sharedKeyRank = (group: BinderGroup): number => {
        if (group.sharedKey === 'rsch') return 0;
        if (group.sharedKey === 'ctgr') return 1;
        return 2;
    };

    const isTypeVisible = typeVisiblePredicate ?? (() => true);

    const withMeta = groups.map((group) => {
        const renderableCount = group.types.reduce(
            (sum, typeInfo) => {
                const hasTotal = (binderTypeCountMap.get(typeInfo.key)?.total ?? 0) > 0;
                return sum + (hasTotal && isTypeVisible(typeInfo.key) ? 1 : 0);
            },
            0,
        );
        // height = 0 for invisible, 1 for 1:1 header-only, 1+n for multi-type
        const estimatedHeight = renderableCount === 0 ? 0 : renderableCount <= 1 ? 1 : 1 + renderableCount;
        return { group, renderableCount, estimatedHeight };
    });

    const multiGroups = withMeta
        .filter((g) => g.renderableCount > 1)
        .sort((a, b) => {
            if (b.estimatedHeight !== a.estimatedHeight) {
                return b.estimatedHeight - a.estimatedHeight;
            }
            return sharedKeyRank(a.group) - sharedKeyRank(b.group);
        });
    const oneToOneGroups = withMeta
        .filter((g) => g.renderableCount <= 1)
        .sort((a, b) => {
            if (b.estimatedHeight !== a.estimatedHeight) {
                return b.estimatedHeight - a.estimatedHeight;
            }
            return sharedKeyRank(a.group) - sharedKeyRank(b.group);
        });

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

    const reorderWithinColumn = (column: BinderGroup[]): BinderGroup[] => {
        return [...column].sort((a, b) => sharedKeyRank(a) - sharedKeyRank(b));
    };

    const orderedLeft = reorderWithinColumn(left);
    const orderedRight = reorderWithinColumn(right);

    // Keep left column height >= right column height when both layouts are close.
    if (leftHeight < rightHeight) {
        return { left: orderedRight, right: orderedLeft };
    }

    return { left: orderedLeft, right: orderedRight };
}
