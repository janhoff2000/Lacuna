import { data, redirect } from "react-router";
import { z } from "zod";
import { openDatabase, type DB } from "../../server/db";
import {
  readSettings,
  researchAction,
  requireSameOrigin,
} from "../../server/operations";
import { parseStoreUrl } from "../../server/collectors/common";
import { LANGUAGE_TAG, normalizeLanguageTag } from "../../shared/types";
import {
  CATEGORIES,
  STATUS_LABELS,
  type ActionResult,
  type FormValues,
} from "./workspace";

const list = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
export class FormError extends Error {
  constructor(public fields: Record<string, string>) {
    super("Check the highlighted fields.");
  }
}
export function parseFields(form: FormData): FormValues {
  const values: FormValues = {};
  if ([...form.entries()].length > 100)
    throw new FormError({
      form: "This form is too large. Reload and try again.",
    });
  for (const key of new Set(form.keys())) {
    const entries = form.getAll(key);
    if (
      entries.some((item) => typeof item !== "string" || item.length > 20_000)
    )
      throw new FormError({
        form: "A field is too long. Shorten it and try again.",
      });
    values[key] = ["categories", "stores"].includes(key)
      ? (entries as string[])
      : (entries[0] as string);
  }
  return values;
}
export function parseResearchForm(
  values: FormValues,
  defaults: Record<string, unknown>,
  withInput = true,
) {
  const field = (name: string) =>
    typeof values[name] === "string" ? (values[name] as string) : "";
  const errors: Record<string, string> = {};
  const integer = (name: string, max: number) => {
    const value = Number(field(name));
    if (
      !field(name) ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > max
    )
      errors[name] =
        `Enter a whole number from 1 to ${max.toLocaleString("en")}.`;
    return value;
  };
  const mode = field("mode");
  const preset = field("preset");
  const countries = [...new Set(list(field("countries").toUpperCase()))];
  if (
    !countries.length ||
    countries.length > 30 ||
    countries.some((country) => !/^[A-Z]{2}$/.test(country))
  )
    errors.countries =
      "Enter 1 to 30 two-letter country codes, separated by commas.";
  const languages = [...new Set(list(field("languages")))];
  if (
    languages.length > 20 ||
    languages.some((language) => !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language))
  )
    errors.languages = "Use language codes such as en, de, or ja (up to 20).";
  const stores = Array.isArray(values.stores) ? values.stores : [];
  if (
    !stores.length ||
    stores.some((store) => !["apple", "google"].includes(store))
  )
    errors.stores = "Choose at least one store.";
  if (!["quick", "deep"].includes(preset))
    errors.preset = "Choose Quick or Deep.";
  const appLimit = integer("appLimit", 100);
  const reviewLimit = integer("reviewLimit", 20_000);
  const budgetUsd = Number(field("budgetUsd"));
  if (
    !field("budgetUsd") ||
    !Number.isFinite(budgetUsd) ||
    budgetUsd < 0 ||
    budgetUsd > 1_000
  )
    errors.budgetUsd = "Enter an AI ceiling between $0 and $1,000.";
  const direction = field("direction");
  if (!["android_to_ios", "ios_to_android", "both"].includes(direction))
    errors.direction = "Choose a direction.";
  const categories = (
    Array.isArray(values.categories) ? values.categories : []
  ).flatMap((label) => {
    const category = CATEGORIES.find((category) => category.label === label);
    if (!category) errors.categories = "Choose a listed category.";
    return category ? [{ ...category }] : [];
  });
  const urls = list(field("urls"));
  const websiteUrls = list(field("websiteUrls"));
  const query = field("query").trim();
  if (withInput) {
    if (!["topic", "category"].includes(mode))
      errors.mode = "Choose a research mode.";
    if (mode === "topic" && !query && !urls.length)
      errors.query = "Enter a topic, a need, or a store URL below.";
    if (query.length > 2000)
      errors.query = "Keep the topic under 2,000 characters.";
    if (mode === "category" && !categories.length)
      errors.categories = "Choose at least one category.";
    if (urls.length > appLimit)
      errors.urls = "The included apps exceed your app listing maximum.";
    for (const url of urls)
      try {
        parseStoreUrl(url);
      } catch {
        errors.urls =
          "Use full HTTPS App Store or Google Play app listing URLs, one per line.";
      }
    if (
      websiteUrls.length > 10 ||
      websiteUrls.some((url) => {
        try {
          return !["https:", "http:"].includes(new URL(url).protocol);
        } catch {
          return true;
        }
      })
    )
      errors.websiteUrls = "Enter up to 10 complete public website URLs.";
  }
  if (Object.keys(errors).length) throw new FormError(errors);
  return {
    input: { mode, query, categories, urls, websiteUrls },
    settings: {
      ...defaults,
      preset,
      countries,
      languages,
      stores,
      appLimit,
      reviewLimit,
      budgetUsd,
      reviewCandidates: field("reviewCandidates") === "on",
      crossPlatform: field("crossPlatform") === "on",
      direction,
    },
    budgetUsd,
  };
}
const errorCopy: Record<string, string> = {
  "Unknown run":
    "This research run is no longer available. Return to Research and choose another run.",
  "Unknown saved opportunity":
    "This saved opportunity is no longer available. Reload the list.",
  "Candidates can be edited only while waiting for app review":
    "App review has already ended. Reload to see the current run state.",
  "Remove an app or start a run with a higher listing limit":
    "Your app listing maximum is reached. Remove an app before adding another.",
  "Candidate metadata lookup limit reached":
    "The app lookup allowance is used up. Continue with these apps or start a new research run.",
  "Candidate review must be confirmed":
    "Review the selected apps and choose Continue.",
  "Continuation budget cannot decrease":
    "The new ceiling must be at least the current ceiling.",
  "Save an opportunity from a completed report":
    "Saving is available when this report has completed.",
};
export async function workspaceAction(
  request: Request,
  allowed: string[],
  runId?: string,
  database?: DB,
) {
  let values: FormValues = {};
  let db: DB | undefined;
  try {
    requireSameOrigin(request);
    if (Number(request.headers.get("content-length") ?? 0) > 65_536)
      throw new FormError({
        form: "This form is too large. Shorten the content and try again.",
      });
    // Bound the entire request, including chunked bodies, before form decoding.
    const reader = request.clone().body?.getReader();
    let bytes = 0;
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 65_536) {
            void reader.cancel();
            throw new FormError({
              form: "This form is too large. Shorten the content and try again.",
            });
          }
        }
      } finally {
        reader.releaseLock();
      }
    }
    values = parseFields(await request.clone().formData());
    const intent = String(values.intent ?? "");
    if (!allowed.includes(intent))
      throw new FormError({
        form: "This action is unavailable. Reload and try again.",
      });
    db = database ?? openDatabase();
    let payload: Record<string, unknown> = {};
    if (intent === "create" || intent === "settings") {
      const saved = readSettings(db);
      const parsed = parseResearchForm(
        values,
        saved.defaults as Record<string, unknown>,
        intent === "create",
      );
      const model =
        intent === "settings"
          ? String(values.model ?? "")
          : String(saved.model);
      if (!saved.models.includes(model))
        throw new FormError({ model: "Choose one of the configured models." });
      const settings = { ...parsed.settings, model };
      if (intent === "create") payload = { ...parsed, settings: { ...settings, spokenLanguages: saved.spokenLanguages } };
      else {
        const appearance = String(values.appearance ?? "");
        if (!["system", "light", "dark"].includes(appearance))
          throw new FormError({ appearance: "Choose an appearance." });
        const spokenLanguages = [...new Set(list(String(values.spokenLanguages ?? "")).map(normalizeLanguageTag))];
        if (!spokenLanguages.length || spokenLanguages.length > 20 || spokenLanguages.some(language => !LANGUAGE_TAG.test(language)))
          throw new FormError({ spokenLanguages: "Enter 1 to 20 language codes such as en, de, or ja." });
        payload = { appearance, defaults: { ...settings, spokenLanguages }, spokenLanguages, model };
      }
    } else if (intent === "raise_budget") {
      const budgetUsd = Number(values.budgetUsd);
      if (
        !values.budgetUsd ||
        !Number.isFinite(budgetUsd) ||
        budgetUsd < 0 ||
        budgetUsd > 1000
      )
        throw new FormError({
          budgetUsd: "Enter a ceiling between $0 and $1,000.",
        });
      payload = { budgetUsd };
    } else if (intent === "add_candidate") {
      const url = String(values.url ?? "");
      try {
        parseStoreUrl(url);
      } catch {
        throw new FormError({
          url: "Enter a full HTTPS App Store or Google Play app listing URL.",
        });
      }
      payload = { url };
    } else if (intent === "remove_candidate")
      payload = {
        store: String(values.store ?? ""),
        appId: String(values.appId ?? ""),
      };
    else if (intent === "save")
      payload = { opportunityId: String(values.opportunityId ?? "") };
    else if (intent === "update_saved") {
      if (!(String(values.status) in STATUS_LABELS))
        throw new FormError({ status: "Choose a saved opportunity status." });
      payload = {
        id: String(values.id ?? ""),
        status: values.status,
        notes: String(values.notes ?? ""),
      };
    }
    const result = await researchAction(db, request, {
      intent,
      ...(runId ? { runId } : {}),
      payload,
    });
    if (typeof result.runId === "string")
      return redirect(`/research/${encodeURIComponent(result.runId)}`);
    return data<ActionResult>({
      ok: true,
      intent,
      ...(typeof result.savedId === "string"
        ? { savedId: result.savedId }
        : {}),
    });
  } catch (error) {
    const status = error instanceof Response ? error.status : 400;
    const errors =
      error instanceof FormError
        ? error.fields
        : {
            form:
              error instanceof Response
                ? status === 403
                  ? "This submission could not be verified. Reload this page and try again."
                  : "This action requires a form submission."
                : error instanceof z.ZodError
                  ? "Some values were not accepted. Check the form and try again."
                  : error instanceof Error && errorCopy[error.message]
                    ? errorCopy[error.message]
                    : "The action could not finish. Your saved work is safe. Reload the current state and try again.",
          };
    return data<ActionResult>(
      { errors, values, intent: String(values.intent ?? "") },
      { status },
    );
  } finally {
    if (db && !database) db.close();
  }
}
