import { describe, expect, test } from "bun:test";
import { allocateReviews, assignUniqueStreams, collectionReuse, COUNTRY_PRESETS, counterpartStatus, equalShares, evidenceConfidence, FRESHNESS, LIMITS, metadataCandidates, pageStop, PRESETS, retryAt, roundRobin, sampleReviews, selectCandidates, type Candidate, type CollectionCheckpoint, type ConfidenceEvidence } from "../server/policy";

const now = Date.parse("2026-09-12T12:00:00Z");
const checkpoint: CollectionCheckpoint = { version: "v1", scopeHash: "scope", startedAt: now - 1000, endedAt: null, quota: 10, uniqueCount: 5, pages: 1, requestAttempts: 1, noNewIdPages: 0, cursor: "next", seenCursors: ["first"], stopReason: null, complete: false };
const candidate = (appId: string, developerId = appId, overrides: Partial<Candidate> = {}): Candidate => ({ store: "apple", appId, developerId, intent: "need", country: "US", rank: 1, relevance: "direct", reason: "Captured listing covers the task", origins: ["search"], ...overrides });
const evidence = (count: number): ConfidenceEvidence => ({ support: Array.from({ length: count }, (_, i) => ({ reviewId: String(i), productId: `p${i % 2}`, developerId: `d${i % 2}`, date: i < Math.ceil(count / 2) ? "2026-09-01" : "2020-01-01" })), validCitations: true, checksCompleted: true, materialContradiction: false, identityUncertain: false, missingSourceDependency: false, provisional: false });

describe("versioned policy limits and allocation", () => {
  test("exact caps, defaults, countries and freshness", () => {
    expect(PRESETS.quick).toEqual({ apps: 30, exploreApps: 20, surveyListings: 2000, discoveryApps: 300, reviews: 2000, budgetUsd: 1, searchIntents: 6, metadataLookups: 100, reviewPageRequests: 100 });
    expect(PRESETS.deep).toEqual({ apps: 75, exploreApps: 40, surveyListings: 10000, discoveryApps: 750, reviews: 10000, budgetUsd: 5, searchIntents: 12, metadataLookups: 300, reviewPageRequests: 400 });
    expect(COUNTRY_PRESETS.international).toEqual(["US", "GB", "DE", "FR", "NL", "ES"]);
    expect(COUNTRY_PRESETS.europe).toEqual(["GB", "DE", "FR", "NL", "ES"]); expect(COUNTRY_PRESETS.us).toEqual(["US"]);
    expect(FRESHNESS).toEqual({ listingMs: 86400000, collectionMs: 86400000, websiteMs: 604800000, catalogListingMs: 2592000000, availableMs: 2592000000, unavailableMs: 604800000 });
    expect([LIMITS.searchResults, LIMITS.chartResults, LIMITS.relatedSeeds, LIMITS.relatedPerSeed, LIMITS.appleStreamPages, LIMITS.requestAttempts]).toEqual([10, 20, 5, 5, 10, 3]);
  });
  test("equal shares and bounded redistribution leave excess unused", () => {
    expect(equalShares(11, 3)).toEqual([4, 4, 3]); expect(equalShares(20, 0)).toEqual([]);
    expect(allocateReviews(100, [0, 100, 100, 100])).toEqual([0, 34, 33, 33]);
    expect(allocateReviews(100, [0, 0, 0, 100])).toEqual([0, 0, 0, 50]);
    expect(allocateReviews(100, [0, 0, 0, 100], false)).toEqual([0, 0, 0, 100]);
    expect(allocateReviews(2, [0, 20, 20])).toEqual([0, 2, 0]);
    expect(() => allocateReviews(-1, [2])).toThrow(); expect(allocateReviews(0, [5, 5])).toEqual([0, 0]);
  });
  test("round robin, unique metadata ceiling, stable buckets", () => {
    expect(roundRobin([["a", "b"], ["c"], ["d", "e"]], 5)).toEqual(["a", "c", "d", "b", "e"]);
    const many = Array.from({ length: 200 }, (_, i) => candidate(`a${i}`, "dev", { intent: i % 2 ? "b" : "a", rank: i }));
    const chosen = metadataCandidates([...many, many[0]], "quick");
    expect(chosen).toHaveLength(100); expect(new Set(chosen.map(c => c.appId)).size).toBe(100);
    expect(chosen.slice(0, 4).map(c => c.intent)).toEqual(["a", "b", "a", "b"]);
  });
});

