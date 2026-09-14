import {
  Form,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type MetaFunction,
} from "react-router";
import { openDatabase } from "../../server/db";
import { readSettings } from "../../server/operations";
import { workspaceAction } from "../lib/actions.server";
import { obj } from "../lib/workspace";
import {
  ActionFeedback,
  FieldError,
  Notice,
  PageHeader,
  Submit,
  WorkspaceError,
  fieldA11y,
} from "../components/workspace";
import { ResearchFields } from "../components/research-form";
export const meta: MetaFunction = () => [{ title: "Settings · Lacuna" }];
export function loader() {
  const db = openDatabase();
  try {
    const settings = readSettings(db);
    return {
      appearance: String(settings.appearance),
      defaults: obj(settings.defaults),
      model: String(settings.model),
      models: settings.models,
      configured: settings.configured,
      setup: settings.setup,
    };
  } finally {
    db.close();
  }
}
export const action = ({ request }: ActionFunctionArgs) =>
  workspaceAction(request, ["settings"]);
export default function Settings() {
  const settings = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <PageHeader
        title="Settings"
        description="Appearance, research defaults, and local configuration."
      />
      <div className="form-page">
        <Form method="post" className="research-form" noValidate>
          <input type="hidden" name="intent" value="settings" />
          <ActionFeedback result={result} />
          <section className="form-section">
            <h2>Appearance</h2>
            <label htmlFor="appearance">
              Theme
              <select
                id="appearance"
                name="appearance"
                defaultValue={
                  typeof result?.values?.appearance === "string"
                    ? result.values.appearance
                    : settings.appearance
                }
                {...fieldA11y("appearance", result)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <FieldError name="appearance" result={result} />
            <p className="field-hint">
              System follows your device. Your choice is applied when you save.
            </p>
          </section>
          <section className="form-section">
            <h2>AI analysis</h2>
            <label htmlFor="model">
              Model
              <select
                id="model"
                name="model"
                defaultValue={
                  typeof result?.values?.model === "string"
                    ? result.values.model
                    : settings.model
                }
                {...fieldA11y("model", result)}
              >
                {settings.models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <FieldError name="model" result={result} />
            <p className="field-hint">
              Used for new research runs. Each run keeps its original model and
              budget.
            </p>
            <Notice
              title={
                settings.configured
                  ? "OpenAI key configured"
                  : "OpenAI key not configured"
              }
              tone={settings.configured ? "success" : "attention"}
            >
              <p>
                {settings.configured
                  ? "A key is present in the web process environment. The worker must start with the same environment. No connection or billing check has been performed."
                  : "Discovery can find apps without an API key. AI analysis waits until the worker is configured."}
              </p>
            </Notice>
            <details className="setup-instructions">
              <summary>Local setup instructions</summary>
              <ol>
                <li>
                  Open the ignored <code>.env</code> file in the project folder.
                </li>
                <li>
                  Set <code>OPENAI_API_KEY</code> there using your own OpenAI
                  API key.
                </li>
                <li>
                  Restart the local app and worker so both read the
                  configuration.
                </li>
                <li>Return to the paused research and choose Resume.</li>
              </ol>
              <p className="field-hint">
                Keys stay in your local environment. This interface never reads
                out or stores a key value.
              </p>
            </details>
          </section>
          <ResearchFields
            key={result?.values ? JSON.stringify(result.values) : "defaults"}
            defaults={settings.defaults}
            result={result}
            settings
          />
          <div className="form-footer">
            <Submit>Save settings</Submit>
          </div>
        </Form>
      </div>
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
