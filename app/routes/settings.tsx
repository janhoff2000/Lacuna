import { useEffect, useRef } from "react";
import {
  useFetcher,
  useLoaderData,
  type ActionFunctionArgs,
  type MetaFunction,
} from "react-router";
import { openDatabase } from "../../server/db";
import { readSettings } from "../../server/operations";
import { workspaceAction } from "../lib/actions.server";
import { obj } from "../lib/workspace";
import {
  FieldError,
  Notice,
  PageHeader,
  SelectMenu,
  WorkspaceError,
  fieldA11y,
} from "../components/workspace";
import { LanguagePicker, ResearchFields } from "../components/research-form";
export const meta: MetaFunction = () => [{ title: "Settings · Lacuna" }];
export function loader() {
  const db = openDatabase();
  try {
    const settings = readSettings(db);
    return {
      appearance: String(settings.appearance),
      defaults: obj(settings.defaults),
      spokenLanguages: settings.spokenLanguages,
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
  const fetcher = useFetcher<typeof action>();
  const result = fetcher.data;
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const scheduleSave = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (form.current) fetcher.submit(form.current, { method: "post" });
    }, 250);
  };
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return (
    <>
      <PageHeader
        title="Settings"
        description="Appearance, research defaults, and local configuration."
      />
      <div className="form-page">
        <fetcher.Form
          ref={form}
          method="post"
          className="research-form settings-form"
          noValidate
          onChange={scheduleSave}
        >
          <input type="hidden" name="intent" value="settings" />
          <section className="form-section">
            <h2>Appearance</h2>
            <SelectMenu
              id="appearance"
              name="appearance"
              label="Theme"
              defaultValue={
                typeof result?.values?.appearance === "string"
                  ? result.values.appearance
                  : settings.appearance
              }
              options={[
                { value: "system", label: "System" },
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              onValueChange={(appearance) => {
                const systemPrefersDark = matchMedia(
                  "(prefers-color-scheme: dark)",
                ).matches;
                document.documentElement.dataset.theme =
                  appearance === "system"
                    ? systemPrefersDark
                      ? "dark"
                      : "light"
                    : appearance;
                scheduleSave();
              }}
              {...fieldA11y("appearance", result)}
            />
            <FieldError name="appearance" result={result} />
            <p className="field-hint">
              System follows your device. Changes apply immediately.
            </p>
          </section>
          <section className="form-section">
            <h2>Review translations</h2>
            <LanguagePicker
              id="spoken-languages"
              name="spokenLanguages"
              label="Languages you speak"
              initial={
                typeof result?.values?.spokenLanguages === "string"
                  ? result.values.spokenLanguages.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)
                  : settings.spokenLanguages
              }
              result={result}
              description="Choose the languages you read. The first is used for translations."
            />
            <FieldError name="spokenLanguages" result={result} />
          </section>
          <section className="form-section">
            <h2>AI analysis</h2>
            <SelectMenu
              id="model"
              name="model"
              label="Model"
              defaultValue={
                typeof result?.values?.model === "string"
                  ? result.values.model
                  : settings.model
              }
              options={settings.models.map((model) => ({ value: model, label: model }))}
              {...fieldA11y("model", result)}
            />
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
        </fetcher.Form>
      </div>
    </>
  );
}
export const ErrorBoundary = WorkspaceError;
