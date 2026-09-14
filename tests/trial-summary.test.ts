import { describe, expect, test } from "bun:test";

import {
  reviewIdentity,
  summarizeReviewEvidence,
  type TrialPage,
  type TrialReviewObservation,
} from "../server/collectors/trial-summary";

describe("reviewIdentity", () => {
  test("uses store, app ID, and scraper review ID", () => {
    expect(
      reviewIdentity({ store: "apple", appId: "123", reviewId: "review-1" }),
    ).toBe("apple:123:review-1");
    expect(
      reviewIdentity({ store: "google", appId: "123", reviewId: "review-1" }),
    ).toBe("google:123:review-1");
    expect(reviewIdentity({ store: "apple", appId: "123", reviewId: null })).toBeNull();
  });
});

describe("summarizeReviewEvidence", () => {
  test("records cross-locale overlap without double-counting a review", () => {
    const observations: TrialReviewObservation[] = [
      {
        store: "apple",
        appId: "123",
        stream: "country:us",
        page: 1,
        reviewId: "same-review",
        date: "2026-09-01T00:00:00.000Z",
      },
      {
        store: "apple",
        appId: "123",
        stream: "country:de",
        page: 1,
        reviewId: "same-review",
        date: "2026-09-01T00:00:00.000Z",
      },
      {
        store: "apple",
        appId: "123",
        stream: "country:de",
        page: 1,
        reviewId: "de-only",
        date: "not-a-date",
      },
      {
        store: "apple",
        appId: "123",
        stream: "country:de",
        page: 2,
        reviewId: null,
        date: null,
      },
    ];
    const pages: TrialPage[] = [
      {
        store: "apple",
        appId: "123",
        stream: "country:us",
        page: 1,
        requestAttempted: true,
        outcome: "returned",
        returnedReviewCount: 1,
        nextPageAvailable: true,
        paginationEvidence: "response-next-page-token",
      },
      {
        store: "apple",
        appId: "123",
        stream: "country:de",
        page: 2,
        requestAttempted: true,
        outcome: "error",
        returnedReviewCount: 0,
        nextPageAvailable: null,
        paginationEvidence: "request-error",
        error: "rate limited",
      },
    ];

    const summary = summarizeReviewEvidence(observations, pages);

    expect(summary.reviewIds.uniqueCount).toBe(2);
    expect(summary.reviewIds.duplicateOccurrences).toBe(1);
    expect(summary.reviewIds.missingCount).toBe(1);
    expect(summary.localeYield["country:us"].incrementalUnique).toBe(1);
    expect(summary.localeYield["country:de"].incrementalUnique).toBe(1);
    expect(summary.localeYield["country:de"].duplicateOccurrences).toBe(1);
    expect(summary.dates.earliest).toBe("2026-09-01T00:00:00.000Z");
    expect(summary.dates.invalidCount).toBe(1);
    expect(summary.pagination.errorPages).toBe(1);
    expect(summary.pagination.errors[0]?.error).toBe("rate limited");
  });

  test("does not infer Apple exhaustion or count an unrequested Google page", () => {
    const pages: TrialPage[] = [
      {
        store: "apple",
        appId: "123",
        stream: "country:us",
        page: 1,
        requestAttempted: true,
        outcome: "returned",
        returnedReviewCount: 50,
        nextPageAvailable: null,
        paginationEvidence: "page-number-request-only",
      },
      {
        store: "google",
        appId: "com.example.app",
        stream: "country:us|lang:en",
        page: 2,
        requestAttempted: false,
        outcome: "skipped",
        returnedReviewCount: 0,
        nextPageAvailable: null,
        paginationEvidence: "not-requested",
      },
    ];

    const summary = summarizeReviewEvidence([], pages);

    expect(summary.pagination.pagesAttempted).toBe(1);
    expect(summary.pagination.skippedPages).toBe(1);
    expect(summary.pagination.pagesWithObservedNextPageToken).toBe(0);
    expect(summary.pagination.pageNumberRequestOnlyResponses).toBe(1);
  });

  test("counts an attempted empty Apple response as page-number-only evidence", () => {
    const summary = summarizeReviewEvidence([], [
      {
        store: "apple",
        appId: "123",
        stream: "country:us",
        page: 2,
        requestAttempted: true,
        outcome: "empty",
        returnedReviewCount: 0,
        nextPageAvailable: null,
        paginationEvidence: "page-number-request-only",
      },
    ]);

    expect(summary.pagination.pagesAttempted).toBe(1);
    expect(summary.pagination.pagesReturned).toBe(0);
    expect(summary.pagination.emptyPages).toBe(1);
    expect(summary.pagination.pageNumberRequestOnlyResponses).toBe(1);
  });

  test("counts an attempted empty Google response with a next-page token", () => {
    const summary = summarizeReviewEvidence([], [
      {
        store: "google",
        appId: "com.example.app",
        stream: "country:us|lang:en",
        page: 2,
        requestAttempted: true,
        outcome: "empty",
        returnedReviewCount: 0,
        nextPageAvailable: true,
        paginationEvidence: "response-next-page-token",
      },
    ]);

    expect(summary.pagination.pagesAttempted).toBe(1);
    expect(summary.pagination.pagesReturned).toBe(0);
    expect(summary.pagination.emptyPages).toBe(1);
    expect(summary.pagination.pagesWithObservedNextPageToken).toBe(1);
  });
});
