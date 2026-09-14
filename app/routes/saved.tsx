import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type MetaFunction,
} from "react-router";
import { openDatabase } from "../../server/db";
import { listSaved } from "../../server/operations";
import { workspaceAction } from "../lib/actions.server";
import { STATUS_LABELS, opportunityUrl, str } from "../lib/workspace";
import {
  ActionFeedback,
  EmptyState,
  FieldError,
  PageHeader,
  Submit,
  WorkspaceError,
  fieldA11y,
} from "../components/workspace";

export const meta: MetaFunction = () => [
  { title: "Saved opportunities · Lacuna" },
];
export function loader() {
  const db = openDatabase();
  try {
    return { saved: listSaved(db) };
  } finally {
    db.close();
  }
}
export const action = ({ request }: ActionFunctionArgs) =>
  workspaceAction(request, ["update_saved"]);
export default function Saved() {
  const { saved } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [params, setParams] = useSearchParams();
  const filter = params.get("status") ?? "all";
  const rows = saved.filter((row) => filter === "all" || row.status === filter);
  return (
    <>
      <PageHeader
        title="Saved opportunities"
        description="Your judgment, notes, and next investigations."
      />
      <div className="page-body">
        <ActionFeedback result={result} />
        <div className="saved-toolbar">
          <label htmlFor="status-filter">
            Filter by status
            <select
              id="status-filter"
              value={filter}
              onChange={(event) =>
                setParams(
                  event.target.value === "all"
                    ? {}
                    : { status: event.target.value },
                )
              }
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <span className="metadata">
            {rows.length} {rows.length === 1 ? "opportunity" : "opportunities"}
          </span>
        </div>
        {rows.length ? (
          rows.map((row) => {
            const ownResult =
              result?.values?.id === row.id ? result : undefined;
            return (
              <article key={row.id} className="saved-row">
                <div className="section-heading">
                  <div>
                    <h2>{row.title}</h2>
                    <p className="muted">{str(row.report.need)}</p>
                  </div>
                  <Link
                    to={opportunityUrl(
                      `/research/${row.run_id}`,
                      row.opportunity_id,
                    )}
                  >
                    Open source report →
                  </Link>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="update_saved" />
                  <input type="hidden" name="id" value={row.id} />
                  <label htmlFor={`status-${row.id}`}>
                    Your status
                    <select
                      id={`status-${row.id}`}
                      name="status"
                      defaultValue={
                        typeof ownResult?.values?.status === "string"
                          ? ownResult.values.status
                          : row.status
                      }
                      {...fieldA11y("status", ownResult)}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <FieldError name="status" result={ownResult} />
                  <label htmlFor={`notes-${row.id}`}>
                    Investigation notes
                    <textarea
                      id={`notes-${row.id}`}
                      name="notes"
                      rows={4}
                      maxLength={20000}
                      defaultValue={
                        typeof ownResult?.values?.notes === "string"
                          ? ownResult.values.notes
                          : row.notes
                      }
                      placeholder="What would you validate next?"
                    />
                  </label>
                  <div className="notes-footer">
                    <p className="field-hint">
                      Refreshes never replace these notes or change your status.
                    </p>
                    <Submit secondary>Save notes and status</Submit>
                  </div>
                </Form>
              </article>
            );
          })
        ) : (
          <EmptyState
            title={
              saved.length
                ? "No opportunities with this status"
                : "Keep promising questions close"
            }
            action={
              <Link className="button secondary" to="/">
                Explore research
              </Link>
            }
          >
            <p>
              {saved.length
                ? "Choose another status to see your saved opportunities."
                : "Save an opportunity from a completed report, then add notes and track your investigation here."}
            </p>
          </EmptyState>
        )}
      </div>
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
