import { useSearchParams, type MetaFunction } from "react-router";
import { ReportWorkspace } from "../components/report";
import {
  EmptyState,
  Notice,
  PageHeader,
  ProgressPanel,
  RunBadge,
} from "../components/workspace";
import {
  SAMPLE_OPPORTUNITIES,
  SAMPLE_PROGRESS,
  SAMPLE_SOURCES,
} from "../lib/sample";
export const meta: MetaFunction = () => [
  { title: "Sample component reference · Lacuna" },
];
export function loader() {
  if (process.env.NODE_ENV === "production")
    throw new Response("Not found", { status: 404 });
  return null;
}
export default function Reference() {
  const [params] = useSearchParams();
  return (
    <>
      <PageHeader
        title="Component reference"
        eyebrow="Development only"
        description="Sample data and interface states. Nothing here is live research."
      />
      <div className="reference-banner">
        <Notice tone="neutral" title="Sample fixtures only">
          <p>
            This route uses no database mutations or AI calls. The report and
            counts below are examples for visual review.
          </p>
        </Notice>
      </div>
      <ReportWorkspace
        opportunities={SAMPLE_OPPORTUNITIES}
        sources={SAMPLE_SOURCES}
        base="/reference"
        selectedId={params.get("opportunity")}
        selectedSource={params.get("source")}
        complete={false}
        sample
      />
      <div className="reference-states">
        <h2>Sample product states</h2>
        <div className="reference-badges">
          {[
            { status: "queued", reason: null },
            { status: "running", reason: null },
            { status: "paused", reason: "app_review" },
            { status: "paused", reason: "budget" },
            { status: "completed", reason: null, coverage: "gaps" },
            { status: "cancelled", reason: "user" },
          ].map((run) => (
            <RunBadge
              key={`${run.status}:${run.reason}`}
              run={run}
              worker="not_running"
            />
          ))}
        </div>
        <Notice title="Sample · Preliminary">
          <p>
            Verification is still pending. Priority and confidence are not yet
            assessed.
          </p>
        </Notice>
        <Notice title="Sample · Partial evidence">
          <p>
            Two requested markets were unavailable. Conclusions cover only the
            captured sources.
          </p>
        </Notice>
        <Notice tone="error" title="Sample · Source could not be reached">
          <p>Check the app URL or try again when the store is available.</p>
        </Notice>
        <Notice tone="neutral" title="Sample · Loading">
          <p role="status">Reading the last saved checkpoint…</p>
        </Notice>
        <ProgressPanel progress={SAMPLE_PROGRESS} ceiling={1} readOnly />
        <ProgressPanel
          progress={{
            ...SAMPLE_PROGRESS,
            reason: "budget",
            budget: { ...SAMPLE_PROGRESS.budget, unknown: true },
          }}
          ceiling={1}
          readOnly
        />
        <EmptyState compact title="Sample · No opportunities yet">
          <p>
            A narrower need or additional apps may provide more relevant
            evidence.
          </p>
        </EmptyState>
      </div>
    </>
  );
}
