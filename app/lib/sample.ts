import type { JsonObject } from "../../shared/types";
import type { SourceView } from "../components/report";
import type { ProgressView } from "../components/workspace";

// Development examples only. Never inserted into the workspace database.
const captured = Date.UTC(2026, 8, 10);
function source(
  id: string,
  kind: string,
  appId: string,
  payload: JsonObject,
): SourceView {
  return {
    id,
    kind,
    app_id: appId,
    store: "google",
    review_id: kind === "review" ? `sample-review-${id}` : null,
    url: "",
    payload_json: JSON.stringify(payload),
    payload,
    captured_at: captured,
  };
}
export const SAMPLE_SOURCES: SourceView[] = [
  source("sample-listing-1", "listing", "sample.mealplanner", {
    title: "Sample · Pantry Notes: Meal Planning and Family Grocery Lists",
    country: "DE",
    description:
      "Sample listing: shared lists work online. Offline synchronization is not documented.",
  }),
  source("sample-review-1", "review", "sample.mealplanner", {
    text: "Im Supermarkt habe ich oft keinen Empfang. Ich möchte meine Einkaufsliste trotzdem ändern können und die Änderungen später mit meiner Familie teilen. Die Zutaten sind gut sortiert, aber sobald ich zwischen den Regalen den Empfang verliere, kann ich nicht mehr sehen, welche Lebensmittel mein Partner schon gekauft hat. Für unseren Alltag wäre es hilfreich, wenn die Liste auf beiden Geräten auch ohne Verbindung lesbar und bearbeitbar bliebe.",
    rating: 2,
    date: "2026-08-21",
    language: "de",
    directReviewUrl: false,
  }),
  source("sample-review-2", "review", "sample.mealplanner", {
    text: "買い物中に電波が弱くなるとリストが開けません。家族と一緒に使うので、オフラインでもチェックできると助かります。",
    rating: 3,
    date: "2026-08-29",
    language: "ja",
    directReviewUrl: false,
  }),
  source("sample-counter-1", "review", "sample.mealplanner", {
    text: "The shared list updates quickly for our household. We have not had trouble checking off groceries in our local store.",
    rating: 5,
    date: "2026-09-02",
    directReviewUrl: false,
  }),
];
export const SAMPLE_OPPORTUNITIES: Array<JsonObject & { id: string }> = [
  {
    id: "sample-offline",
    key: "sample-offline",
    title: "Keep shared grocery lists useful offline",
    need: "Households report losing access to shared grocery lists when store reception is weak. They want to keep checking items and sync changes once a connection returns.",
    audience: "Households coordinating grocery shopping",
    audienceInferred: false,
    perspective: "poor_execution",
    direction: null,
    priority: 2,
    confidence: "low",
    status: "Partially verified",
    impact: "moderate",
    sourceIds: ["sample-review-1", "sample-review-2"],
    counterSourceIds: ["sample-counter-1"],
    priorityReasons: [
      "2 sample supporting source reviews",
      "1 sample product and developer",
      "Reported impact: moderate",
      "Offline capability not verified",
    ],
    counts: {
      supportingReviews: 2,
      products: 1,
      developers: 1,
      recentReviews: 2,
    },
    denominator: 8,
    sampleCounts: { collected: 12, selected: 10, analyzed: 8 },
    sampleStatement:
      "Sample counts for component review only. No live research was performed.",
    uncertainty: [
      "The sample is small and covers one product.",
      "Positive feedback describes reliable synchronization in other conditions.",
      "An absence of documentation does not establish an absence of offline support.",
    ],
    evidence: [
      {
        sourceId: "sample-review-1",
        excerpt:
          "Im Supermarkt habe ich oft keinen Empfang. Ich möchte meine Einkaufsliste trotzdem ändern können und die Änderungen später mit meiner Familie teilen.",
        translation: {
          label: "Translation",
          language: "en",
          text: "I often have no reception in the supermarket. I still want to edit my shopping list and share the changes with my family later.",
        },
        sentiment: "negative",
        uncertainty: [],
      },
      {
        sourceId: "sample-review-2",
        excerpt:
          "買い物中に電波が弱くなるとリストが開けません。家族と一緒に使うので、オフラインでもチェックできると助かります。",
        translation: {
          label: "Translation",
          language: "en",
          text: "When reception is weak while shopping, the list will not open. We use it as a family, so being able to check items offline would help.",
        },
        sentiment: "mixed",
        uncertainty: [],
      },
    ],
    verification: {
      outcome: "uncertain",
      explanation:
        "The sample listing documents shared lists but does not establish offline behavior. The positive review is counterevidence about reliability under different conditions.",
      citations: [
        {
          sourceId: "sample-listing-1",
          excerpt:
            "Sample listing: shared lists work online. Offline synchronization is not documented.",
        },
      ],
      pricing: [],
      feasibility: "not_applicable",
    },
    counterparts: [],
  },
  {
    id: "sample-allergies",
    key: "sample-allergies",
    title: "Make ingredient substitutions visible to everyone",
    need: "A sample audience needs to see which ingredients have changed when someone adapts a shared meal plan.",
    audience: "Families managing different dietary requirements",
    audienceInferred: true,
    perspective: "underserved_audience",
    direction: null,
    priority: 3,
    confidence: "low",
    status: "Preliminary",
    sourceIds: [],
    counterSourceIds: [],
    uncertainty: [
      "Sample opportunity for layout inspection. No linked live evidence.",
    ],
    counts: {
      supportingReviews: 0,
      products: 0,
      developers: 0,
      recentReviews: 0,
    },
    denominator: 0,
  },
  {
    id: "sample-cross-platform",
    key: "sample-cross-platform",
    title: "Investigate a comparable iOS planning workflow",
    need: "Sample cross-platform research checks whether a useful Android workflow has a suitable iOS counterpart or alternative.",
    audience: "People moving from Android to iOS",
    audienceInferred: true,
    perspective: "cross_platform",
    direction: "android_to_ios",
    priority: 3,
    confidence: "low",
    status: "Partially verified",
    sourceIds: [],
    counterSourceIds: [],
    uncertainty: [
      "Platform feasibility is not verified.",
      "A missing name match does not establish a market gap.",
    ],
    counts: {
      supportingReviews: 0,
      products: 0,
      developers: 0,
      recentReviews: 0,
    },
    denominator: 0,
  },
];
export const SAMPLE_PROGRESS: ProgressView = {
  id: "sample-run",
  status: "paused",
  reason: "interrupted",
  stage: "analysis",
  coverage: "gaps",
  counts: { collected: 12, selected: 10, analyzed: 8 },
  budget: {
    committedUsd: 0.18,
    remainingUsd: 0.82,
    unknown: false,
    knownChargeUsd: 0,
  },
  worker: "not_running",
};
