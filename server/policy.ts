import type { Store } from "../shared/types";

export const POLICY_VERSION = "selection-v3";
export const PRESETS = {
  quick: { apps: 30, exploreApps: 20, surveyListings: 2_000, discoveryApps: 300, reviews: 2_000, budgetUsd: 1, searchIntents: 6, metadataLookups: 100, reviewPageRequests: 100 },
  deep: { apps: 75, exploreApps: 40, surveyListings: 10_000, discoveryApps: 750, reviews: 10_000, budgetUsd: 5, searchIntents: 12, metadataLookups: 300, reviewPageRequests: 400 },
} as const;
export const COUNTRY_PRESETS = {
  international: ["US", "GB", "DE", "FR", "NL", "ES"],
  us: ["US"], europe: ["GB", "DE", "FR", "NL", "ES"],
} as const;
export const LIMITS = {
  searchResults: 10, chartResults: 20, relatedPerSeed: 5, relatedSeeds: 5,
  appleStreamPages: 10, requestAttempts: 3, noNewIdPages: 2,
  poolMultiplier: 2, redistributionMultiplier: 2, developerShare: 0.25,
  recencyShare: 0.8, retryBaseMs: 1_000, retryMaxMs: 60_000,
  heartbeatMs: 5_000, heartbeatStaleMs: 20_000,
  transferSearchTerms: 2, transferResults: 3, transferChartResults: 200, transferLeads: 300, transferBatch: 100, transferBatchFailures: 3, transferSingleFailures: 20,
} as const;
export const FRESHNESS = { listingMs: 86_400_000, collectionMs: 86_400_000, websiteMs: 604_800_000,
  // Catalog reuse in listing surveys. A stale "not found" would become a misleading lead, so it expires sooner.
  catalogListingMs: 2_592_000_000, availableMs: 2_592_000_000, unavailableMs: 604_800_000 } as const;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function integer(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Expected nonnegative integer");
}

