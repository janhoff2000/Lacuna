import appleStore from "app-store-scraper";
import { LIMITS } from "../policy";
import { normalizeListing, normalizeReview, type Locale, type StoreAdapter } from "./common";
import type { JsonObject } from "../../shared/types";

type AppleClient = { search(options: JsonObject): Promise<unknown[]>; list(options: JsonObject): Promise<unknown[]>; app(options: JsonObject): Promise<unknown>; similar(options: JsonObject): Promise<unknown[]>; reviews(options: JsonObject): Promise<unknown[]>; category: Record<string, number>; collection: { TOP_FREE_IOS: string }; sort: { RECENT: string } };
const client = appleStore as AppleClient;
export function appleAdapter(api: AppleClient = client): StoreAdapter {
  const options = (locale: Locale): JsonObject => ({ country: locale.country.toLowerCase(), lang: locale.language, requestOptions: { timeout: 15_000 } });
  return {
    async search(term, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), term, num: LIMITS.searchResults, idsOnly: true };
      // idsOnly avoids hidden bulk metadata lookup in this scraper; details are budgeted by discovery.
      const ids = await api.search(request); signal.throwIfAborted();
      return ids.slice(0, LIMITS.searchResults).map(id => normalizeListing("apple", { id, title: "", description: "" }, locale, request));
    },
    async chart(category, locale, signal) {
      signal.throwIfAborted(); const categoryId = api.category[category] ?? Number(category);
      if (!Object.values(api.category).includes(categoryId)) throw new Error("Unsupported Apple category");
      const request = { ...options(locale), category: categoryId, collection: api.collection.TOP_FREE_IOS, num: LIMITS.chartResults, fullDetail: false };
      const rows = await api.list(request); signal.throwIfAborted();
      return rows.slice(0, LIMITS.chartResults).map(row => normalizeListing("apple", row, locale, request));
    },
    async details(appId, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), id: appId };
      const row = await api.app(request); signal.throwIfAborted(); return normalizeListing("apple", row, locale, request);
    },
    async related(appId, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), id: appId };
      const rows = await api.similar(request); signal.throwIfAborted();
      return rows.slice(0, LIMITS.relatedPerSeed).map(row => normalizeListing("apple", row, locale, request));
    },
    async reviews(appId, locale, cursor, signal) {
      const page = cursor === null ? 1 : Number(cursor);
      if (!Number.isSafeInteger(page) || page < 1 || page > LIMITS.appleStreamPages) throw new Error("Invalid Apple page cursor");
      signal.throwIfAborted(); const request = { ...options(locale), id: appId, page, sort: api.sort.RECENT };
      const rows = await api.reviews(request); signal.throwIfAborted();
      return { reviews: rows.map(row => normalizeReview("apple", appId, row, locale, request, true)), nextCursor: rows.length && page < LIMITS.appleStreamPages ? String(page + 1) : null, exhausted: !rows.length, request };
    },
  };
}
