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
import { ideasPrompt, marketPrompt, parseIdeas, parseMarket } from "../../shared/ideas";
import { ActionFeedback, ChipPicker, FieldError, SelectMenu, Submit, fieldA11y } from "./workspace";

const COUNTRY_OPTIONS = [
  ["US", "United States"], ["GB", "United Kingdom"], ["DE", "Germany"],
  ["FR", "France"], ["NL", "Netherlands"], ["ES", "Spain"],
  ["CA", "Canada"], ["AU", "Australia"], ["IT", "Italy"],
  ["JP", "Japan"], ["BR", "Brazil"], ["IN", "India"],
].map(([value, label]) => ({ value, label }));
export const LANGUAGE_OPTIONS = [
  ["en", "English"], ["de", "German"], ["fr", "French"], ["es", "Spanish"],
  ["it", "Italian"], ["pt", "Portuguese"], ["nl", "Dutch"], ["ja", "Japanese"],
  ["ko", "Korean"], ["zh", "Chinese"], ["ar", "Arabic"], ["hi", "Hindi"],
  ["ru", "Russian"], ["tr", "Turkish"], ["pl", "Polish"], ["sv", "Swedish"],
].map(([value, label]) => ({ value, label }));

export function LanguagePicker({
  id = "languages",
  name = "languages",
  label = "Additional review languages (optional)",
  initial,
  result,
  description = "Market languages are included automatically. Choose extra Google Play review streams.",
}: {
  id?: string;
  name?: string;
  label?: string;
  initial: string[];
  result?: ActionResult;
  description?: string;
}) {
  const [selected, setSelected] = useState(initial);
  const options = [
    ...LANGUAGE_OPTIONS,
    ...selected
      .filter((value) => !LANGUAGE_OPTIONS.some((option) => option.value === value))
      .map((value) => ({ value, label: value })),
  ];
  return (
    <ChipPicker
      id={id}
      name={name}
      label={label}
      options={options}
      selected={selected}
      onChange={setSelected}
      description={description}
      {...fieldA11y(name, result)}
    />
  );
}

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
  const ideas = !settings && mode === "ideas";
  const transfer = !settings && mode === "transfer";
  // Both modes compare two markets and never sample the general country list.
  const markets = transfer || ideas;
  const broad = mode === "explore" || mode === "transfer";
  const [sourceCountry, setSourceCountry] = useState(value("sourceCountry", "US"));
  const [targetCountry, setTargetCountry] = useState(value("targetCountry", "DE"));
  const [preset, setPreset] = useState(
    value("preset", str(defaults.preset, "quick")),
  );
  const [countries, setCountries] = useState(strings(defaults.countries));
  const [discoveryLimit, setDiscoveryLimit] = useState(
    value("discoveryLimit", String(num(defaults.discoveryLimit) || 300)),
  );
  const [exploreAppLimit, setExploreAppLimit] = useState(
    value("exploreAppLimit", String(num(defaults.exploreAppLimit) || 20)),
  );
  const [appLimit, setAppLimit] = useState(
    value("appLimit", String(num(defaults.appLimit) || 10)),
  );
  const [surveyLimit, setSurveyLimit] = useState(
    value("surveyLimit", String(num(defaults.surveyLimit) || 2000)),
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
    setDiscoveryLimit(depth === "deep" ? "750" : "300");
    setExploreAppLimit(depth === "deep" ? "40" : "20");
    setAppLimit(depth === "deep" ? "75" : "30");
    setReviewLimit(depth === "deep" ? "10000" : "2000");
    setSurveyLimit(depth === "deep" ? "10000" : "2000");
    setBudget(depth === "deep" ? "5" : "1");
  };
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
                ["explore", "Explore niches"],
                ["transfer", "Market transfer"],
                ["ideas", "Business ideas"],
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
          {markets && (
            <>
              <div className="field-grid">
                <div>
                  <SelectMenu
                    id="sourceCountry"
                    name="sourceCountry"
                    label={ideas ? "Businesses that exist in" : "Apps that exist in"}
                    value={sourceCountry}
                    onValueChange={setSourceCountry}
                    options={COUNTRY_OPTIONS}
                    {...fieldA11y("sourceCountry", result)}
                  />
                  <FieldError name="sourceCountry" result={result} />
                </div>
                <div>
                  <SelectMenu
                    id="targetCountry"
                    name="targetCountry"
                    label={ideas ? "But are not offered in" : "But are not listed in"}
                    value={targetCountry}
                    onValueChange={setTargetCountry}
                    options={COUNTRY_OPTIONS}
                    {...fieldA11y("targetCountry", result)}
                  />
                  <FieldError name="targetCountry" result={result} />
                </div>
              </div>
              {transfer && <p className="field-hint">
                Surveys the free, paid and grossing charts in the first market
                and checks each listing against the second storefront. No
                reviews are collected. Set “Market transfer listings” under
                Advanced to survey up to 25,000; leave all categories unchecked
                for the widest sample. A missing listing is a lead to
                investigate, not proof of demand.
              </p>}
            </>
          )}
          {ideas && (
            <IdeasResearch
              sourceCountry={sourceCountry}
              targetCountry={targetCountry}
              values={values}
              result={result}
            />
          )}
          {!ideas && <>
          <label htmlFor="query">
            {mode === "topic"
              ? "Topic or user need"
              : broad
                ? "Interests or constraints (optional)"
                : "Focus within these categories (optional)"}
            <textarea
              id="query"
              name="query"
              rows={3}
              maxLength={2000}
              defaultValue={value("query", "")}
              placeholder={broad ? "For example, tools for independent professionals — or leave empty" : "For example, planning meals around food allergies"}
              {...fieldA11y("query", result)}
            />
          </label>
          <FieldError name="query" result={result} />
          {(mode === "category" || broad) && (
            <fieldset {...fieldA11y("categories", result)}>
              <legend>{broad ? "Areas to explore (optional)" : "Categories"}</legend>
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
              {broad && <p className="field-hint">Leave everything unchecked to sample all available categories.</p>}
            </fieldset>
          )}
          {!broad && <label htmlFor="urls">
            Include specific apps (optional)
            <textarea
              id="urls"
              name="urls"
              rows={2}
              defaultValue={value("urls", "")}
              placeholder="Paste an App Store or Google Play URL, one per line"
              {...fieldA11y("urls", result)}
            />
          </label>}
          {!broad && <FieldError name="urls" result={result} />}
          {!broad && <p className="field-hint">Included apps count toward the reviewed-app maximum.</p>}
          </>}
        </section>
      )}
      <section className="form-section">
        <h2>{settings ? "Default research scope" : "Research scope"}</h2>
        {ideas && strings(defaults.stores).map((store) => (
          <input key={store} type="hidden" name="stores" value={store} />
        ))}
        {!ideas && <fieldset {...fieldA11y("stores", result)}>
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
        </fieldset>}
        {!markets && <SelectMenu
          id="countryPreset"
          name="countryPreset"
          label="Start with a country preset"
          defaultValue="custom"
          options={[
            { value: "custom", label: "Custom countries" },
            { value: "international", label: "International sample" },
            { value: "us", label: "United States" },
            { value: "europe", label: "European sample" },
          ]}
          onValueChange={(value) => {
            if (value !== "custom")
              setCountries(
                COUNTRY_PRESETS[value as keyof typeof COUNTRY_PRESETS],
              );
          }}
        />}
        {!markets && <ChipPicker
          id="countries"
          name="countries"
          label="Countries to research"
          options={COUNTRY_OPTIONS}
          selected={countries}
          onChange={setCountries}
          description="Choose the store markets to search."
          {...fieldA11y("countries", result)}
        />}
        <FieldError name="countries" result={result} />
        <p className="field-hint">
          {ideas
            ? "Only the source pages from your pasted research are fetched."
            : transfer
            ? "Listings are sampled in the first market only."
            : "Countries describe store markets, not reviewers’ residence. Reviews retain their original language."}
        </p>
        <fieldset>
          <legend>Research depth</legend>
          <div className="choice-row">
            {[
              ["quick", "Quick", ideas ? "$1 AI ceiling for reading the pasted sources" : transfer ? "2,000 listings surveyed · 20 leads searched in the target store" : broad ? "300 listings · 20 reviewed apps · 2,000 reviews" : "30 reviewed apps · 2,000 reviews · $1 AI ceiling"],
              ["deep", "Deep", ideas ? "$5 AI ceiling for reading the pasted sources" : transfer ? "10,000 listings surveyed · 40 leads searched in the target store" : broad ? "750 listings · 40 reviewed apps · 10,000 reviews" : "75 reviewed apps · 10,000 reviews · $5 AI ceiling"],
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
      {ideas && (
        <input type="hidden" name="direction" value={str(defaults.direction, "android_to_ios")} />
      )}
      {!ideas && <section className="form-section">
        <h2>Research perspectives</h2>
        <p className="muted">
          Compare apps with the same core job, then turn recurring gaps into
          concrete app concepts and execution priorities.
        </p>
        {transfer && (
          <input
            type="hidden"
            name="direction"
            value={str(defaults.direction, "android_to_ios")}
          />
        )}
        {!transfer && <label className="check-option">
          <input
            type="checkbox"
            name="crossPlatform"
            checked={crossPlatform}
            onChange={(event) => setCrossPlatform(event.target.checked)}
          />
          Include cross-platform opportunities
        </label>}
        {!transfer && <SelectMenu
          id="direction"
          name="direction"
          label="Platform direction"
          defaultValue={value(
            "direction",
            str(defaults.direction, "android_to_ios"),
          )}
          options={[
            { value: "android_to_ios", label: "Android → iOS" },
            { value: "ios_to_android", label: "iOS → Android" },
            { value: "both", label: "Both directions" },
          ]}
          {...fieldA11y("direction", result, "direction-hint")}
        />}
        {!transfer && <p id="direction-hint" className="field-hint">
          {crossPlatform
            ? "Check counterparts and alternatives in the destination store. Missing matches do not prove a market gap."
            : "This direction is used only when cross-platform opportunities are enabled."}
        </p>}
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
      </section>}
      <details
        className="advanced"
        open={
          !!result?.errors &&
          [
            "discoveryLimit",
            "surveyLimit",
            "exploreAppLimit",
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
            <label htmlFor="discoveryLimit">
              Explore discovery pool
              <input
                id="discoveryLimit"
                name="discoveryLimit"
                type="number"
                min="1"
                max="2000"
                step="1"
                value={discoveryLimit}
                onChange={(event) => setDiscoveryLimit(event.target.value)}
                {...fieldA11y("discoveryLimit", result)}
              />
              <small>Listing details inspected before choosing and checking a niche. Used only by Explore.</small>
              <FieldError name="discoveryLimit" result={result} />
            </label>
            <label htmlFor="surveyLimit">
              Market transfer listings
              <input
                id="surveyLimit"
                name="surveyLimit"
                type="number"
                min="1"
                max="25000"
                step="1"
                value={surveyLimit}
                onChange={(event) => setSurveyLimit(event.target.value)}
                {...fieldA11y("surveyLimit", result)}
              />
              <small>Apps checked against the target storefront. App Store checks run 100 per request; Google Play needs one request per app, so large Play surveys are slow.</small>
              <FieldError name="surveyLimit" result={result} />
            </label>
            <label htmlFor="exploreAppLimit">
              Explore apps reviewed maximum
              <input
                id="exploreAppLimit"
                name="exploreAppLimit"
                type="number"
                min="1"
                max="100"
                step="1"
                value={exploreAppLimit}
                onChange={(event) => setExploreAppLimit(event.target.value)}
                {...fieldA11y("exploreAppLimit", result)}
              />
              <small>Apps retained for review collection in Explore. In Market transfer, the leads that get a target-store search.</small>
              <FieldError name="exploreAppLimit" result={result} />
            </label>
            <label htmlFor="appLimit">
              Topic/category apps reviewed maximum
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
              {markets && <small>Not used in this mode; no reviews are collected.</small>}
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
          <LanguagePicker
            initial={
              typeof values.languages === "string"
                ? values.languages.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean)
                : strings(defaults.languages)
            }
            result={result}
          />
          <FieldError name="languages" result={result} />
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
function CopyBox({ id, label, text }: { id: string; label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="prompt-box">
      <label htmlFor={id}>
        {label}
        <textarea id={id} rows={7} readOnly value={text} />
      </label>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => setCopied(true));
        }}
      >
        {copied ? "Copied" : "Copy prompt"}
      </button>
    </div>
  );
}
// Deep research runs in the user's own Claude or ChatGPT; Lacuna only writes the
// prompt and reads back the pasted json block.
function IdeasResearch({
  sourceCountry,
  targetCountry,
  values,
  result,
}: {
  sourceCountry: string;
  targetCountry: string;
  values: FormValues;
  result?: ActionResult;
}) {
  const initial = (name: string) =>
    typeof values[name] === "string" ? (values[name] as string) : "";
  const [focus, setFocus] = useState(initial("query"));
  const [pasted, setPasted] = useState(initial("ideasResearch"));
  const [pastedMarket, setPastedMarket] = useState(initial("targetResearch"));
  const parsed = pasted.trim() ? parseIdeas(pasted) : null;
  const market =
    parsed?.ideas.length && pastedMarket.trim()
      ? parseMarket(pastedMarket, parsed.ideas)
      : null;
  const feedback = (count: number, noun: string, errors: string[]) => (
    <div className="field-hint" role="status">
      {count > 0 && <p>{count} {noun} recognised.</p>}
      {errors.slice(0, 5).map((error) => <p key={error}>{error}</p>)}
    </div>
  );
  return (
    <>
      <label htmlFor="query">
        Focus (optional)
        <textarea
          id="query"
          name="query"
          rows={2}
          maxLength={2000}
          value={focus}
          onChange={(event) => setFocus(event.target.value)}
          placeholder="For example, services for small restaurants — or leave empty"
          {...fieldA11y("query", result)}
        />
      </label>
      <FieldError name="query" result={result} />
      <h3>1. Find ideas</h3>
      <p className="field-hint">
        Run this prompt in Claude or ChatGPT deep research, then paste the
        answer, or just its final json block. Lacuna opens every source it lists and describes each
        business from those pages.
      </p>
      <CopyBox
        id="ideasPrompt"
        label="Research prompt"
        text={ideasPrompt({ sourceCountry, targetCountry, focus })}
      />
      <label htmlFor="ideasResearch">
        Paste the research answer
        <textarea
          id="ideasResearch"
          name="ideasResearch"
          rows={6}
          value={pasted}
          onChange={(event) => setPasted(event.target.value)}
          placeholder="Paste the answer, or just its final json block"
          {...fieldA11y("ideasResearch", result)}
        />
      </label>
      <FieldError name="ideasResearch" result={result} />
      {parsed && feedback(parsed.ideas.length, parsed.ideas.length === 1 ? "idea" : "ideas", parsed.errors)}
      {parsed && parsed.ideas.length > 0 && (
        <>
          <h3>2. Check the target market (optional)</h3>
          <p className="field-hint">
            This second prompt asks whether each idea, or a local equivalent,
            already exists. Skip it to get the business descriptions only.
          </p>
          <CopyBox
            id="marketPrompt"
            label="Target-market prompt"
            text={marketPrompt({ sourceCountry, targetCountry, ideas: parsed.ideas })}
          />
          <label htmlFor="targetResearch">
            Paste the target-market answer
            <textarea
              id="targetResearch"
              name="targetResearch"
              rows={6}
              value={pastedMarket}
              onChange={(event) => setPastedMarket(event.target.value)}
              placeholder="Paste the answer, or just its final json block"
              {...fieldA11y("targetResearch", result)}
            />
          </label>
          <FieldError name="targetResearch" result={result} />
          {market && feedback(market.findings.length, market.findings.length === 1 ? "finding" : "findings", market.errors)}
        </>
      )}
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
