import { useState } from "react";
import { Form, Link } from "react-router";
import type { JsonObject } from "../../shared/types";
import {
  CATEGORIES,
  COUNTRY_PRESETS,
  num,
  str,
  strings,
  type ActionResult,
  type FormValues,
} from "../lib/workspace";
import { ActionFeedback, FieldError, Submit, fieldA11y } from "./workspace";

export function ResearchFields({
  defaults,
  result,
  settings = false,
}: {
  defaults: JsonObject;
  result?: ActionResult;
  settings?: boolean;
}) {
  const values: FormValues = result?.values ?? {};
  const value = (name: string, fallback: string) =>
    typeof values[name] === "string" ? (values[name] as string) : fallback;
  const checked = (name: string, fallback: boolean) =>
    result?.values ? values[name] === "on" : fallback;
  const [mode, setMode] = useState(value("mode", "topic"));
  const [preset, setPreset] = useState(
    value("preset", str(defaults.preset, "quick")),
  );
  const [countries, setCountries] = useState(
    value("countries", strings(defaults.countries).join(", ")),
  );
  const [appLimit, setAppLimit] = useState(
    value("appLimit", String(num(defaults.appLimit) || 10)),
  );
  const [reviewLimit, setReviewLimit] = useState(
    value("reviewLimit", String(num(defaults.reviewLimit) || 2000)),
  );
  const [budget, setBudget] = useState(
    value(
      "budgetUsd",
      String(defaults.budgetUsd ?? (preset === "deep" ? 5 : 1)),
    ),
  );
  const [crossPlatform, setCrossPlatform] = useState(
    checked("crossPlatform", defaults.crossPlatform !== false),
  );
  const setDepth = (depth: string) => {
    setPreset(depth);
    setAppLimit(depth === "deep" ? "30" : "10");
    setReviewLimit(depth === "deep" ? "10000" : "2000");
    setBudget(depth === "deep" ? "5" : "1");
  };
  const countryNames = countries
    .split(/[,\n]+/)
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean)
    .map((code) => {
      try {
        return (
          new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code
        );
      } catch {
        return code;
      }
    });
  return (
    <>
      {!settings && (
        <section className="form-section">
          <h2>What would you like to explore?</h2>
          <fieldset>
            <legend>Research mode</legend>
            <div className="choice-row">
              {[
                ["topic", "Topic or need"],
                ["category", "App categories"],
              ].map(([id, label]) => (
                <label className="radio-option" key={id}>
                  <input
                    type="radio"
                    name="mode"
                    value={id}
                    checked={mode === id}
                    onChange={() => setMode(id)}
                    {...fieldA11y("mode", result)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <FieldError name="mode" result={result} />
          </fieldset>
          <label htmlFor="query">
            {mode === "topic"
              ? "Topic or user need"
              : "Focus within these categories (optional)"}
            <textarea
              id="query"
              name="query"
              rows={3}
              maxLength={2000}
              defaultValue={value("query", "")}
              placeholder="For example, planning meals around food allergies"
              {...fieldA11y("query", result)}
            />
          </label>
          <FieldError name="query" result={result} />
          {mode === "category" && (
            <fieldset {...fieldA11y("categories", result)}>
              <legend>Categories</legend>
              <div className="checkbox-grid">
                {CATEGORIES.map((category) => (
                  <label className="check-option" key={category.label}>
                    <input
                      type="checkbox"
                      name="categories"
                      value={category.label}
                      defaultChecked={
                        Array.isArray(values.categories) &&
                        values.categories.includes(category.label)
                      }
                    />
                    {category.label}
                  </label>
                ))}
              </div>
              <FieldError name="categories" result={result} />
            </fieldset>
          )}
          <label htmlFor="urls">
            Include specific apps (optional)
            <textarea
              id="urls"
              name="urls"
              rows={2}
              defaultValue={value("urls", "")}
              placeholder="Paste an App Store or Google Play URL, one per line"
              {...fieldA11y("urls", result)}
            />
          </label>
          <FieldError name="urls" result={result} />
          <p className="field-hint">
            Included apps count toward the app listing maximum.
          </p>
        </section>
      )}
      <section className="form-section">
        <h2>{settings ? "Default research scope" : "Research scope"}</h2>
        <fieldset {...fieldA11y("stores", result)}>
          <legend>Stores</legend>
          <div className="choice-row">
            {[
              ["apple", "Apple App Store"],
              ["google", "Google Play"],
            ].map(([id, label]) => (
              <label key={id} className="check-option">
                <input
                  type="checkbox"
                  name="stores"
                  value={id}
                  defaultChecked={
                    Array.isArray(values.stores)
                      ? values.stores.includes(id)
                      : !result?.values && strings(defaults.stores).includes(id)
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <FieldError name="stores" result={result} />
        </fieldset>
        <label htmlFor="countryPreset">
          Start with a country preset
          <select
            id="countryPreset"
            defaultValue="custom"
            onChange={(event) => {
              if (event.target.value !== "custom")
                setCountries(
                  COUNTRY_PRESETS[
                    event.target.value as keyof typeof COUNTRY_PRESETS
                  ].join(", "),
                );
            }}
          >
            <option value="custom">Custom countries</option>
            <option value="international">International sample</option>
            <option value="us">United States</option>
            <option value="europe">European sample</option>
          </select>
        </label>
        <label htmlFor="countries">
          Countries to research
          <input
            id="countries"
            name="countries"
            value={countries}
            onChange={(event) => setCountries(event.target.value)}
            placeholder="US, GB, DE"
            required
            {...fieldA11y("countries", result)}
          />
        </label>
        <FieldError name="countries" result={result} />
        <p className="field-hint country-preview">
          {countryNames.length
            ? countryNames.join(" · ")
            : "Choose the countries that will actually be searched."}
        </p>
        <p className="field-hint">
          Countries describe store markets, not reviewers’ residence. Reviews
          retain their original language.
        </p>
        <fieldset>
          <legend>Research depth</legend>
          <div className="choice-row">
            {[
              ["quick", "Quick", "10 apps · 2,000 reviews · $1 AI ceiling"],
              ["deep", "Deep", "30 apps · 10,000 reviews · $5 AI ceiling"],
            ].map(([id, label, description]) => (
              <label key={id} className="depth-option">
                <input
                  type="radio"
                  name="preset"
                  value={id}
                  checked={preset === id}
                  onChange={() => setDepth(id)}
                />
                <span>
                  <strong>{label}</strong>
                  <small>{description}</small>
                </span>
              </label>
            ))}
          </div>
          <FieldError name="preset" result={result} />
        </fieldset>
        <p className="field-hint">
          These are maximum allowances. Available evidence may be lower.
          Changing depth resets the advanced limits.
        </p>
      </section>
      <section className="form-section">
        <h2>Research perspectives</h2>
        <p className="muted">
          Look for missing capabilities, underserved audiences, and poor
          execution.
        </p>
        <label className="check-option">
          <input
            type="checkbox"
            name="crossPlatform"
            checked={crossPlatform}
            onChange={(event) => setCrossPlatform(event.target.checked)}
          />
          Include cross-platform opportunities
        </label>
        <label htmlFor="direction">
          Platform direction
          <select
            id="direction"
            name="direction"
            defaultValue={value(
              "direction",
              str(defaults.direction, "android_to_ios"),
            )}
            {...fieldA11y("direction", result, "direction-hint")}
          >
            <option value="android_to_ios">Android → iOS</option>
            <option value="ios_to_android">iOS → Android</option>
            <option value="both">Both directions</option>
          </select>
        </label>
        <p id="direction-hint" className="field-hint">
          {crossPlatform
            ? "Check counterparts and alternatives in the destination store. Missing matches do not prove a market gap."
            : "This direction is used only when cross-platform opportunities are enabled."}
        </p>
        <FieldError name="direction" result={result} />
        <label className="check-option">
          <input
            type="checkbox"
            name="reviewCandidates"
            defaultChecked={checked(
              "reviewCandidates",
              defaults.reviewCandidates === true,
            )}
          />
          Review apps before collecting reviews
        </label>
        <p className="field-hint">
          Pause after discovery to remove apps or add a store URL.
        </p>
      </section>
      <details
        className="advanced"
        open={
          !!result?.errors &&
          [
            "appLimit",
            "reviewLimit",
            "budgetUsd",
            "languages",
            "websiteUrls",
          ].some((name) => result.errors?.[name])
        }
      >
        <summary>
          Advanced <span>Limits and additional sources</span>
        </summary>
        <div className="advanced-fields">
          <div className="field-grid">
            <label htmlFor="appLimit">
              App listing maximum
              <input
                id="appLimit"
                name="appLimit"
                type="number"
                min="1"
                max="100"
                step="1"
                value={appLimit}
                onChange={(event) => setAppLimit(event.target.value)}
                {...fieldA11y("appLimit", result)}
              />
              <FieldError name="appLimit" result={result} />
            </label>
            <label htmlFor="reviewLimit">
              Review selection maximum
              <input
                id="reviewLimit"
                name="reviewLimit"
                type="number"
                min="1"
                max="20000"
                step="1"
                value={reviewLimit}
                onChange={(event) => setReviewLimit(event.target.value)}
                {...fieldA11y("reviewLimit", result)}
              />
              <FieldError name="reviewLimit" result={result} />
            </label>
            <label htmlFor="budgetUsd">
              AI ceiling (USD)
              <input
                id="budgetUsd"
                name="budgetUsd"
                type="number"
                min="0"
                max="1000"
                step="0.01"
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
                {...fieldA11y("budgetUsd", result)}
              />
              <FieldError name="budgetUsd" result={result} />
            </label>
          </div>
          <label htmlFor="languages">
            Additional review languages (optional)
            <input
              id="languages"
              name="languages"
              defaultValue={value(
                "languages",
                strings(defaults.languages).join(", "),
              )}
              placeholder="ja, pt, ar"
              {...fieldA11y("languages", result)}
            />
          </label>
          <FieldError name="languages" result={result} />
          <p className="field-hint">
            Market languages are included automatically. Add language codes for
            extra Google Play review streams.
          </p>
          {!settings && (
            <>
              <label htmlFor="websiteUrls">
                Context websites (optional)
                <textarea
                  id="websiteUrls"
                  name="websiteUrls"
                  rows={2}
                  defaultValue={value("websiteUrls", "")}
                  placeholder="One public website URL per line"
                  {...fieldA11y("websiteUrls", result)}
                />
              </label>
              <FieldError name="websiteUrls" result={result} />
              <p className="field-hint">
                User-added websites are contextual sources. Official
                capabilities still require verified sources.
              </p>
            </>
          )}
        </div>
      </details>
    </>
  );
}
export function NewResearchForm({
  defaults,
  result,
}: {
  defaults: JsonObject;
  result?: ActionResult;
}) {
  return (
    <Form method="post" className="research-form" noValidate>
      <input type="hidden" name="intent" value="create" />
      <ActionFeedback result={result} />
      <ResearchFields
        key={result?.values ? JSON.stringify(result.values) : "initial"}
        defaults={defaults}
        result={result}
      />
      <div className="form-footer">
        <Link className="button secondary" to="/">
          Cancel
        </Link>
        <Submit>Start research</Submit>
      </div>
      <p className="field-hint">
        Research runs locally in the background. You can pause it and return
        later.
      </p>
    </Form>
  );
}
