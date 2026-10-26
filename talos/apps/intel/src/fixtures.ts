import { vi } from 'vitest';
import { act } from '@testing-library/react';
import type { IntelArchive } from './data/types';

// One map item and each non-map acquisition shape; unknown progress IDs remain
// deliberately outside this list to detect accidental loss during scoped writes.
export const archives: IntelArchive[] = [
    { id: 'nar_map', categoryId: 'paper', iconUrl: '/map.webp', acquisition: { method: 'map', pointId: 42 } },
    { id: 'nar_mission', categoryId: 'digital', iconUrl: '/mission.webp', acquisition: { method: 'mission', missionId: 'mission:1', questId: 'quest:1' } },
    { id: 'nar_auto', categoryId: 'document', iconUrl: '/auto.webp', acquisition: { method: 'auto' } },
    { id: 'nar_shop', categoryId: 'collection', iconUrl: '/shop.webp', acquisition: { method: 'shop', shopId: 'shop:1', shopGroupId: 'shop-group:1', npcId: 'npc:1', pointId: 43, location: { regionId: 'Valley_4', subregionId: 'VL_1' } } },
    { id: 'nar_research', categoryId: 'report', iconUrl: '/research.webp', acquisition: { method: 'invstgt', researchId: 'research:1' } },
    { id: 'nar_media', categoryId: 'media', iconUrl: '/media.webp', acquisition: { method: 'auto' } },
];

const labels: Record<string, string> = {
    nar_map: '<b>Ore report</b>', nar_mission: 'Operation summary', nar_auto: 'Central document',
    nar_shop: 'Shop ledger', nar_research: 'Research notes', nar_media: 'Recorded transmission',
    'mission:1': 'First mission', 'quest:1': '<em>Final stage</em>', 'npc:1': 'Trader',
    'shop:1': 'Shop', 'shop-group:1': 'Trading post', 'research:1': 'Investigate ore',
    'region:Valley_4': 'Valley', 'region:Valley_4:VL_1': 'Hub',
    'intel.shopNpcPurchase': 'Buy from {npc} at {shop}',
    'intel.shopSystemPurchase': 'Buy at {shop} in {region}',
    'intel.investUnlock': 'Unlock {mission}',
    'intel.missionMapInteraction': 'Find {point}',
    'intel.pointPuzzle': '{point} puzzle',
    'intel.specialNpcDialog': 'Ask {npc} about {dialog}',
    'intel.archiveTotal': '{num} archives',
    'intel.pageTitle': '{site} archives',
    'search.results': '{count, plural, one {# result} other {# results}}',
};
export const translate = (key: string) => labels[key] ?? key;

export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (cause: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

export const flush = async (update: () => void) => {
    await act(async () => { update(); await Promise.resolve(); });
};

/** Supplies only visibility observations; card and selection logic remain real. */
export function installIntersectionObserver() {
    const observers: Observer[] = [];
    class Observer implements IntersectionObserver {
        readonly root: Element | Document | null;
        readonly rootMargin: string;
        readonly thresholds = [0];
        readonly targets = new Set<Element>();
        constructor(readonly callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
            this.root = options.root ?? null;
            this.rootMargin = options.rootMargin ?? '0px';
            observers.push(this);
        }
        observe(target: Element) { this.targets.add(target); }
        unobserve(target: Element) { this.targets.delete(target); }
        disconnect() { this.targets.clear(); }
        takeRecords() { return []; }
        notify(target: Element, isIntersecting: boolean) {
            if (!this.targets.has(target)) throw new Error('Target is not observed');
            const rect = target.getBoundingClientRect();
            this.callback([{ target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, boundingClientRect: rect, intersectionRect: rect, rootBounds: null, time: 0 }], this);
        }
    }
    vi.stubGlobal('IntersectionObserver', Observer);
    return observers;
}
