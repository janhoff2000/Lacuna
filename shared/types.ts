// Browser-safe values and bounded JSON validation. Never import server modules here.
export const RUN_STATUSES = ["queued", "running", "paused", "completed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export type RunReason = "app_review" | "user" | "budget" | "interrupted" | "error" | null;
export const STAGES = ["discovery", "candidate_review", "collection", "analysis", "grouping", "verification", "report"] as const;
export type Stage = (typeof STAGES)[number];
export type Store = "apple" | "google";
export const LANGUAGE_TAG = /^[a-z]{2,3}(?:-[A-Z]{2})?$/;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function normalizeLanguageTag(value: string): string {
  const [language = "", region] = value.trim().split("-");
  return region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

export function languageMatchesAny(
  language: string,
  accepted: readonly string[],
): boolean {
  const candidate = normalizeLanguageTag(language).toLowerCase();
  if (!candidate) return false;
  const base = candidate.split("-")[0];
  return accepted.some((value) => {
    const normalized = normalizeLanguageTag(value).toLowerCase();
    return normalized === candidate || normalized.split("-")[0] === base;
  });
}

export function validateJson(value: unknown, depth = 0): asserts value is Json {
  if (depth > 30) throw new Error("JSON exceeds maximum nesting");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, depth + 1);
    return;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|authorization|secret|access[_-]?token/i.test(key)) throw new Error("Secrets must not be persisted");
      validateJson(item, depth + 1);
    }
    return;
  }
  throw new Error("Invalid JSON value");
}

export function encodeJson(value: unknown): string {
  validateJson(value);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > 1_048_576) throw new Error("JSON payload exceeds 1 MiB");
  return encoded;
}

export function decodeObject(encoded: string): JsonObject {
  if (new TextEncoder().encode(encoded).length > 1_048_576) throw new Error("JSON payload exceeds 1 MiB");
  const value: unknown = JSON.parse(encoded);
  validateJson(value);
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Expected JSON object");
  return value;
}

export interface RunSettings {
  preset: "quick" | "deep";
  countries: string[];
  spokenLanguages: string[];
  appLimit: number;
  reviewLimit: number;
  reviewCandidates: boolean;
  [key: string]: Json;
}

export function parseRunSettings(value: unknown): RunSettings {
  validateJson(value);
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error("Expected run settings");
  if (value.preset !== "quick" && value.preset !== "deep") throw new Error("Invalid preset");
  if (!Array.isArray(value.countries) || !value.countries.length || !value.countries.every(c => typeof c === "string" && /^[A-Z]{2}$/.test(c))) throw new Error("Explicit country codes required");
  if (!Array.isArray(value.spokenLanguages) || !value.spokenLanguages.length || !value.spokenLanguages.every(language => typeof language === "string" && LANGUAGE_TAG.test(language))) throw new Error("Explicit spoken language codes required");
  for (const key of ["appLimit", "reviewLimit"] as const) {
    if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) throw new Error(`Invalid ${key}`);
  }
  if (typeof value.reviewCandidates !== "boolean") throw new Error("Invalid candidate review choice");
  return value as RunSettings;
}
