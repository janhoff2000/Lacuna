import { useEffect, useRef, useState } from "react";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useRevalidator,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { openDatabase } from "../../server/db";
import {
  readResearch,
  readSettings,
  researchProgress,
} from "../../server/operations";
import { workspaceAction } from "../lib/actions.server";
import {
  date,
  isActive,
  num,
  objects,
  runLabel,
  safeUrl,
  stageLabel,
  storeLabel,
  str,
  title,
} from "../lib/workspace";
import {
  ActionFeedback,
  EmptyState,
  FieldError,
  Notice,
  PageHeader,
  ProgressPanel,
  Submit,
  WorkspaceError,
  fieldA11y,
  type ProgressView,
} from "../components/workspace";
import { CoverageDetails, ReportWorkspace } from "../components/report";
import { startProgressPolling } from "../lib/progress";

export const meta: MetaFunction = () => [{ title: "Research report · Lacuna" }];
export function loader({ params }: LoaderFunctionArgs) {
  const db = openDatabase();
  try {
    if (!params.runId) throw new Response("Not found", { status: 404 });
    return {
      view: readResearch(db, params.runId),
      progress: researchProgress(db, params.runId),
      configured: readSettings(db).configured,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Unknown run")
      throw new Response("Not found", { status: 404 });
    throw error;
  } finally {
    db.close();
  }
}
export const action = ({ request, params }: ActionFunctionArgs) =>
  workspaceAction(
    request,
    [
      "pause",
      "cancel",
      "resume",
      "continue",
      "raise_budget",
      "remove_candidate",
      "add_candidate",
      "save",
      "refresh",
    ],
    params.runId,
  );
export default function ResearchRun() {
  const loaded = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [params] = useSearchParams();
  const revalidator = useRevalidator();
  const [progress, setProgress] = useState<ProgressView>(loaded.progress);
  const [pollError, setPollError] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const version = useRef(
    `${loaded.progress.status}:${loaded.progress.reason}:${loaded.progress.stage}`,
  );
  useEffect(() => {
    setProgress(loaded.progress);
    version.current = `${loaded.progress.status}:${loaded.progress.reason}:${loaded.progress.stage}`;
  }, [loaded.progress]);
  const active = isActive(progress.status);
  useEffect(() => {
    if (!active) return;
    return startProgressPolling(`/research/${loaded.view.run.id}/progress`, {
      onProgress: (next) => {
        setProgress(next);
        setPollError(false);
        const key = `${next.status}:${next.reason}:${next.stage}`;
        if (key !== version.current) {
          version.current = key;
          setAnnouncement(
            `${runLabel(next, next.worker)}. ${stageLabel(next.stage)}.`,
          );
          void revalidator.revalidate();
        }
      },
      onError: () => setPollError(true),
    });
  }, [active, loaded.view.run.id, revalidator]);
  const { view } = loaded;
  const review =
    progress.status === "paused" && progress.reason === "app_review";
  const preliminary = view.tasks
    .filter((task) => task.stage === "grouping")
    .flatMap((task) =>
      objects(task.result?.opportunities ?? task.checkpoint.opportunities),
    )
    .map((item, index) => ({
      ...item,
      id: `preliminary-${str(item.key, String(index))}`,
      status: "Preliminary",
    }));
  const opportunities = view.opportunities.length
    ? view.opportunities
    : preliminary;
  return (
    <>
      <PageHeader
        title={title(view.run.input)}
        eyebrow={`Research · ${date(view.run.created_at)}`}
      >
        <Link className="button secondary" to="/">
          All research
        </Link>
      </PageHeader>
      <div className="run-top">
        <ActionFeedback result={result} />
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>
        {pollError && (
          <Notice title="Progress updates are unavailable">
            <p>
              The last known state remains below.{" "}
              <button
                className="text-button"
                onClick={() => {
                  void revalidator.revalidate();
                }}
              >
                Reload progress
              </button>{" "}
              or wait for the connection to recover.
            </p>
          </Notice>
        )}
        <details
          className="progress-disclosure"
          open={!opportunities.length || progress.status !== "completed"}
        >
          <summary>Progress and run controls</summary>
          <ProgressPanel
            progress={progress}
            ceiling={view.run.budget_usd}
            configured={loaded.configured}
            result={result}
          />
        </details>
        <CoverageDetails view={view} />
        {review && (
          <section className="candidate-review">
            <div className="section-heading">
              <div>
                <h2>Review selected apps</h2>
                <p className="muted">
                  {view.selected.length} of {num(view.run.settings.appLimit)}{" "}
                  app listings selected. Remove unrelated apps or add a specific
                  app before continuing.
                </p>
              </div>
              <Form method="post">
                <Submit name="intent" value="continue">
                  Continue with these apps
                </Submit>
              </Form>
            </div>
            {view.selected.length ? (
              view.selected.map((candidate) => {
                const listing = view.candidates.find(
                  (item) =>
                    item.store === candidate.store &&
                    item.appId === candidate.appId,
                )?.listing;
                const url = safeUrl(str(listing?.url));
                return (
                  <div
                    className="candidate-row"
                    key={`${candidate.store}:${candidate.appId}`}
                  >
                    <div>
                      <h3>{candidate.title}</h3>
                      <p className="metadata">
                        {storeLabel(candidate.store)} · {candidate.country} ·{" "}
                        {candidate.appId}
                      </p>
                      <p>{candidate.reason}</p>
                      <p className="metadata">
                        Selection origin:{" "}
                        {candidate.origins.join(" · ") || candidate.intent}
                      </p>
                      {url && (
                        <a href={url} target="_blank" rel="noreferrer">
                          Open app listing
                        </a>
                      )}
                    </div>
                    <Form method="post">
                      <input
                        type="hidden"
                        name="store"
                        value={candidate.store}
                      />
                      <input
                        type="hidden"
                        name="appId"
                        value={candidate.appId}
                      />
                      <Submit secondary name="intent" value="remove_candidate">
                        Remove
                        <span className="sr-only"> {candidate.title}</span>
                      </Submit>
                    </Form>
                  </div>
                );
              })
            ) : (
              <Notice title="No apps selected">
                <p>
                  Add an app URL or continue to complete this run without review
                  evidence.
                </p>
              </Notice>
            )}
            <Form
              method="post"
              className="inline-form candidate-add"
              noValidate
            >
              <label htmlFor="url">
                Add an app store URL
                <input
                  id="url"
                  name="url"
                  type="url"
                  defaultValue={
                    typeof result?.values?.url === "string"
                      ? result.values.url
                      : ""
                  }
                  {...fieldA11y("url", result)}
                  placeholder="https://apps.apple.com/…"
                />
              </label>
              <Submit
                secondary
                name="intent"
                value="add_candidate"
                disabled={
                  view.selected.length >= num(view.run.settings.appLimit)
                }
              >
                Add app
              </Submit>
              <FieldError name="url" result={result} />
            </Form>
            {view.selected.length >= num(view.run.settings.appLimit) && (
              <p className="field-hint">
                Your listing maximum is reached. Remove an app to make room.
              </p>
            )}
          </section>
        )}
        {preliminary.length > 0 && !view.opportunities.length && (
          <Notice title="Preliminary opportunities">
            <p>
              These findings are still being verified. Their priority,
              confidence, and final support counts are not yet assessed.
            </p>
          </Notice>
        )}
      </div>
      {opportunities.length ? (
        <ReportWorkspace
          opportunities={opportunities}
          sources={view.sources}
          base={`/research/${view.run.id}`}
          selectedId={params.get("opportunity")}
          selectedSource={params.get("source")}
          complete={progress.status === "completed"}
        />
      ) : (
        !review && (
          <EmptyState
            title={
              progress.status === "completed"
                ? "No source-backed opportunities established"
                : progress.status === "cancelled"
                  ? "Research cancelled"
                  : "Evidence is taking shape"
            }
            action={
              progress.status === "completed" ? (
                <Link className="button secondary" to="/research/new">
                  Adjust scope in new research
                </Link>
              ) : undefined
            }
          >
            <p>
              {progress.status === "completed"
                ? "Review the coverage and selected apps above. Try a more specific need, different markets, or additional apps."
                : progress.status === "cancelled"
                  ? "Collected work is preserved. Refresh above to start another run with this scope."
                  : "Opportunities will appear after review evidence has been analyzed. You can leave this page and return later."}
            </p>
          </EmptyState>
        )
      )}
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
