import googlePlay from "google-play-scraper";
import { LIMITS } from "../policy";
import { normalizeListing, normalizeReview, type Locale, type StoreAdapter } from "./common";
import type { JsonObject } from "../../shared/types";

type GoogleClient = { search(options: JsonObject): Promise<unknown[]>; list(options: JsonObject): Promise<unknown[]>; app(options: JsonObject): Promise<unknown>; similar(options: JsonObject): Promise<unknown[]>; reviews(options: JsonObject): Promise<{ data: unknown[]; nextPaginationToken?: string }>; category: Record<string, string>; collection: { TOP_FREE: string; TOP_PAID: string; GROSSING: string }; sort: { NEWEST: number } };
export function googleAdapter(api: GoogleClient = googlePlay as unknown as GoogleClient): StoreAdapter {
  const options = (locale: Locale): JsonObject => ({ country: locale.country.toLowerCase(), lang: locale.language, requestOptions: { timeout: 15_000 } });
  return {
    async search(term, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), term, num: LIMITS.searchResults, fullDetail: false };
      const rows = await api.search(request); signal.throwIfAborted(); return rows.slice(0, LIMITS.searchResults).map(row => normalizeListing("google", row, locale, request));
    },
    async chart(category, locale, signal, chart = {}) {
      if (!Object.values(api.category).includes(category)) throw new Error("Unsupported Google category");
      const limit = chart.limit ?? LIMITS.chartResults;
      const collection = { free: api.collection.TOP_FREE, paid: api.collection.TOP_PAID, grossing: api.collection.GROSSING }[chart.collection ?? "free"];
      signal.throwIfAborted(); const request = { ...options(locale), category, collection, num: limit, fullDetail: false };
      const rows = await api.list(request); signal.throwIfAborted(); return rows.slice(0, limit).map(row => normalizeListing("google", row, locale, request));
    },
    async details(appId, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), appId };
      const row = await api.app(request); signal.throwIfAborted(); return normalizeListing("google", row, locale, request);
    },
    async related(appId, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), appId, fullDetail: false };
      const rows = await api.similar(request); signal.throwIfAborted(); return rows.slice(0, LIMITS.relatedPerSeed).map(row => normalizeListing("google", row, locale, request));
    },
    async reviews(appId, locale, cursor, signal) {
      signal.throwIfAborted(); const request: JsonObject = { ...options(locale), appId, sort: api.sort.NEWEST, paginate: true, num: 100, ...(cursor ? { nextPaginationToken: cursor } : {}) };
      const response = await api.reviews(request); signal.throwIfAborted();
      return { reviews: response.data.map(row => normalizeReview("google", appId, row, locale, request, true)), nextCursor: response.nextPaginationToken || null, exhausted: !response.data.length || !response.nextPaginationToken, request };
    },
  };
}
