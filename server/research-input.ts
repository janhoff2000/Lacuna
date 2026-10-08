import { z } from "zod";
import { DEFAULT_MODEL } from "./ai";
import { parseStoreUrl } from "./collectors/common";
import { PRESETS } from "./policy";
import { normalizeLanguageTag, parseRunSettings, type RunSettings } from "../shared/types";
import { IDEA_LIMITS, PRESENCE } from "../shared/ideas";

const pastedUrl = z.string().url().max(IDEA_LIMITS.url);
const pastedIdea = z.object({ id: z.string().regex(/^idea-\d{1,2}$/), name: z.string().min(1).max(IDEA_LIMITS.name), summary: z.string().max(IDEA_LIMITS.text), officialUrl: pastedUrl.nullable(), urls: z.array(pastedUrl).max(IDEA_LIMITS.urls) }).strict();
const pastedMarket = z.object({ id: z.string().regex(/^idea-\d{1,2}$/), presence: z.enum(PRESENCE), note: z.string().max(IDEA_LIMITS.text), urls: z.array(pastedUrl).max(IDEA_LIMITS.urls),
  equivalents: z.array(z.object({ name: z.string().min(1).max(IDEA_LIMITS.name), url: pastedUrl.nullable(), note: z.string().max(IDEA_LIMITS.text) }).strict()).max(IDEA_LIMITS.equivalents) }).strict();
export const researchInputSchema = z.object({
  mode: z.enum(["topic", "category", "explore", "transfer", "ideas"]), query: z.string().trim().max(2000).default(""),
  categories: z.array(z.object({ label: z.string().min(1).max(100), apple: z.string().max(50).nullable(), google: z.string().max(50).nullable() }).strict()).max(30).default([]),
  urls: z.array(z.string().max(2000)).max(100).default([]),
  websiteUrls: z.array(z.string().url().max(2000)).max(10).default([]),
  // Market transfer: apps listed in the source storefront are checked against the target storefront.
  sourceCountry: z.string().regex(/^[A-Z]{2}$/).optional(), targetCountry: z.string().regex(/^[A-Z]{2}$/).optional(),
  // Business ideas: parsed from deep research the user ran elsewhere and pasted in. Only the URLs are evidence.
  ideas: z.array(pastedIdea).min(1).max(IDEA_LIMITS.ideas).optional(), targetFindings: z.array(pastedMarket).max(IDEA_LIMITS.ideas).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "topic" && !value.query && !value.urls.length) ctx.addIssue({ code: "custom", message: "Enter a need or a store URL" });
  const markets = value.mode === "transfer" || value.mode === "ideas";
  if (markets && (!value.sourceCountry || !value.targetCountry || value.sourceCountry === value.targetCountry)) ctx.addIssue({ code: "custom", message: "Choose two different markets" });
  if (!markets && (value.sourceCountry || value.targetCountry)) ctx.addIssue({ code: "custom", message: "Markets apply only to market transfer and business ideas" });
  if ((value.mode === "ideas") !== !!value.ideas) ctx.addIssue({ code: "custom", message: "Pasted ideas are required for, and limited to, business ideas" });
  if (value.targetFindings && (!value.ideas || value.targetFindings.some(finding => !value.ideas!.some(idea => idea.id === finding.id)))) ctx.addIssue({ code: "custom", message: "Target-market findings must match the pasted ideas" });
  if (["category", "explore", "transfer"].includes(value.mode) && !value.categories.length) ctx.addIssue({ code: "custom", message: "Select at least one category" });
  for (const url of value.urls) try { parseStoreUrl(url); } catch { ctx.addIssue({ code: "custom", message: "Invalid store URL" }); }
});
export const MAX_SURVEY_LISTINGS = 25_000;
export type ResearchInput = z.infer<typeof researchInputSchema>;
// Explore and transfer sample broadly before narrowing, so they use the wider discovery allowances.
export const broadDiscovery = (mode: ResearchInput["mode"]): boolean => mode === "explore" || mode === "transfer";
export function researchSettings(value: unknown): RunSettings {
  const settings = parseRunSettings(value);
  if (settings.discoveryLimit > 2_000 || settings.exploreAppLimit > 100 || settings.appLimit > 100 || settings.reviewLimit > 20_000 || settings.countries.length > 30) throw new Error("Scope exceeds local safety limits");
  if (settings.stores !== undefined && (!Array.isArray(settings.stores) || !settings.stores.length || !settings.stores.every(s => s === "apple" || s === "google"))) throw new Error("Invalid stores");
  if (settings.languages !== undefined && (!Array.isArray(settings.languages) || !settings.languages.every(l => typeof l === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(l)) || settings.languages.length > 20)) throw new Error("Invalid review languages");
  if (settings.spokenLanguages.length > 20) throw new Error("Invalid spoken languages");
  // Market-transfer survey size. It lives in its own table, so it is not bound by the checkpoint-sized limits above.
  const surveyLimit = settings.surveyLimit ?? PRESETS[settings.preset].surveyListings;
  if (typeof surveyLimit !== "number" || !Number.isSafeInteger(surveyLimit) || surveyLimit < 1 || surveyLimit > MAX_SURVEY_LISTINGS) throw new Error("Invalid survey size");
  if (settings.model !== undefined && (typeof settings.model !== "string" || !settings.model.trim() || settings.model.length > 100)) throw new Error("Invalid model");
  if (settings.crossPlatform !== undefined && typeof settings.crossPlatform !== "boolean") throw new Error("Invalid cross-platform choice");
  if (settings.direction !== undefined && !["android_to_ios", "ios_to_android", "both"].includes(String(settings.direction))) throw new Error("Invalid platform direction");
  return { ...settings, surveyLimit, countries: [...new Set(settings.countries)], stores: settings.stores ?? ["apple", "google"], languages: settings.languages ?? [], spokenLanguages: [...new Set(settings.spokenLanguages.map(normalizeLanguageTag))], model: settings.model ?? DEFAULT_MODEL, crossPlatform: settings.crossPlatform ?? true, direction: settings.direction ?? "android_to_ios" };
}
export function defaultResearchSettings(): RunSettings {
  return researchSettings({ preset: "quick", countries: ["US", "GB", "DE", "FR", "NL", "ES"], spokenLanguages: ["en"], discoveryLimit: PRESETS.quick.discoveryApps, exploreAppLimit: PRESETS.quick.exploreApps, appLimit: PRESETS.quick.apps, reviewLimit: PRESETS.quick.reviews, reviewCandidates: false });
}
export function searchIntents(input: ResearchInput, preset: "quick" | "deep"): string[] {
  if (input.mode === "explore" || input.mode === "ideas") return [];
  // Transfer discovery is chart-led; a focus only adds its own searches.
  if (input.mode === "transfer") return [...new Set(input.query.split(/[;\n]/).map(term => term.trim()).filter(Boolean))].slice(0, PRESETS[preset].searchIntents);
  const terms = input.mode === "category" ? input.categories.map(category => [category.label, input.query].filter(Boolean).join(" ")) : [input.query, ...input.query.split(/[;\n]/)];
  return [...new Set(terms.map(term => term.trim()).filter(Boolean))].slice(0, PRESETS[preset].searchIntents);
}