describe("candidate diversity", () => {
  test("explicit inclusions honored, cap enforced, unrelated excluded, origins retained", () => {
    const inputs = [candidate("z", "z", { included: true }), candidate("a"), candidate("a", "a", { origins: ["chart"] }), candidate("x", "x", { relevance: "unrelated" })];
    const result = selectCandidates(inputs, 10).selected;
    expect(result.map(c => c.appId)).toEqual(["z", "a"]); expect(result[1].origins).toEqual(["chart", "search"]);
    expect(() => selectCandidates([candidate("a", "a", { included: true }), candidate("b", "b", { included: true })], 1)).toThrow("Explicit");
  });
  test("direct first, round-robin stores/intents, unrepresented developer and ID tie breaks", () => {
    const result = selectCandidates([candidate("b", "same"), candidate("a", "same"), candidate("d", "new", { rank: 99 }), candidate("c", "c", { store: "google" }), candidate("adj", "adj", { relevance: "adjacent", rank: 0 })], 4);
    expect(result.selected.map(c => c.appId)).toEqual(["a", "c", "d", "adj"]);
    expect(result.developerCapRelaxed).toBe(false);
  });
  test("soft cap relaxes only after alternatives exhausted and discloses", () => {
    const many = [candidate("a", "same"), candidate("b", "same"), candidate("c", "same"), candidate("d", "other")];
    const result = selectCandidates(many, 4); expect(result.selected).toHaveLength(4); expect(result.developerCapRelaxed).toBe(true);
    expect(result.selected.slice(0, 2).map(c => c.developerId)).toEqual(["same", "other"]);
  });
});

describe("review selection and collection boundaries", () => {
  test("10 recent reviews fill quota 10 without historical evidence", () => {
    const recent = Array.from({ length: 10 }, (_, i) => ({ id: `recent-${i}`, rating: i === 9 ? 3 : 5, date: `2026-09-${String(12 - i).padStart(2, "0")}` }));
    const older = [{ id: "old-low", rating: 1, date: "2020-01-01" }, { id: "old-mid", rating: 3, date: "2020-01-02" }];
    const chosen = sampleReviews([...recent, ...older], 10, now);
    expect(chosen).toHaveLength(10); expect(chosen.every(r => r.age === "recent")).toBe(true);
    expect(chosen.filter(r => r.sample === "recency")).toHaveLength(8);
    expect(chosen.slice(8).map(r => r.rating)).toEqual([3, 5]);
  });
  test("9 recent reviews fill quota 10 with exactly one historical review", () => {
    const recent = Array.from({ length: 9 }, (_, i) => ({ id: `recent-${i}`, rating: 5, date: `2026-09-${String(12 - i).padStart(2, "0")}` }));
    const older = [{ id: "old-low", rating: 1, date: "2020-01-01" }, { id: "old-mid", rating: 3, date: "2020-01-02" }, { id: "undated", rating: 1, date: null }];
    const chosen = sampleReviews([...recent, ...older], 10, now);
    expect(chosen).toHaveLength(10); expect(chosen.filter(r => r.age === "recent")).toHaveLength(9);
    expect(chosen.filter(r => r.age === "historical")).toHaveLength(1);
    expect(chosen.filter(r => r.age === "undated")).toHaveLength(0);
    expect(chosen.slice(8).map(r => r.id)).toEqual(["recent-8", "old-low"]);
  });
  test("80 percent newest plus least-represented ratings, recent before historical", () => {
    const reviews = Array.from({ length: 10 }, (_, i) => ({ id: String(i), rating: i < 8 ? 5 : i === 8 ? 3 : 1, date: `2026-09-${String(12 - i).padStart(2, "0")}` }));
    const result = sampleReviews(reviews, 10, now);
    expect(result.filter(r => r.sample === "recency")).toHaveLength(8);
    expect(result.slice(8).map(r => r.rating)).toEqual([1, 3]);
    expect(sampleReviews([...reviews, { id: "old", rating: 1, date: "2020-01-01" }], 10, now).some(r => r.id === "old")).toBe(false);
  });
  test("missing rating groups, undated and low volume remain truthful", () => {
    const result = sampleReviews([{ id: "old", rating: 5, date: "2020-01-01" }, { id: "missing", rating: 5, date: null }, { id: "old", rating: 5, date: "2020-01-01" }], 10, now);
    expect(result).toHaveLength(2); expect(result.map(r => r.age)).toEqual(["historical", "undated"]);
    expect(sampleReviews([], 10, now)).toEqual([]); expect(sampleReviews(result, 0, now)).toEqual([]);
  });
  test("overlap consumes one quota and preserves all locale provenance", () => {
    const result = assignUniqueStreams([{ locale: "US", ids: ["a", "b"] }, { locale: "GB", ids: ["b", "c"] }]);
    expect(result.ids).toEqual([["a", "b"], ["c"]]); expect(result.provenance.b).toEqual(["US", "GB"]);
    expect(result.overlap).toEqual([0, 0.5]); expect(result.incremental).toEqual([2, 1]);
  });
  test("repeated cursor, no-new-ID pages, Apple and global bounds", () => {
    expect(pageStop(checkpoint, "apple", "quick", 1, "first")).toBe("repeated_cursor");
    expect(pageStop({ ...checkpoint, noNewIdPages: 2 }, "google", "quick", 1, "new")).toBe("no_new_ids");
    expect(pageStop({ ...checkpoint, pages: 10 }, "apple", "quick", 1, "new")).toBe("stream_page_limit");
    expect(pageStop(checkpoint, "google", "quick", 100, "new")).toBe("request_limit");
    expect(pageStop(checkpoint, "google", "deep", 399, "new")).toBeNull();
    expect(pageStop(checkpoint, "google", "deep", 400, "new")).toBe("request_limit");
    expect(pageStop({ ...checkpoint, uniqueCount: 20 }, "google", "quick", 1, "new")).toBe("pool_limit");
    expect(pageStop(checkpoint, "apple", "quick", 1, null, false, true)).toBe("access_failure");
  });
  test("fresh complete reuse, partial same-run resume and stale/cursor-invalid replacement", () => {
    expect(collectionReuse(checkpoint, "scope", 10, now, false)).toBe("replace");
    expect(collectionReuse(checkpoint, "scope", 10, now, true)).toBe("resume");
    expect(collectionReuse(checkpoint, "scope", 10, now, true, false)).toBe("replace");
    expect(collectionReuse({ ...checkpoint, complete: true, uniqueCount: 10 }, "scope", 10, now, false)).toBe("reuse");
    expect(collectionReuse({ ...checkpoint, complete: true, uniqueCount: 10 }, "scope", 11, now, false)).toBe("replace");
    expect(collectionReuse({ ...checkpoint, complete: true, stopReason: "exhausted" }, "scope", 100, now, false)).toBe("reuse");
    expect(collectionReuse({ ...checkpoint, startedAt: now - FRESHNESS.collectionMs }, "scope", 10, now, true)).toBe("replace");
    expect(collectionReuse(checkpoint, "changed-scope", 10, now, true)).toBe("replace");
  });
  test("exponential retry with bounded attempts honors provider timing", () => {
    expect(retryAt(0, 1, 0)).toBe(500); expect(retryAt(0, 1, 1)).toBe(1500);
    expect(retryAt(0, 2, 0.5)).toBe(2000); expect(retryAt(0, 3, 0.5)).toBeNull();
    expect(retryAt(0, 1, 0.5, 9000)).toBe(9000);
  });
});

