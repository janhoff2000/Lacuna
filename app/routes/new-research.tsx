import {
  Link,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type MetaFunction,
} from "react-router";
import { openDatabase } from "../../server/db";
import { readSettings } from "../../server/operations";
import { workspaceAction } from "../lib/actions.server";
import { obj } from "../lib/workspace";
import { PageHeader, WorkspaceError } from "../components/workspace";
import { NewResearchForm } from "../components/research-form";
export const meta: MetaFunction = () => [{ title: "New research · Lacuna" }];
export function loader() {
  const db = openDatabase();
  try {
    return { defaults: readSettings(db).defaults };
  } finally {
    db.close();
  }
}
export const action = ({ request }: ActionFunctionArgs) =>
  workspaceAction(request, ["create"]);
export default function NewResearch() {
  const { defaults } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <PageHeader
        title="New research"
        eyebrow="Research"
        description="Set a scope you can investigate, with a ceiling you control."
      >
        <Link to="/" className="button secondary">
          Back to Research
        </Link>
      </PageHeader>
      <div className="form-page">
        <NewResearchForm defaults={obj(defaults)} result={result} />
      </div>
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
