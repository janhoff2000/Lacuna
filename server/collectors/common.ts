import { createHash } from "node:crypto";
import type { JsonObject, Store } from "../../shared/types";

export const COLLECTOR_VERSION = "stores-v1";
export interface Locale { country: string; language: string }
export interface StoreReference { store: Store; appId: string; url: string; country: string | null }
export interface Listing extends Locale {
  store: Store; appId: string; title: string; description: string; developerId: string;
  developer: string; url: string; website: string | null; icon: string | null;
  category: string | null; categoryId: string | null; rating: number | null;
  ratingTotal: number | null; writtenReviewTotal: number | null;
  price: number | null; currency: string | null; rawFingerprint: string;
  request: JsonObject; capturedAt: number;
  // First store release as reported by the listing; absent on snapshots captured before it was recorded.
  released?: string | null;
}
export interface WrittenReview extends Locale {
  store: Store; appId: string; reviewId: string | null; title: string; text: string;
  rating: number; date: string | null; url: string; directReviewUrl: boolean;
  detectedLanguage: string | null; rawFingerprint: string;
  identityVerified: boolean; identityReason: string; request: JsonObject; capturedAt: number;
}
export interface ReviewPage { reviews: WrittenReview[]; nextCursor: string | null; exhausted: boolean; request: JsonObject }
export class CollectionFailure extends Error {
  constructor(public code: "cursor_invalid" | "access_denied" | "rate_limited" | "temporary", public retryAt: number | null = null) { super(code); }
}
export function collectionFailure(error: unknown): CollectionFailure {
  if (error instanceof CollectionFailure) return error;
  const raw = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const message = error instanceof Error ? error.message : "";
  const status = Number(raw.statusCode ?? raw.status);
  if (/invalid.*(?:cursor|pagination)|(?:cursor|pagination).*(?:invalid|expired)/i.test(message)) return new CollectionFailure("cursor_invalid");
  if ([401, 403].includes(status)) return new CollectionFailure("access_denied");
  if (status === 429) return new CollectionFailure("rate_limited");
  return new CollectionFailure("temporary");
}
// Both scrapers report a listing absent from the requested storefront with this
// message: Apple for an empty lookup result, Google for an HTTP 404. Every other
// failure (timeout, rate limit, parsing) says nothing about availability.
export function listingMissing(error: unknown): boolean {
  return error instanceof Error && /^App not found \(404\)$/.test(error.message);
}
export const CHART_COLLECTIONS = ["free", "paid", "grossing"] as const;
export interface ChartOptions { collection?: (typeof CHART_COLLECTIONS)[number]; limit?: number }
export interface StoreAdapter {
  search(term: string, locale: Locale, signal: AbortSignal): Promise<Listing[]>;
  chart(category: string, locale: Locale, signal: AbortSignal, options?: ChartOptions): Promise<Listing[]>;
  details(appId: string, locale: Locale, signal: AbortSignal): Promise<Listing>;
  related(appId: string, locale: Locale, signal: AbortSignal): Promise<Listing[]>;
  reviews(appId: string, locale: Locale, cursor: string | null, signal: AbortSignal): Promise<ReviewPage>;
  // Optional: which of these IDs are listed in one storefront, answered in a single request.
  availability?(appIds: string[], locale: Locale, signal: AbortSignal): Promise<Set<string>>;
  // Optional: full listings for many IDs in one request. IDs the store does not return are simply absent.
  detailsMany?(appIds: string[], locale: Locale, signal: AbortSignal): Promise<Listing[]>;
}
export function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid store response");
  return value as Record<string, unknown>;
}
export const string = (value: unknown): string => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
export const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
export function publicLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function storeUrl(store: Store, appId: string, country = "US"): string {
  return store === "apple" ? `https://apps.apple.com/${country.toLowerCase()}/app/id${appId}` : `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}`;
}
export function parseStoreUrl(value: string): StoreReference {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a full Apple App Store or Google Play URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("Store URLs must use HTTPS without credentials or custom ports");
  if (url.hostname === "apps.apple.com" || url.hostname === "itunes.apple.com") {
    const match = url.pathname.match(/^\/(?:(?<country>[a-zA-Z]{2})\/)?app\/(?:[^/]+\/)?id(?<id>[1-9]\d*)\/?$/);
    if (!match?.groups) throw new Error("Apple URL must contain the exact numeric app ID");
    return { store: "apple", appId: match.groups.id, country: match.groups.country?.toUpperCase() ?? null, url: storeUrl("apple", match.groups.id, match.groups.country) };
  }
  if (url.hostname === "play.google.com" && url.pathname === "/store/apps/details") {
    const ids = url.searchParams.getAll("id");
    if (ids.length !== 1 || !/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(ids[0])) throw new Error("Google URL must contain one exact package ID");
    return { store: "google", appId: ids[0], country: null, url: storeUrl("google", ids[0]) };
  }
  throw new Error("Only Apple App Store and Google Play listing URLs are supported");
}
export function normalizeListing(store: Store, value: unknown, locale: Locale, request: JsonObject, now = Date.now()): Listing {
  const raw = record(value); const appId = string(store === "apple" ? raw.id : raw.appId);
  if (!(store === "apple" ? /^[1-9]\d*$/.test(appId) : /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(appId))) throw new Error("Missing or malformed listing ID");
  return { store, appId, ...locale, title: string(raw.title), description: string(raw.description ?? raw.summary), developerId: `${store}:${string(raw.developerId) || `unknown:${appId}`}`,
    developer: string(raw.developer), url: storeUrl(store, appId, locale.country), website: publicLink(raw.developerWebsite), icon: publicLink(raw.icon),
    category: string(raw.genre) || null, categoryId: string(raw.genreId) || null, rating: number(raw.score),
    // Apple "reviews" is a rating count, not a count of written reviews.
    ratingTotal: number(store === "apple" ? raw.reviews : raw.ratings), writtenReviewTotal: store === "google" ? number(raw.reviews) : null,
    price: number(raw.price), currency: string(raw.currency) || null, rawFingerprint: hash(raw), request, capturedAt: now, released: isoDate(raw.released) };
}
function isoDate(value: unknown): string | null {
  const parsed = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
export function normalizeReview(store: Store, appId: string, value: unknown, locale: Locale, request: JsonObject, trusted = false, now = Date.now()): WrittenReview {
  const raw = record(value); const id = string(raw.id).trim();
  const dateValue = raw.updated ?? raw.date;
  const parsedDate = dateValue instanceof Date ? dateValue.getTime() : typeof dateValue === "string" ? Date.parse(dateValue) : NaN;
  const rating = number(raw.score);
  if (rating === null || rating < 1 || rating > 5) throw new Error("Review has no valid star rating");
  const actualUrl = publicLink(raw.url);
  return { store, appId, ...locale, reviewId: id || null, title: string(raw.title), text: string(raw.text), rating,
    date: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null,
    url: actualUrl ?? storeUrl(store, appId, locale.country), directReviewUrl: actualUrl !== null,
    detectedLanguage: null, rawFingerprint: hash(raw), identityVerified: trusted && !!id,
    identityReason: !id ? "missing_id" : trusted ? "validated_scope" : "identity_trial_inconclusive", request, capturedAt: now };
}

const MARKET_LANGUAGES: Record<string, string[]> = {
  US: ["en"], GB: ["en"], DE: ["de"], AT: ["de"], FR: ["fr"], NL: ["nl"], ES: ["es"], IT: ["it"], PT: ["pt"], BR: ["pt"],
  CA: ["en", "fr"], CH: ["de", "fr", "it"], BE: ["nl", "fr"], MX: ["es"], AR: ["es"], AU: ["en"], IN: ["hi", "en"], JP: ["ja"], KR: ["ko"], CN: ["zh"], TW: ["zh"], PL: ["pl"], TR: ["tr"], SE: ["sv"], DK: ["da"], NO: ["no"], FI: ["fi"], ID: ["id"], RU: ["ru"], UA: ["uk"], SA: ["ar"], IL: ["he"], TH: ["th"], VN: ["vi"],
};
export function planLocales(store: Store, countries: string[], additionalLanguages: string[] = []): Locale[] {
  if (!countries.length || !countries.every(c => /^[A-Z]{2}$/.test(c))) throw new Error("Explicit country codes required");
  if (!additionalLanguages.every(l => /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(l))) throw new Error("Invalid language code");
  if (store === "apple") return [...new Set(countries)].map(country => ({ country, language: MARKET_LANGUAGES[country]?.[0] ?? "en" }));
  const streams = new Map<string, string>([["en", countries.find(c => MARKET_LANGUAGES[c]?.includes("en")) ?? countries[0]]]);
  for (const country of countries) for (const language of MARKET_LANGUAGES[country] ?? []) if (!streams.has(language)) streams.set(language, country);
  for (const language of additionalLanguages) if (!streams.has(language)) streams.set(language, countries[0]);
  return [...streams].map(([language, country]) => ({ language, country }));
}
