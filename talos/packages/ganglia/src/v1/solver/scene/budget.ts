/**
 * Per-query search budget and failure-nogood tracker for scene orchestration
 * (Phase 3 / B2). Replaces ad-hoc `attempts--` refunds with explicit ordinary
 * vs guide attempt accounting and proposal-level deduplication within one leg.
 */
export interface PhysicalNogood {
  reason?: string;
  truncated: boolean;
}

export interface PhysicalNogoodCache {
  get(key: string): PhysicalNogood | undefined;
  set(key: string, value: PhysicalNogood): void;
  delete(key: string): void;
  clear(): void;
  readonly hits: number;
  readonly size: number;
}

export function createPhysicalNogoodCache(maxEntries = 256): PhysicalNogoodCache {
  const entries = new Map<string, PhysicalNogood>();
  let hits = 0;
  return {
    get(key: string) {
      const value = entries.get(key);
      if (value !== undefined) hits++;
      return value;
    },
    set(key: string, value: PhysicalNogood) {
      if (entries.has(key)) entries.delete(key);
      else if (entries.size >= maxEntries) entries.delete(entries.keys().next().value!);
      entries.set(key, value);
    },
    delete(key: string) {
      entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get hits() {
      return hits;
    },
    get size() {
      return entries.size;
    },
  };
}

export interface QueryBudget {
  readonly maxOrdinaryAttempts: number;
  readonly maxGuideAttempts: number;
  readonly ordinaryAttempts: number;
  readonly guideAttempts: number;
  readonly reportedAttempts: number;
  readonly nogoods: PhysicalNogoodCache;
  canAttemptOrdinary(): boolean;
  canAttemptGuide(): boolean;
  recordAttempt(kind: 'ordinary' | 'guide'): void;
  hasFailedProposal(key: string): boolean;
  recordFailedProposal(key: string, windowPoints: unknown): void;
  failedProposalPoints(key: string): unknown;
}

export function createQueryBudget(maxOrdinaryAttempts: number, maxGuideAttempts = 2): QueryBudget {
  let ordinaryAttempts = 0;
  let guideAttempts = 0;
  const failedProposals = new Map<string, unknown>();
  const nogoods = createPhysicalNogoodCache();
  return {
    maxOrdinaryAttempts,
    maxGuideAttempts,
    get ordinaryAttempts() {
      return ordinaryAttempts;
    },
    get guideAttempts() {
      return guideAttempts;
    },
    get reportedAttempts() {
      return ordinaryAttempts > 0 ? ordinaryAttempts : guideAttempts > 0 ? 1 : 0;
    },
    nogoods,
    canAttemptOrdinary: () => ordinaryAttempts < maxOrdinaryAttempts,
    canAttemptGuide: () => guideAttempts < maxGuideAttempts,
    recordAttempt(kind: 'ordinary' | 'guide') {
      if (kind === 'guide') guideAttempts++;
      else ordinaryAttempts++;
    },
    hasFailedProposal: (key: string) => failedProposals.has(key),
    recordFailedProposal(key: string, windowPoints: unknown) {
      if (failedProposals.size >= 64) failedProposals.delete(failedProposals.keys().next().value!);
      failedProposals.set(key, windowPoints);
    },
    failedProposalPoints: (key: string) => failedProposals.get(key),
  };
}
