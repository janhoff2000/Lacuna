import appleStore from "app-store-scraper";
import googlePlay from "google-play-scraper";
import { mkdir } from "node:fs/promises";

import {
  summarizeReviewEvidence,
  type TrialPage,
  type TrialReviewObservation,
} from "../server/collectors/trial-summary";

/**
 * This is an intentionally small validation run, not a production collector.
 * It makes at most 32 store requests: 2 searches, 6 details, and 24 review
 * pages. It does not import or call OpenAI code.
 */
const TRIAL_LIMITS = {
  searchResultsPerStore: 3,
  appsPerStore: 3,
  reviewPagesPerStream: 2,
  reviewItemsPerGooglePage: 20,
  maximumRequests: 32,
} as const;

const APPLE_STREAMS = [
  { country: "us", stream: "country:us" },
  { country: "de", stream: "country:de" },
] as const;
const GOOGLE_STREAMS = [
  { country: "us", lang: "en", stream: "country:us|lang:en" },
  { country: "de", lang: "de", stream: "country:de|lang:de" },
] as const;

type RecordLike = Record<string, unknown>;
type StoreClient = {
  search: (options: RecordLike) => Promise<RecordLike[]>;
  app: (options: RecordLike) => Promise<RecordLike>;
  reviews: (options: RecordLike) => Promise<unknown>;
  sort: RecordLike;
};

const apple = appleStore as StoreClient;
const google = googlePlay as unknown as StoreClient;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function reviewDate(review: RecordLike): string | null {
  const value = review.updated ?? review.date;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : null;
}