describe("confidence and verified identities", () => {
  test("High and Medium boundaries count distinct sources and recent support", () => {
    expect(evidenceConfidence(evidence(10), now).confidence).toBe("high");
    expect(evidenceConfidence(evidence(9), now).confidence).toBe("medium");
    expect(evidenceConfidence(evidence(3), now).confidence).toBe("medium");
    expect(evidenceConfidence(evidence(2), now).confidence).toBe("low");
    const insufficientRecent = evidence(10); insufficientRecent.support[0].date = "2020-01-01";
    expect(evidenceConfidence(insufficientRecent, now).confidence).toBe("medium");
    expect(evidenceConfidence({ ...evidence(10), support: Array(10).fill(evidence(10).support[0]) }, now).confidence).toBe("low");
  });
  test("contradictions and identity uncertainty cap Low; missing checks and provisional cap Medium", () => {
    for (const flag of ["materialContradiction", "identityUncertain"] as const) expect(evidenceConfidence({ ...evidence(10), [flag]: true }, now).confidence).toBe("low");
    expect(evidenceConfidence({ ...evidence(10), validCitations: false }, now).confidence).toBe("low");
    for (const flag of ["provisional", "missingSourceDependency"] as const) expect(evidenceConfidence({ ...evidence(10), [flag]: true }, now).confidence).toBe("medium");
    expect(evidenceConfidence({ ...evidence(10), checksCompleted: false }, now).confidence).toBe("medium");
    expect(evidenceConfidence({ ...evidence(10), support: evidence(10).support.map(r => ({ ...r, date: null })) }, now).confidence).toBe("low");
  });
  test("one product cross-platform exception requires both searches and resolved feasibility", () => {
    const single = { ...evidence(10), support: evidence(10).support.map(r => ({ ...r, productId: "one", developerId: "one" })) };
    expect(evidenceConfidence(single, now).confidence).toBe("medium");
    const crossPlatform = { sameProductSearch: true, needBasedSearch: true, feasibilityUnresolved: false };
    expect(evidenceConfidence({ ...single, crossPlatform }, now).confidence).toBe("high");
    expect(evidenceConfidence({ ...single, crossPlatform: { ...crossPlatform, needBasedSearch: false } }, now).confidence).toBe("medium");
    expect(evidenceConfidence({ ...single, crossPlatform: { ...crossPlatform, feasibilityUnresolved: true } }, now).confidence).toBe("medium");
  });
  test("a matching name or developer never proves same-product identity", () => {
    expect(counterpartStatus({ official: false, exactStoreIdsLinked: false, firstPartyStatement: false, suggestedMatch: true })).toBe("potential");
    expect(counterpartStatus({ official: true, exactStoreIdsLinked: true, firstPartyStatement: false, suggestedMatch: true })).toBe("verified");
    expect(counterpartStatus({ official: false, exactStoreIdsLinked: true, firstPartyStatement: false, suggestedMatch: false })).toBe("not_found");
  });
});