export function equalShares(total: number, count: number): number[] {
  integer(total); integer(count);
  if (!count) return [];
  return Array.from({ length: count }, (_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
}

// Water filling in stable listing/stream order. Unused capacity is left unused.
export function allocateReviews(total: number, available: readonly number[], bounded = true): number[] {
  available.forEach(integer);
  const original = equalShares(total, available.length);
  const capacity = available.map((amount, i) => Math.min(amount, bounded ? original[i] * 2 : total));
  const result = original.map((share, i) => Math.min(share, capacity[i]));
  let left = total - result.reduce((sum, value) => sum + value, 0);
  while (left > 0) {
    const eligible = result.flatMap((value, i) => value < capacity[i] ? [i] : []);
    if (!eligible.length) break;
    const shares = equalShares(left, eligible.length);
    eligible.forEach((index, i) => {
      const added = Math.min(shares[i], capacity[index] - result[index]);
      result[index] += added; left -= added;
    });
  }
  return result;
}

export function roundRobin<T>(buckets: readonly (readonly T[])[], limit: number): T[] {
  integer(limit);
  const result: T[] = [];
  for (let i = 0; result.length < limit; i++) {
    let found = false;
    for (const bucket of buckets) {
      if (i < bucket.length && result.length < limit) { result.push(bucket[i]); found = true; }
    }
    if (!found) break;
  }
  return result;
}

export interface Candidate {
  store: Store; appId: string; developerId: string; intent: string; country: string;
  rank: number; relevance: "direct" | "adjacent" | "unrelated"; reason: string;
  included?: boolean; origins: string[];
}
const candidateKey = (candidate: Candidate) => `${candidate.store}:${candidate.appId}`;
export function selectCandidates(candidates: readonly Candidate[], cap: number): { selected: Candidate[]; developerCapRelaxed: boolean } {
  integer(cap);
  const unique = new Map<string, Candidate>();
  for (const item of candidates) {
    if (!item.reason.trim()) throw new Error("Source-grounded relevance reason required");
    const old = unique.get(candidateKey(item));
    if (old) { old.origins = [...new Set([...old.origins, ...item.origins])].sort(compare); old.included ||= item.included; }
    else unique.set(candidateKey(item), { ...item, origins: [...item.origins] });
  }
  const tie = (a: Candidate, b: Candidate) => a.rank - b.rank || compare(candidateKey(a), candidateKey(b));
  const selected = [...unique.values()].filter(c => c.included).sort(tie);
  if (selected.length > cap) throw new Error("Explicit inclusions exceed listing limit; adjust the limit or inclusions");
  const counts = new Map<string, number>();
  selected.forEach(c => counts.set(c.developerId, (counts.get(c.developerId) ?? 0) + 1));
  const remaining = [...unique.values()].filter(c => !c.included && c.relevance !== "unrelated");
  const softCap = Math.ceil(cap * LIMITS.developerShare);
  let developerCapRelaxed = false;
  for (const relax of [false, true]) {
    for (const relevance of ["direct", "adjacent"]) {
      const buckets = [...new Set(remaining.filter(c => c.relevance === relevance).map(c => `${c.intent}:${c.store}`))].sort(compare);
      let progress = true;
      while (selected.length < cap && progress) {
        progress = false;
        for (const bucket of buckets) {
          const choices = remaining.filter(c => c.relevance === relevance && `${c.intent}:${c.store}` === bucket && !selected.includes(c) && (relax || (counts.get(c.developerId) ?? 0) < softCap));
          choices.sort((a, b) => Number(counts.has(a.developerId)) - Number(counts.has(b.developerId)) || tie(a, b));
          if (!choices.length || selected.length >= cap) continue;
          const candidate = choices[0];
          if ((counts.get(candidate.developerId) ?? 0) >= softCap) developerCapRelaxed = true;
          selected.push(candidate); counts.set(candidate.developerId, (counts.get(candidate.developerId) ?? 0) + 1); progress = true;
        }
      }
    }
  }
  return { selected, developerCapRelaxed };
}

export function metadataCandidates(candidates: readonly Candidate[], preset: keyof typeof PRESETS, limit: number = PRESETS[preset].metadataLookups): Candidate[] {
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.intent}:${candidate.store}:${candidate.country}`;
    buckets.set(key, [...(buckets.get(key) ?? []), candidate]);
  }
  const ordered = [...buckets.keys()].sort(compare).map(key => buckets.get(key)!.sort((a,b) => a.rank-b.rank || compare(candidateKey(a), candidateKey(b))));
  const seen = new Set<string>(); const result: Candidate[] = [];
  while (result.length < limit) {
    let progress = false;
    for (const bucket of ordered) {
      // Duplicates do not consume a bucket's turn or its metadata allowance.
      while (bucket.length && seen.has(candidateKey(bucket[0]))) bucket.shift();
      if (!bucket.length || result.length >= limit) continue;
      const candidate = bucket.shift()!;
      seen.add(candidateKey(candidate)); result.push(candidate); progress = true;
    }
    if (!progress) break;
  }
  return result.map(candidate => ({ ...candidate, origins: [...new Set(candidates.filter(c => candidateKey(c) === candidateKey(candidate)).flatMap(c => c.origins))].sort(compare) }));
}

export interface Review { id: string; rating: number; date: string | null }
export function recentThreshold(now: number): number { const date = new Date(now); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.getTime(); }
const timestamp = (review: Review) => review.date ? Date.parse(review.date) : NaN;
export function sampleReviews(reviews: readonly Review[], quota: number, now: number): Array<Review & { sample: "recency" | "diversity"; age: "recent" | "historical" | "undated" }> {
  integer(quota);
  const seen = new Set<string>();
  const pool = reviews.filter(r => { if (!r.id || seen.has(r.id)) return false; seen.add(r.id); return true; });
  const newest = (a: Review, b: Review) => (Number.isFinite(timestamp(b)) ? timestamp(b) : -Infinity) - (Number.isFinite(timestamp(a)) ? timestamp(a) : -Infinity) || compare(a.id, b.id);
  pool.sort(newest);
  // Older evidence only participates if the bounded pool cannot fill the quota with recent evidence.
  const recent = pool.filter(r => timestamp(r) >= recentThreshold(now) && timestamp(r) <= now);
  const recentIds = new Set(recent.map(r => r.id));
  const eligible = [...recent, ...pool.filter(r => !recentIds.has(r.id))];
  const chosen = eligible.slice(0, Math.floor(quota * LIMITS.recencyShare));
  const labels = new Map(chosen.map(r => [r.id, "recency" as "recency" | "diversity"]));
  const group = (r: Review) => r.rating <= 2 ? 0 : r.rating === 3 ? 1 : 2;
  while (chosen.length < quota) {
    const remaining = eligible.filter(r => !labels.has(r.id));
    const recentRemaining = remaining.filter(r => recentIds.has(r.id));
    // Diversity never displaces eligible recent evidence with an older review.
    // Historical/undated reviews can fill only the remaining recent shortfall.
    const unused = recentRemaining.length ? recentRemaining : remaining;
    if (!unused.length) break;
    const counts = [0, 1, 2].map(g => chosen.filter(r => group(r) === g).length);
    const groups = [0, 1, 2].filter(g => unused.some(r => group(r) === g)).sort((a, b) => counts[a] - counts[b] || a - b);
    const next = unused.find(r => group(r) === groups[0])!;
    chosen.push(next); labels.set(next.id, "diversity");
  }
  return chosen.map(r => ({ ...r, sample: labels.get(r.id)!, age: !Number.isFinite(timestamp(r)) ? "undated" : timestamp(r) >= recentThreshold(now) && timestamp(r) <= now ? "recent" : "historical" }));
}

export function assignUniqueStreams(streams: readonly { locale: string; ids: readonly string[] }[]): { ids: string[][]; provenance: Record<string, string[]>; overlap: number[]; incremental: number[] } {
  const seen = new Set<string>(); const provenance: Record<string, string[]> = Object.create(null);
  const overlap: number[] = []; const incremental: number[] = [];
  const ids = streams.map(stream => {
    const unique: string[] = []; let duplicates = 0;
    for (const id of stream.ids) {
      if (!id) continue;
      provenance[id] = [...new Set([...(provenance[id] ?? []), stream.locale])];
      if (seen.has(id)) duplicates++;
      else { seen.add(id); unique.push(id); }
    }
    overlap.push(stream.ids.length ? duplicates / stream.ids.length : 0); incremental.push(unique.length);
    return unique;
  });
  return { ids, provenance, overlap, incremental };
}

export interface CollectionCheckpoint {
  version: string; scopeHash: string; startedAt: number; endedAt: number | null;
  quota: number; uniqueCount: number; pages: number; requestAttempts: number;
  noNewIdPages: number; cursor: string | null; seenCursors: string[];
  stopReason: string | null; complete: boolean;
}
export function collectionReuse(checkpoint: CollectionCheckpoint, scopeHash: string, quota: number, now: number, sameRun: boolean, cursorValid = true): "reuse" | "resume" | "replace" {
  if (checkpoint.scopeHash !== scopeHash || now - checkpoint.startedAt >= FRESHNESS.collectionMs || now < checkpoint.startedAt || !cursorValid) return "replace";
  if (checkpoint.complete && (checkpoint.uniqueCount >= quota || checkpoint.stopReason === "exhausted")) return "reuse";
  return sameRun && !checkpoint.complete ? "resume" : "replace";
}
export function pageStop(checkpoint: CollectionCheckpoint, store: Store, preset: keyof typeof PRESETS, globalRequests: number, nextCursor: string | null, exhausted = false, accessFailure = false): string | null {
  if (accessFailure) return "access_failure";
  if (exhausted) return "exhausted";
  if (nextCursor !== null && checkpoint.seenCursors.includes(nextCursor)) return "repeated_cursor";
  if (checkpoint.noNewIdPages >= LIMITS.noNewIdPages) return "no_new_ids";
  if (globalRequests >= PRESETS[preset].reviewPageRequests) return "request_limit";
  if (store === "apple" && checkpoint.pages >= LIMITS.appleStreamPages) return "stream_page_limit";
  if (checkpoint.uniqueCount >= checkpoint.quota * LIMITS.poolMultiplier) return "pool_limit";
  return null;
}
export function retryAt(now: number, attempt: number, jitter: number, providerRetryAt?: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 1 || jitter < 0 || jitter > 1) throw new Error("Invalid retry input");
  if (attempt >= LIMITS.requestAttempts) return null;
  return Math.max(providerRetryAt ?? now, now + Math.round(Math.min(LIMITS.retryMaxMs, LIMITS.retryBaseMs * 2 ** (attempt - 1)) * (0.5 + jitter)));
}

export function counterpartStatus(evidence: { official: boolean; exactStoreIdsLinked: boolean; firstPartyStatement: boolean; suggestedMatch: boolean }): "verified" | "potential" | "not_found" {
  if (evidence.official && (evidence.exactStoreIdsLinked || evidence.firstPartyStatement)) return "verified";
  return evidence.suggestedMatch ? "potential" : "not_found";
}
export interface ConfidenceEvidence {
  support: { reviewId: string; productId: string; developerId: string; date: string | null }[];
  validCitations: boolean; checksCompleted: boolean; materialContradiction: boolean;
  identityUncertain: boolean; missingSourceDependency: boolean; provisional: boolean;
  crossPlatform?: { sameProductSearch: boolean; needBasedSearch: boolean; feasibilityUnresolved: boolean };
}
export function evidenceConfidence(evidence: ConfidenceEvidence, now: number) {
  const support = [...new Map(evidence.support.map(r => [r.reviewId, r])).values()].filter(r => r.reviewId);
  const recent = support.filter(r => r.date && Date.parse(r.date) >= recentThreshold(now) && Date.parse(r.date) <= now).length;
  const products = new Set(support.map(r => r.productId)).size;
  const developers = new Set(support.map(r => r.developerId)).size;
  const counts = { supportingReviews: support.length, recentReviews: recent, products, developers };
  const blocked = evidence.materialContradiction || evidence.identityUncertain || !evidence.validCitations;
  const cross = evidence.crossPlatform;
  const independent = products >= 2 && developers >= 2;
  const crossException = products >= 1 && cross?.sameProductSearch && cross.needBasedSearch && !cross.feasibilityUnresolved;
  const high = !blocked && !evidence.missingSourceDependency && !evidence.provisional && evidence.checksCompleted && support.length >= 10 && recent * 2 >= support.length && (cross ? crossException : independent);
  const medium = !blocked && support.length >= 3 && recent > 0;
  return { confidence: high ? "high" as const : medium ? "medium" as const : "low" as const, counts, policyVersion: POLICY_VERSION };
}
