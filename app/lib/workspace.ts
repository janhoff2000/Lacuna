import type { Json, JsonObject } from "../../shared/types";

export const STATUS_LABELS = {
  to_investigate: "To investigate",
  investigating: "Investigating",
  consider: "Consider",
  dismissed: "Dismissed",
} as const;
export const COUNTRY_PRESETS = {
  international: ["US", "GB", "DE", "FR", "NL", "ES"],
  us: ["US"],
  europe: ["GB", "DE", "FR", "NL", "ES"],
};
// IDs checked against both installed scraper catalogs. A category spans both stores.
export const CATEGORIES = [
  { label: "Productivity", apple: "6007", google: "PRODUCTIVITY" },
  { label: "Health and fitness", apple: "6013", google: "HEALTH_AND_FITNESS" },
  { label: "Food and drink", apple: "6023", google: "FOOD_AND_DRINK" },
  { label: "Finance", apple: "6015", google: "FINANCE" },
  { label: "Education", apple: "6017", google: "EDUCATION" },
  { label: "Travel", apple: "6003", google: "TRAVEL_AND_LOCAL" },
  { label: "Lifestyle", apple: "6012", google: "LIFESTYLE" },
  { label: "Business", apple: "6000", google: "BUSINESS" },
  { label: "Shopping", apple: "6024", google: "SHOPPING" },
  { label: "Medical", apple: "6020", google: "MEDICAL" },
  { label: "Music", apple: "6011", google: "MUSIC_AND_AUDIO" },
  { label: "Navigation", apple: "6010", google: "MAPS_AND_NAVIGATION" },
  { label: "Entertainment", apple: "6016", google: "ENTERTAINMENT" },
  { label: "Social", apple: "6005", google: "SOCIAL" },
  { label: "Photo and video", apple: "6008", google: "PHOTOGRAPHY" },
  { label: "Utilities", apple: "6002", google: "TOOLS" },
  { label: "News", apple: "6009", google: "NEWS_AND_MAGAZINES" },
  { label: "Sports", apple: "6004", google: "SPORTS" },
  { label: "Weather", apple: "6001", google: "WEATHER" },
  { label: "Books and reference", apple: "6018", google: "BOOKS_AND_REFERENCE" },
  { label: "Games", apple: "6014", google: "GAME" },
] as const;
export type FormValues = Record<string, string | string[]>;
export type ActionResult = {
  errors?: Record<string, string>;
  values?: FormValues;
  intent?: string;
  ok?: boolean;
  savedId?: string;
};
export const obj = (value: Json | undefined): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const objects = (value: Json | undefined): JsonObject[] =>
  Array.isArray(value) ? value.map(obj) : [];
export const strings = (value: Json | undefined): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export const str = (value: Json | undefined, fallback = ""): string =>
  typeof value === "string" ? value : fallback;
export const num = (value: Json | undefined): number =>
  typeof value === "number" ? value : 0;
export const title = (input: JsonObject): string =>
  str(input.query) ||
  (input.mode === "explore" ? "Explore app niches" : "") ||
  (input.mode === "ideas"
    ? `${str(input.sourceCountry)} business ideas for ${str(input.targetCountry)}`
    : "") ||
  (input.mode === "transfer"
    ? `${str(input.sourceCountry)} apps not yet in ${str(input.targetCountry)}`
    : "") ||
  objects(input.categories)
    .map((category) => str(category.label))
    .join(", ") ||
  "App research";
export const storeLabel = (store: string | null): string =>
  store === "apple"
    ? "App Store"
    : store === "google"
      ? "Google Play"
      : "Website";
export const perspectiveLabel = (value: Json | undefined): string =>
  ({
    missing_capability: "Missing capability",
    underserved_audience: "Underserved audience",
    poor_execution: "Poor execution",
    cross_platform: "Cross-platform",
  })[str(value)] ?? "Opportunity";
export const directionLabel = (value: Json | undefined): string =>
  ({
    android_to_ios: "Android → iOS",
    ios_to_android: "iOS → Android",
    both: "Both directions",
  })[str(value)] ?? "";
export const stageLabel = (value: string): string =>
  ({
    discovery: "Finding apps",
    candidate_review: "Reviewing apps",
    collection: "Collecting reviews",
    analysis: "Reading evidence",
    grouping: "Forming opportunities",
    verification: "Checking competitors",
    report: "Preparing report",
  })[value] ?? "Research";
export const date = (value: number | string | null | undefined): string =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Intl.DateTimeFormat("en", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Date unavailable";
export const money = (value: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
export function safeUrl(value: string | null | undefined): string | undefined {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function runLabel(
  run: { status: string; reason: string | null; coverage?: string },
  worker?: string,
): string {
  if (run.status === "queued")
    return worker === "not_running"
      ? "Queued · Worker not running"
      : worker === "not_responding"
        ? "Queued · Worker not responding"
        : "Queued";
  if (run.status === "paused")
    return (
      {
        app_review: "Awaiting app review",
        budget: "Budget reached",
        interrupted: "Interrupted",
        error: "Needs attention",
        user: "Paused",
      }[run.reason ?? ""] ?? "Paused"
    );
  return run.status === "completed"
    ? run.coverage === "gaps"
      ? "Completed with gaps"
      : "Completed"
    : run.status === "running"
      ? "Running"
      : "Cancelled";
}
export const isActive = (status: string): boolean =>
  status === "running" || status === "queued";
export const sourceAnchor = (sourceId: string): string =>
  `source-${encodeURIComponent(sourceId)}`;
export function opportunityUrl(
  base: string,
  opportunityId: string,
  sourceId?: string,
): string {
  const params = new URLSearchParams({ opportunity: opportunityId });
  if (sourceId) params.set("source", sourceId);
  return `${base}?${params}${sourceId ? `#${sourceAnchor(sourceId)}` : ""}`;
}
export function themeScript(appearance: string): string {
  const safeAppearance = ["light", "dark"].includes(appearance)
    ? appearance
    : "system";
  return `document.documentElement.dataset.theme=${JSON.stringify(safeAppearance)}==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):${JSON.stringify(safeAppearance)};`;
}
