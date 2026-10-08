import appleStore from "app-store-scraper";
import { LIMITS } from "../policy";
import { normalizeListing, normalizeReview, record, string, type Locale, type StoreAdapter } from "./common";
import type { JsonObject } from "../../shared/types";

type AppleClient = { search(options: JsonObject): Promise<unknown[]>; list(options: JsonObject): Promise<unknown[]>; app(options: JsonObject): Promise<unknown>; similar(options: JsonObject): Promise<unknown[]>; reviews(options: JsonObject): Promise<unknown[]>; category: Record<string, number>; collection: { TOP_FREE_IOS: string; TOP_PAID_IOS: string; TOP_GROSSING_IOS: string }; sort: { RECENT: string } };
const client = appleStore as AppleClient;
// The scraper looks IDs up one at a time through this same endpoint. Asking for
// many IDs at once keeps a large storefront survey to a handful of requests.
export type AppleLookup = (url: string, signal: AbortSignal) => Promise<unknown>;
const lookupJson: AppleLookup = async (url, signal) => {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
  if (!response.ok) throw Object.assign(new Error("lookup_failed"), { status: response.status });
  return response.json();
};
export function appleAdapter(api: AppleClient = client, lookup: AppleLookup = lookupJson): StoreAdapter {
  const options = (locale: Locale): JsonObject => ({ country: locale.country.toLowerCase(), lang: locale.language, requestOptions: { timeout: 15_000 } });
  const many = async (appIds: string[], locale: Locale, signal: AbortSignal) => {
    if (!appIds.length || appIds.length > 200 || appIds.some(id => !/^[1-9]\d*$/.test(id))) throw new Error("Invalid Apple app IDs");
    signal.throwIfAborted();
    const url = `https://itunes.apple.com/lookup?id=${appIds.join(",")}&country=${locale.country.toLowerCase()}&entity=software`;
    const body = record(await lookup(url, signal)); signal.throwIfAborted();
    if (!Array.isArray(body.results)) throw new Error("Invalid store response");
    return { rows: body.results.map(record), request: { country: locale.country.toLowerCase(), lookup: appIds.length } as JsonObject };
  };
  return {
    async search(term, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), term, num: LIMITS.searchResults, idsOnly: true };
      // idsOnly avoids hidden bulk metadata lookup in this scraper; details are budgeted by discovery.
      const ids = await api.search(request); signal.throwIfAborted();
      return ids.slice(0, LIMITS.searchResults).map(id => normalizeListing("apple", { id, title: "", description: "" }, locale, request));
    },
    async chart(category, locale, signal, chart = {}) {
      signal.throwIfAborted(); const categoryId = api.category[category] ?? Number(category);
      if (!Object.values(api.category).includes(categoryId)) throw new Error("Unsupported Apple category");
      const limit = chart.limit ?? LIMITS.chartResults;
      const collection = { free: api.collection.TOP_FREE_IOS, paid: api.collection.TOP_PAID_IOS, grossing: api.collection.TOP_GROSSING_IOS }[chart.collection ?? "free"];
      const request = { ...options(locale), category: categoryId, collection, num: limit, fullDetail: false };
      const rows = await api.list(request); signal.throwIfAborted();
      return rows.slice(0, limit).map(row => normalizeListing("apple", row, locale, request));
    },
    async details(appId, locale, signal) {
      signal.throwIfAborted(); const request = { ...options(locale), id: appId };
      const row = await api.app(request); signal.throwIfAborted(); return normalizeListing("apple", row, locale, request);
    },
    async availability(appIds, locale, signal) {
      return new Set((await many(appIds, locale, signal)).rows.map(row => string(row.trackId)).filter(Boolean));
    },
    async detailsMany(appIds, locale, signal) {
      const { rows, request } = await many(appIds, locale, signal);
      // The same fields the scraper maps for a single lookup.
      return rows.filter(row => appIds.includes(string(row.trackId))).map(row => normalizeListing("apple", { id: row.trackId, title: row.trackName, description: row.description, developerId: row.artistId, developer: row.artistName, developerWebsite: row.sellerUrl, icon: row.artworkUrl512 ?? row.artworkUrl100, genre: row.primaryGenreName, genreId: row.primaryGenreId, score: row.averageUserRating, reviews: row.userRatingCount, price: row.price, currency: row.currency, released: row.releaseDate }, locale, request));
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
