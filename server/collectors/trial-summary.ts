export type TrialStore = "apple" | "google";

export interface TrialReviewObservation {
  store: TrialStore;
  appId: string;
  stream: string;
  page: number;
  reviewId: string | null;
  date: string | null;
}

export interface TrialPage {
  store: TrialStore;
  appId: string;
  stream: string;
  page: number;
  /** Whether this record corresponds to a scraper request that was made. */
  requestAttempted: boolean;
  outcome: "returned" | "empty" | "error" | "skipped";
  returnedReviewCount: number;
  /** Null means the scraper response cannot establish pagination availability. */
  nextPageAvailable: boolean | null;
  paginationEvidence:
    | "response-next-page-token"
    | "page-number-request-only"
    | "not-requested"
    | "request-error";
  error?: string;
}

function parseDate(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function reviewIdentity(
  observation: Pick<TrialReviewObservation, "store" | "appId" | "reviewId">,
): string | null {
  if (!observation.reviewId) return null;
  return `${observation.store}:${observation.appId}:${observation.reviewId}`;
}

export function summarizeReviewEvidence(
  observations: TrialReviewObservation[],
  pages: TrialPage[],
) {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  const uniqueIds: string[] = [];
  const localeYields = new Map<
    string,
    { returned: number; incrementalUnique: number; duplicateOccurrences: number }
  >();
  const validDates: string[] = [];
  let missingIds = 0;
  let invalidDates = 0;

  for (const observation of observations) {
    const locale = localeYields.get(observation.stream) ?? {
      returned: 0,
      incrementalUnique: 0,
      duplicateOccurrences: 0,
    };
    locale.returned += 1;

    const identity = reviewIdentity(observation);
    if (!identity) {
      missingIds += 1;
    } else if (seen.has(identity)) {
      duplicateIds.add(identity);
      locale.duplicateOccurrences += 1;
    } else {
      seen.add(identity);
      uniqueIds.push(identity);
      locale.incrementalUnique += 1;
    }

    if (observation.date) {
      if (parseDate(observation.date) === null) invalidDates += 1;
      else validDates.push(observation.date);
    }
    localeYields.set(observation.stream, locale);
  }

  const sortedDates = validDates.sort(
    (left, right) => (parseDate(left) ?? 0) - (parseDate(right) ?? 0),
  );
  const returnedPages = pages.filter((page) => page.outcome === "returned");
  const erroredPages = pages.filter((page) => page.outcome === "error");
  const emptyPages = pages.filter((page) => page.outcome === "empty");
  const attemptedPages = pages.filter((page) => page.requestAttempted);
  const successfulAttemptedPages = attemptedPages.filter(
    (page) => page.outcome !== "error" && page.outcome !== "skipped",
  );

  return {
    reviewIds: {
      unique: uniqueIds,
      uniqueCount: uniqueIds.length,
      missingCount: missingIds,
      duplicateIds: [...duplicateIds],
      duplicateIdCount: duplicateIds.size,
      duplicateOccurrences: observations.length - missingIds - uniqueIds.length,
    },
    dates: {
      earliest: sortedDates[0] ?? null,
      latest: sortedDates.at(-1) ?? null,
      validCount: sortedDates.length,
      missingCount: observations.filter((observation) => !observation.date).length,
      invalidCount: invalidDates,
    },
    localeYield: Object.fromEntries(localeYields),
    pagination: {
      pagesAttempted: attemptedPages.length,
      pagesReturned: returnedPages.length,
      emptyPages: emptyPages.length,
      errorPages: erroredPages.length,
      skippedPages: pages.filter((page) => !page.requestAttempted).length,
      pagesWithObservedNextPageToken: successfulAttemptedPages.filter(
        (page) => page.nextPageAvailable === true,
      ).length,
      pageNumberRequestOnlyResponses: successfulAttemptedPages.filter(
        (page) => page.paginationEvidence === "page-number-request-only",
      ).length,
      errors: erroredPages.map((page) => ({
        appId: page.appId,
        stream: page.stream,
        page: page.page,
        error: page.error ?? "Unknown error",
      })),
    },
  };
}
