import {
  Link,
  useLoaderData,
  useRevalidator,
  type MetaFunction,
} from "react-router";
import { useEffect } from "react";
import { openDatabase } from "../../server/db";
import { listResearch } from "../../server/operations";
import { workerStatus } from "../../server/runs";
import {
  EmptyState,
  PageHeader,
  RunBadge,
  WorkerNotice,
  WorkspaceError,
} from "../components/workspace";
import { date, isActive, money, strings, title } from "../lib/workspace";
export const meta: MetaFunction = () => [{ title: "Research · Lacuna" }];
export function loader() {
  const db = openDatabase();
  try {
    return { runs: listResearch(db), worker: workerStatus(db) };
  } finally {
    db.close();
  }
}
export default function ResearchIndex() {
  const { runs, worker } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const active = runs.some((run) => isActive(run.status));
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        void revalidator.revalidate();
    }, 5000);
    return () => clearInterval(interval);
  }, [active, revalidator]);
  const groups = [
    { title: "In progress", runs: runs.filter((run) => isActive(run.status)) },
    {
      title: "Needs your attention",
      runs: runs.filter((run) => run.status === "paused"),
    },
    {
      title: "Previous research",
      runs: runs.filter((run) =>
        ["completed", "cancelled"].includes(run.status),
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="Research"
        description="Explore app needs. Question the evidence."
      >
        <Link className="button primary" to="/research/new">
          <span aria-hidden="true">+</span> New research
        </Link>
      </PageHeader>
      <div className="page-body">
        {active && <WorkerNotice worker={worker} />}
        {!runs.length ? (
          <EmptyState
            title="Start with a question"
            action={
              <Link className="button primary" to="/research/new">
                Start your first research
              </Link>
            }
          >
            <p>
              Research a topic or category, or explore for a promising niche.
              <br />
              Lacuna gathers reviews and links each finding to its evidence.
            </p>
            <p className="metadata">
              Choose the stores, countries, and spending ceiling before you
              begin.
            </p>
          </EmptyState>
        ) : (
          groups
            .filter((group) => group.runs.length)
            .map((group) => (
              <section className="run-group" key={group.title}>
                <div className="section-heading">
                  <h2>{group.title}</h2>
                  <span className="metadata">{group.runs.length}</span>
                </div>
                <div className="run-list">
                  {group.runs.map((run) => (
                    <Link
                      className="run-row"
                      key={run.id}
                      to={`/research/${run.id}`}
                    >
                      <div className="run-row-main">
                        <h3>{title(run.input)}</h3>
                        <p className="metadata">
                          {date(run.created_at)} ·{" "}
                          {strings(run.settings.countries).join(", ")} ·{" "}
                          {run.settings.preset === "deep" ? "Deep" : "Quick"}
                        </p>
                      </div>
                      <RunBadge run={run} worker={worker} />
                      <span className="run-spend">
                        {money(run.budget.committedUsd)}
                        <small>of {money(run.budget_usd)} ceiling</small>
                      </span>
                      <span className="row-next">
                        {run.reason === "app_review"
                          ? "Review apps"
                          : run.status === "paused"
                            ? "Recover run"
                            : run.status === "completed"
                              ? "Open report"
                              : "View progress"}
                        <span aria-hidden="true"> →</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            ))
        )}
      </div>
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
