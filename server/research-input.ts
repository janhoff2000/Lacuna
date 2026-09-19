import { z } from "zod";
import { DEFAULT_MODEL } from "./ai";
import { parseStoreUrl } from "./collectors/common";
import { PRESETS } from "./policy";
import { normalizeLanguageTag, parseRunSettings, type RunSettings } from "../shared/types";

export const researchInputSchema = z.object({
  mode: z.enum(["topic", "category"]), query: z.string().trim().max(2000).default(""),
  categories: z.array(z.object({ label: z.string().min(1).max(100), apple: z.string().max(50).nullable(), google: z.string().max(50).nullable() }).strict()).max(12).default([]),
  urls: z.array(z.string().max(2000)).max(100).default([]),
  websiteUrls: z.array(z.string().url().max(2000)).max(10).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "topic" && !value.query && !value.urls.length) ctx.addIssue({ code: "custom", message: "Enter a need or a store URL" });
  if (value.mode === "category" && !value.categories.length) ctx.addIssue({ code: "custom", message: "Select at least one category" });
  for (const url of value.urls) try { parseStoreUrl(url); } catch { ctx.addIssue({ code: "custom", message: "Invalid store URL" }); }
});
export type ResearchInput = z.infer<typeof researchInputSchema>;
export function researchSettings(value: unknown): RunSettings {
  const settings = parseRunSettings(value);
  if (settings.appLimit > 100 || settings.reviewLimit > 20_000 || settings.countries.length > 30) throw new Error("Scope exceeds local safety limits");
  if (settings.stores !== undefined && (!Array.isArray(settings.stores) || !settings.stores.length || !settings.stores.every(s => s === "apple" || s === "google"))) throw new Error("Invalid stores");
  if (settings.languages !== undefined && (!Array.isArray(settings.languages) || !settings.languages.every(l => typeof l === "string" && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(l)) || settings.languages.length > 20)) throw new Error("Invalid review languages");
  if (settings.spokenLanguages.length > 20) throw new Error("Invalid spoken languages");
  if (settings.model !== undefined && (typeof settings.model !== "string" || !settings.model.trim() || settings.model.length > 100)) throw new Error("Invalid model");
  if (settings.crossPlatform !== undefined && typeof settings.crossPlatform !== "boolean") throw new Error("Invalid cross-platform choice");
  if (settings.direction !== undefined && !["android_to_ios", "ios_to_android", "both"].includes(String(settings.direction))) throw new Error("Invalid platform direction");
  return { ...settings, countries: [...new Set(settings.countries)], stores: settings.stores ?? ["apple", "google"], languages: settings.languages ?? [], spokenLanguages: [...new Set(settings.spokenLanguages.map(normalizeLanguageTag))], model: settings.model ?? DEFAULT_MODEL, crossPlatform: settings.crossPlatform ?? true, direction: settings.direction ?? "android_to_ios" };
}
export function defaultResearchSettings(): RunSettings {
  return researchSettings({ preset: "quick", countries: ["US", "GB", "DE", "FR", "NL", "ES"], spokenLanguages: ["en"], appLimit: PRESETS.quick.apps, reviewLimit: PRESETS.quick.reviews, reviewCandidates: false });
}
export function searchIntents(input: ResearchInput, preset: "quick" | "deep"): string[] {
  const terms = input.mode === "category" ? input.categories.map(category => [category.label, input.query].filter(Boolean).join(" ")) : [input.query, ...input.query.split(/[;\n]/)];
  return [...new Set(terms.map(term => term.trim()).filter(Boolean))].slice(0, PRESETS[preset].searchIntents);
}