function reviewId(review: RecordLike): string | null {
  const value = review.id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function appStoreId(app: RecordLike): string | null {
  const value = app.id;
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function googlePlayId(app: RecordLike): string | null {
  const value = app.appId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function reviewsFrom(value: unknown): RecordLike[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (isRecord(value) && Array.isArray(value.data)) return value.data.filter(isRecord);
  return [];
}

function nextPageToken(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.nextPaginationToken === "string"
    ? value.nextPaginationToken
    : undefined;
}

function writeJson(path: string, value: unknown) {
  return Bun.write(path, `${JSON.stringify(value, null, 2)}\n`);
}

const rawEvidence: {
  startedAt: string;
  limits: typeof TRIAL_LIMITS;
  calls: Array<RecordLike>;
} = {
  startedAt: new Date().toISOString(),
  limits: TRIAL_LIMITS,
  calls: [],
};

async function capture<T>(
  name: string,
  request: RecordLike,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  try {
    const response = await operation();
    rawEvidence.calls.push({ name, request, outcome: "returned", response });
    return response;
  } catch (error) {
    rawEvidence.calls.push({
      name,
      request,
      outcome: "error",
      error: stringifyError(error),
    });
    return undefined;
  }
}

async function collectAppleReviews(appId: string) {
  const observations: TrialReviewObservation[] = [];
  const pages: TrialPage[] = [];

  for (const locale of APPLE_STREAMS) {
    for (let page = 1; page <= TRIAL_LIMITS.reviewPagesPerStream; page += 1) {
      const request = {
        id: appId,
        country: locale.country,
        page,
        sort: apple.sort.RECENT,
      };
      const response = await capture("apple.reviews", request, () => apple.reviews(request));
      if (!response) {
        pages.push({
          store: "apple",
          appId,
          stream: locale.stream,
          page,
          requestAttempted: true,
          outcome: "error",
          returnedReviewCount: 0,
          nextPageAvailable: null,
          paginationEvidence: "request-error",
          error: String(rawEvidence.calls.at(-1)?.error ?? "Unknown error"),
        });
        continue;
      }
      const reviews = reviewsFrom(response);
      pages.push({
        store: "apple",
        appId,
        stream: locale.stream,
        page,
        requestAttempted: true,
        outcome: reviews.length === 0 ? "empty" : "returned",
        returnedReviewCount: reviews.length,
        // Apple exposes page-number requests but no response cursor/token. A
        // successful page must not be treated as evidence that another exists.
        nextPageAvailable: null,
        paginationEvidence: "page-number-request-only",
      });
      observations.push(
        ...reviews.map((review) => ({
          store: "apple" as const,
          appId,
          stream: locale.stream,
          page,
          reviewId: reviewId(review),
          date: reviewDate(review),
        })),
      );
    }
  }
  return { observations, pages };
}

async function collectGoogleReviews(appId: string) {
  const observations: TrialReviewObservation[] = [];
  const pages: TrialPage[] = [];

  for (const locale of GOOGLE_STREAMS) {
    let token: string | undefined;
    for (let page = 1; page <= TRIAL_LIMITS.reviewPagesPerStream; page += 1) {
      if (page > 1 && !token) {
        pages.push({
          store: "google",
          appId,
          stream: locale.stream,
          page,
          requestAttempted: false,
          outcome: "skipped",
          returnedReviewCount: 0,
          nextPageAvailable: null,
          paginationEvidence: "not-requested",
          error: "The preceding page did not provide a pagination token.",
        });
        break;
      }
      const request = {
        appId,
        country: locale.country,
        lang: locale.lang,
        num: TRIAL_LIMITS.reviewItemsPerGooglePage,
        paginate: true,
        sort: google.sort.NEWEST,
        ...(token ? { nextPaginationToken: token } : {}),
      };
      const response = await capture("google.reviews", request, () => google.reviews(request));
      if (!response) {
        pages.push({
          store: "google",
          appId,
          stream: locale.stream,
          page,
          requestAttempted: true,
          outcome: "error",
          returnedReviewCount: 0,
          nextPageAvailable: null,
          paginationEvidence: "request-error",
          error: String(rawEvidence.calls.at(-1)?.error ?? "Unknown error"),
        });
        break;
      }
      const reviews = reviewsFrom(response);
      token = nextPageToken(response);
      pages.push({
        store: "google",
        appId,
        stream: locale.stream,
        page,
        requestAttempted: true,
        outcome: reviews.length === 0 ? "empty" : "returned",
        returnedReviewCount: reviews.length,
        nextPageAvailable: Boolean(token),
        paginationEvidence: "response-next-page-token",
      });
      observations.push(
        ...reviews.map((review) => ({
          store: "google" as const,
          appId,
          stream: locale.stream,
          page,
          reviewId: reviewId(review),
          date: reviewDate(review),
        })),
      );
    }
  }
  return { observations, pages };
}

async function main() {
  const appleSearch = await capture(
    "apple.search",
    { term: "meditation", country: "us", num: TRIAL_LIMITS.searchResultsPerStore },
    () => apple.search({ term: "meditation", country: "us", num: TRIAL_LIMITS.searchResultsPerStore }),
  );
  const googleSearch = await capture(
    "google.search",
    { term: "meditation", country: "us", lang: "en", num: TRIAL_LIMITS.searchResultsPerStore },
    () => google.search({ term: "meditation", country: "us", lang: "en", num: TRIAL_LIMITS.searchResultsPerStore }),
  );

  const appleIds = ["571800810", ...(appleSearch ?? []).map(appStoreId)]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, TRIAL_LIMITS.appsPerStore);
  const googleIds = ["com.calm.android", ...(googleSearch ?? []).map(googlePlayId)]
    .filter((id): id is string => Boolean(id))
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, TRIAL_LIMITS.appsPerStore);

  for (const id of appleIds) {
    await capture("apple.app", { id, country: "us" }, () => apple.app({ id, country: "us" }));
  }
  for (const appId of googleIds) {
    await capture("google.app", { appId, country: "us", lang: "en" }, () =>
      google.app({ appId, country: "us", lang: "en" }),
    );
  }

  const appleEvidence = [];
  for (const appId of appleIds) appleEvidence.push(await collectAppleReviews(appId));
  const googleEvidence = [];
  for (const appId of googleIds) googleEvidence.push(await collectGoogleReviews(appId));
  const observations = [...appleEvidence, ...googleEvidence].flatMap(
    (evidence) => evidence.observations,
  );
  const pages = [...appleEvidence, ...googleEvidence].flatMap(
    (evidence) => evidence.pages,
  );
  const runDirectory = `data/trials/${rawEvidence.startedAt.replaceAll(/[:.]/g, "-")}`;
  await mkdir(runDirectory, { recursive: true });
  await writeJson(`${runDirectory}/raw.json`, rawEvidence);

  const summary = {
    completedAt: new Date().toISOString(),
    status: rawEvidence.calls.some((call) => call.outcome === "error")
      ? "completed-with-errors"
      : "completed",
    limits: TRIAL_LIMITS,
    selectedApps: { apple: appleIds, google: googleIds },
    calls: {
      total: rawEvidence.calls.length,
      errors: rawEvidence.calls
        .filter((call) => call.outcome === "error")
        .map(({ name, error }) => ({ name, error })),
    },
    evidence: summarizeReviewEvidence(observations, pages),
  };
  await writeJson(`${runDirectory}/summary.json`, summary);
  console.info(
    JSON.stringify(
      {
        status: summary.status,
        output: `${runDirectory}/summary.json`,
        selectedApps: summary.selectedApps,
        calls: summary.calls,
        evidence: {
          uniqueReviewCount: summary.evidence.reviewIds.uniqueCount,
          duplicateOccurrences: summary.evidence.reviewIds.duplicateOccurrences,
          dates: summary.evidence.dates,
          localeYield: summary.evidence.localeYield,
          pagination: summary.evidence.pagination,
        },
      },
      null,
      2,
    ),
  );
}

await main();
