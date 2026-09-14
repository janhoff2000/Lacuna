import { useEffect, useState } from "react";
import { Form, Link } from "react-router";
import type { JsonObject } from "../../shared/types";
import type { readResearch } from "../../server/operations";
import {
  date,
  directionLabel,
  num,
  obj,
  objects,
  opportunityUrl,
  perspectiveLabel,
  safeUrl,
  sourceAnchor,
  storeLabel,
  str,
  strings,
} from "../lib/workspace";
import { EmptyState, Notice, Submit } from "./workspace";

export type ResearchView = ReturnType<typeof readResearch>;
export type SourceView = ResearchView["sources"][number];
function storedObject(encoded?: string): JsonObject {
  if (!encoded) return {};
  try {
    return obj(JSON.parse(encoded));
  } catch {
    // Old or malformed snapshots must not make an evidence view unusable.
    return {};
  }
}
function sourceLocale(source: SourceView) {
  const provenance = storedObject(source.provenance_json);
  return {
    requestedCountry: str(provenance.requestedCountry, str(source.payload.country, "Unknown")),
    requestedLanguage: str(provenance.requestedLanguage, str(source.payload.language, "Unknown")),
    detectedLanguage: str(source.payload.detectedLanguage, "Unknown"),
  };
}
export function SourceLink({
  source,
  children,
}: {
  source?: SourceView;
  children?: React.ReactNode;
}) {
  const url = safeUrl(source?.url);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      {children ??
        (source?.payload.directReviewUrl === true
          ? "Open captured review"
          : source?.kind === "review"
            ? "Open app listing"
            : "Open captured source")}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <span className="muted">No source URL captured</span>
  );
}
export function OpportunityRow({
  opportunity,
  active,
  base,
}: {
  opportunity: JsonObject & { id: string };
  active: boolean;
  base: string;
}) {
  const count = obj(opportunity.counts).supportingReviews;
  return (
    <Link
      className={`opportunity-row ${active ? "selected" : ""}`}
      to={opportunityUrl(base, opportunity.id)}
      aria-current={active ? "true" : undefined}
      preventScrollReset
    >
      <div className="row-overline">
        <span>{perspectiveLabel(opportunity.perspective)}</span>
        {active && (
          <span className="selection-cue" aria-label="Selected">
            ●
          </span>
        )}
      </div>
      <h3>{str(opportunity.title, "Untitled opportunity")}</h3>
      <p>{str(opportunity.need)}</p>
      <div className="row-labels">
        <span>
          Priority{" "}
          {{ 1: "High", 2: "Medium", 3: "Low" }[num(opportunity.priority)] ??
            "Unassessed"}
        </span>
        <span>{str(opportunity.confidence, "Unassessed")} confidence</span>
      </div>
      <div className="row-overline">
        <span>
          {count !== undefined
            ? `${num(count)} supporting reviews`
            : "Preliminary evidence"}
        </span>
        <span>{directionLabel(opportunity.direction)}</span>
      </div>
    </Link>
  );
}
function ClaimSources({
  ids,
  base,
  opportunityId,
  sources,
}: {
  ids: string[];
  base: string;
  opportunityId: string;
  sources: SourceView[];
}) {
  return (
    <div className="claim-links">
      {ids.map((id, index) =>
        sources.some((source) => source.id === id) ? (
          <Link
            key={id}
            to={opportunityUrl(base, opportunityId, id)}
            preventScrollReset
          >
            Source {index + 1}
            <span className="sr-only"> for this claim</span>
          </Link>
        ) : (
          <span key={id} className="muted">
            Source unavailable: {id}
          </span>
        ),
      )}
    </div>
  );
}
function EvidencePassage({
  source,
  findings,
  selected,
  counter,
  appTitle,
  back,
}: {
  source: SourceView;
  findings: JsonObject[];
  selected: boolean;
  counter: boolean;
  appTitle: string;
  back: string;
}) {
  const sourceProvenance = storedObject(source.provenance_json);
  const provenance =
    source.kind === "listing"
      ? "Official app listing"
      : source.kind === "review"
        ? "User review"
        : str(sourceProvenance.officialListingSourceId)
          ? "Official website"
          : "Context website";
  const locale = sourceLocale(source);
  const body = str(source.payload.text) || str(source.payload.description);
  const excerpts = findings.filter(
    (finding) => str(finding.sourceId) === source.id,
  );
  return (
    <article
      id={sourceAnchor(source.id)}
      className={`evidence-passage ${selected ? "source-selected" : ""}`}
      tabIndex={-1}
      aria-label={`${counter ? "Counterevidence" : "Evidence"} from ${appTitle}`}
    >
      <div className="source-heading">
        <span className="source-kind">
          {counter ? "Counterevidence" : provenance}
          {selected && " · Selected source"}
        </span>
        <SourceLink source={source} />
      </div>
      <h3>{appTitle}</h3>
      <p className="metadata">
        {storeLabel(source.store)}
        {typeof source.payload.rating === "number" &&
          ` · ${source.payload.rating}/5 stars`}{" "}
        · {date(str(source.payload.date) || null)} · Captured{" "}
        {date(source.captured_at)}
      </p>
      <p className="metadata">
        Requested storefront: {locale.requestedCountry} · Requested language: {locale.requestedLanguage} · Detected language: {locale.detectedLanguage}
      </p>
      {excerpts.length ? (
        excerpts.map((finding, index) => (
          <div key={index}>
            <blockquote dir="auto">{str(finding.excerpt)}</blockquote>
            {obj(finding.translation).text && (
              <div className="translation">
                <span className="metadata">Translation · English</span>
                <p>{str(obj(finding.translation).text)}</p>
              </div>
            )}
            {strings(finding.uncertainty).length > 0 && (
              <p className="metadata">
                Uncertainty: {strings(finding.uncertainty).join(" ")}
              </p>
            )}
          </div>
        ))
      ) : (
        <blockquote dir="auto">
          {body || "No text passage was captured."}
        </blockquote>
      )}
      {excerpts.length > 0 && body && (
        <details className="original-text">
          <summary>View full original text</summary>
          <p dir="auto">{body}</p>
        </details>
      )}
      <div className="source-footer">
        <span>
          Stored source <code>{source.review_id ?? source.id}</code>
        </span>
        <Link to={`${back}#evidence`} preventScrollReset>
          Back to evidence list
        </Link>
      </div>
    </article>
  );
}
export function OpportunityDetail({
  opportunity,
  sources,
  base,
  selectedSource,
  saveEnabled = true,
  sample = false,
}: {
  opportunity: JsonObject & { id: string };
  sources: SourceView[];
  base: string;
  selectedSource?: string | null;
  saveEnabled?: boolean;
  sample?: boolean;
}) {
  const verification = obj(opportunity.verification);
  const counts = obj(opportunity.counts);
  const supportIds = strings(opportunity.sourceIds);
  const counterIds = strings(opportunity.counterSourceIds);
  const citations = objects(verification.citations);
  const pricing = objects(verification.pricing);
  const allIds = [
    ...new Set([
      ...supportIds,
      ...counterIds,
      ...citations.map((citation) => str(citation.sourceId)),
      ...pricing.map((citation) => str(citation.sourceId)),
      ...objects(opportunity.counterparts)
        .map((check) => str(obj(check.verifiedSource).sourceId))
        .filter(Boolean),
    ]),
  ];
  const passages = sources.filter((source) => allIds.includes(source.id));
  const findings = [...objects(opportunity.evidence), ...citations, ...pricing];
  const path = opportunityUrl(base, opportunity.id);
  useEffect(() => {
    if (!selectedSource) return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(sourceAnchor(selectedSource))
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [selectedSource, opportunity.id]);
  return (
    <article className="opportunity-detail">
      <Link className="back-to-list" to={base}>
        ← All opportunities
      </Link>
      {sample && (
        <Notice tone="neutral" title="Sample opportunity">
          <p>Development fixture only. This is not completed live research.</p>
        </Notice>
      )}
      <div className="detail-title-row">
        <div>
          <p className="eyebrow">
            {perspectiveLabel(opportunity.perspective)}
            {opportunity.direction &&
              ` · ${directionLabel(opportunity.direction)}`}
          </p>
          <h2>{str(opportunity.title)}</h2>
        </div>
        {!sample && (
          <Form method="post">
            <input type="hidden" name="opportunityId" value={opportunity.id} />
            <Submit
              secondary
              name="intent"
              value="save"
              disabled={!saveEnabled}
            >
              Save opportunity
            </Submit>
          </Form>
        )}
      </div>
      <p className="report-prose">{str(opportunity.need)}</p>
      <ClaimSources
        ids={supportIds}
        base={base}
        opportunityId={opportunity.id}
        sources={sources}
      />
      <dl className="audience">
        <dt>
          Affected audience
          {opportunity.audienceInferred === true && " · Inferred"}
        </dt>
        <dd>{str(opportunity.audience, "No specific audience established")}</dd>
      </dl>
      <p className="field-hint">
        This opportunity is an interpretation of observed statements. A product
        proposal is not proof of demand.
      </p>
      <nav className="detail-nav" aria-label="Opportunity sections">
        <a href="#assessment">Assessment</a>
        <a href="#evidence">Evidence</a>
        <a href="#comparison">Competitors</a>
        <a href="#apps-coverage">Apps and coverage</a>
      </nav>
      <section id="assessment" className="detail-section">
        <h3>Priority and evidence confidence</h3>
        <div className="assessment-grid">
          <div>
            <p className="assessment-label">
              {{ 1: "High", 2: "Medium", 3: "Low" }[
                num(opportunity.priority)
              ] ?? "Unassessed"}{" "}
              priority
            </p>
            <ul className="plain-list">
              {strings(opportunity.priorityReasons).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="assessment-label">
              {str(opportunity.confidence, "Unassessed")} confidence
            </p>
            <dl className="compact-facts">
              {[
                ["Supporting reviews", counts.supportingReviews],
                ["Products", counts.products],
                ["Developers", counts.developers],
                ["Recent reviews", counts.recentReviews],
              ].map(([label, count]) => (
                <div key={String(label)}>
                  <dt>{String(label)}</dt>
                  <dd>{typeof count === "number" ? count : "Not assessed"}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className="metadata">
          Verification: {str(opportunity.status, "Preliminary")}.{" "}
          {num(opportunity.denominator)} successfully analyzed reviews in the
          denominator. Priority helps order investigation; it does not predict
          business success.
        </p>
        {strings(opportunity.uncertainty).length > 0 && (
          <Notice title="What remains uncertain">
            <ul className="plain-list">
              {strings(opportunity.uncertainty).map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Notice>
        )}
      </section>
      <section id="evidence" className="detail-section">
        <div className="section-heading">
          <h3>Evidence and counterevidence</h3>
          <span className="metadata">
            {supportIds.length} supporting source references
          </span>
        </div>
        <p className="metadata">
          {str(
            opportunity.sampleStatement,
            "Counts describe the analyzed sample, not all users or distinct people.",
          )}
        </p>
        {!counterIds.length && (
          <p className="muted">
            No counterevidence was attached to this opportunity. This does not
            establish that none exists.
          </p>
        )}
        {passages.length ? (
          passages.map((source) => {
            const listing = sources.find(
              (item) =>
                item.kind === "listing" &&
                item.store === source.store &&
                item.app_id === source.app_id,
            );
            return (
              <EvidencePassage
                key={source.id}
                source={source}
                findings={findings}
                selected={source.id === selectedSource}
                counter={counterIds.includes(source.id)}
                appTitle={str(
                  listing?.payload.title,
                  str(source.payload.title, source.app_id ?? "Website passage"),
                )}
                back={path}
              />
            );
          })
        ) : (
          <Notice title="Source passages unavailable">
            <p>This preliminary result does not have readable passages yet.</p>
          </Notice>
        )}
      </section>
      <section id="comparison" className="detail-section">
        <h3>Competitor verification</h3>
        <p className="report-prose">
          {str(
            verification.explanation,
            "Competitor support has not been verified. Unknown capabilities are not missing capabilities.",
          )}
        </p>
        <div
          className="table-scroll"
          role="region"
          aria-label="Competitor comparison"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Capability or check</th>
                <th>Evidence state</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>Opportunity need</th>
                <td>
                  {verification.outcome === "contradicted"
                    ? "Documented support contradicts the gap"
                    : verification.outcome === "supported"
                      ? "Observed gap supported by this check"
                      : "Not verified"}
                </td>
                <td>
                  <ClaimSources
                    ids={citations.map((citation) => str(citation.sourceId))}
                    base={base}
                    opportunityId={opportunity.id}
                    sources={sources}
                  />
                </td>
              </tr>
              <tr>
                <th>Execution quality</th>
                <td>
                  {objects(opportunity.evidence).some((finding) =>
                    ["negative", "mixed"].includes(str(finding.sentiment)),
                  )
                    ? "Reported problems"
                    : "Not verified"}
                </td>
                <td>
                  <ClaimSources
                    ids={supportIds.slice(0, 2)}
                    base={base}
                    opportunityId={opportunity.id}
                    sources={sources}
                  />
                </td>
              </tr>
              <tr>
                <th>Platform feasibility</th>
                <td>
                  {verification.feasibility === "not_applicable"
                    ? "Not applicable"
                    : "Not verified"}
                </td>
                <td>No authoritative check recorded</td>
              </tr>
              {pricing.map((price, index) => (
                <tr key={index}>
                  <th>Captured pricing</th>
                  <td>
                    {str(price.displayPrice)}
                    {price.billingInterval &&
                      ` · ${str(price.billingInterval)}`}
                    <p className="metadata">
                      {strings(price.qualifications).join(" ")}
                    </p>
                  </td>
                  <td>
                    <ClaimSources
                      ids={[str(price.sourceId)]}
                      base={base}
                      opportunityId={opportunity.id}
                      sources={sources}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {objects(opportunity.counterparts).map((check, index) => (
          <div className="counterpart" key={index}>
            <h4>
              {str(check.source)} → {storeLabel(str(check.destination))}
            </h4>
            <p>{str(check.conclusion)}</p>
            <p className="metadata">
              Same-product search:{" "}
              {check.sameProductSearch ? "Completed" : "Incomplete"} ·
              Need-based search:{" "}
              {check.needBasedSearch ? "Completed" : "Incomplete"} ·
              Feasibility: {str(check.feasibility, "Not verified")}
            </p>
            {strings(check.unavailableMarkets).length > 0 && (
              <p>
                Unavailable markets:{" "}
                {strings(check.unavailableMarkets).join(", ")}
              </p>
            )}
            {obj(check.verifiedSource).sourceId && (
              <ClaimSources
                ids={[str(obj(check.verifiedSource).sourceId)]}
                base={base}
                opportunityId={opportunity.id}
                sources={sources}
              />
            )}
            <details>
              <summary>Search scope and candidates</summary>
              <ul className="plain-list">
                {objects(check.queries).map((query, i) => (
                  <li key={i}>
                    {str(query.query)} · {str(query.country)} ·{" "}
                    {str(query.language)} ·{" "}
                    {str(query.kind).replaceAll("_", " ")}
                  </li>
                ))}
              </ul>
              <p>
                Candidate matches:{" "}
                {strings(check.candidates).join(", ") || "None recorded"}
              </p>
              <p>
                Alternative candidates:{" "}
                {strings(check.alternativeCandidates).join(", ") ||
                  "None recorded"}
              </p>
            </details>
          </div>
        ))}
      </section>
      <section id="apps-coverage" className="detail-section">
        <h3>Apps and coverage</h3>
        {sources
          .filter(
            (source) =>
              source.kind === "listing" &&
              passages.some(
                (passage) =>
                  passage.store === source.store &&
                  passage.app_id === source.app_id,
              ),
          )
          .map((source) => (
            <div key={source.id} className="app-source-row">
              <div>
                <h4>
                  {str(source.payload.title, source.app_id ?? "App listing")}
                </h4>
                <p className="metadata">
                  {storeLabel(source.store)} · {str(source.payload.country)} ·
                  Captured {date(source.captured_at)}
                </p>
              </div>
              <SourceLink source={source} />
            </div>
          ))}
        <p className="metadata">
          Collected {num(obj(opportunity.sampleCounts).collected)} · Selected{" "}
          {num(obj(opportunity.sampleCounts).selected)} · Analyzed{" "}
          {num(obj(opportunity.sampleCounts).analyzed)}
        </p>
        <p className="muted">
          These are immutable source snapshots. Refreshing creates a new
          research run; saved notes and status stay with their original
          opportunity.
        </p>
      </section>
    </article>
  );
}
export function ReportWorkspace({
  opportunities,
  sources,
  base,
  selectedId,
  selectedSource,
  complete,
  sample = false,
}: {
  opportunities: Array<JsonObject & { id: string }>;
  sources: SourceView[];
  base: string;
  selectedId?: string | null;
  selectedSource?: string | null;
  complete: boolean;
  sample?: boolean;
}) {
  const [search, setSearch] = useState("");
  const selected = opportunities.find((item) => item.id === selectedId);
  const filtered = opportunities.filter((item) =>
    `${str(item.title)} ${str(item.need)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className={`report-workspace ${selected ? "has-selection" : ""}`}>
      <section
        className="opportunity-list"
        aria-labelledby="opportunity-list-title"
      >
        <div className="list-toolbar">
          <div className="section-heading">
            <h2 id="opportunity-list-title">Opportunities</h2>
            <span className="metadata">{opportunities.length}</span>
          </div>
          <label className="sr-only" htmlFor="opportunity-search">
            Search opportunities
          </label>
          <input
            id="opportunity-search"
            type="search"
            placeholder="Search opportunities…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {filtered.length ? (
          filtered.map((item) => (
            <OpportunityRow
              key={item.id}
              opportunity={item}
              active={selected?.id === item.id}
              base={base}
            />
          ))
        ) : (
          <EmptyState compact title="No matching opportunities">
            <p>Try a different search.</p>
          </EmptyState>
        )}
      </section>
      <div className="detail-reader">
        {selected ? (
          <OpportunityDetail
            opportunity={selected}
            sources={sources}
            base={base}
            selectedSource={selectedSource}
            saveEnabled={complete}
            sample={sample}
          />
        ) : (
          <EmptyState
            title={
              selectedId ? "Opportunity unavailable" : "Follow the evidence"
            }
          >
            <p>
              {selectedId
                ? "Choose an opportunity from this report."
                : "Select an opportunity to read the need, compare competitors, and inspect its source passages."}
            </p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
export function CoverageDetails({ view }: { view: ResearchView }) {
  const gaps = Array.isArray(view.run.coverageDetails.gaps)
    ? objects(view.run.coverageDetails.gaps)
    : [];
  const errors = view.tasks.filter((task) => task.error_code);
  const streams = view.tasks
    .filter((task) => task.kind === "review_stream")
    .map((task) => {
      const checkpoint = obj(task.checkpoint);
      const snapshots = view.sources.filter(
        (source) => source.kind === "review" && source.task_id === task.id,
      ).length;
      const stopReason = str(checkpoint.stopReason);
      let state = snapshots
        ? `represented (${snapshots} stored review ${snapshots === 1 ? "snapshot" : "snapshots"})`
        : "visited; no stored review snapshots";
      if (task.status === "failed") state = "failed";
      else if (!snapshots && num(checkpoint.pages) === 0)
        state = stopReason ? `not visited (${stopReason})` : "not yet visited";
      else if (stopReason && !["pool_limit", "exhausted"].includes(stopReason))
        state = `stopped (${stopReason})`;
      return {
        id: task.id,
        store: storeLabel(str(checkpoint.store)),
        country: str(checkpoint.country, "Unknown"),
        language: str(checkpoint.language, "Unknown"),
        state,
      };
    });
  return (
    <details className="coverage-details">
      <summary>
        Research coverage
        {view.run.coverage === "gaps"
          ? " · Gaps recorded"
          : " · Scope and source counts"}
      </summary>
      <div className="coverage-body">
        <p className="muted">
          {str(
            view.report?.summary,
            "Results will appear as completed research stages are saved.",
          )}
        </p>
        <p>
          Countries: {strings(view.run.settings.countries).join(", ")} ·{" "}
          {strings(view.run.settings.stores).map(storeLabel).join(" and ")}
        </p>
        <p>
          App listing maximum: {num(view.run.settings.appLimit)} · Review
          selection maximum: {num(view.run.settings.reviewLimit)}
        </p>
        <div className="coverage-streams">
          <p>Requested collection language streams:</p>
          {streams.length ? (
            <ul>
              {streams.map((stream) => (
                <li key={stream.id}>
                  {stream.store} · requested storefront {stream.country} · requested language {stream.language} · {stream.state}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Collection stream details were not recorded.</p>
          )}
        </div>
        {gaps.map((gap, index) => (
          <p key={index}>
            {str(gap.reason, "A requested source was unavailable.")}
          </p>
        ))}
        {!gaps.length && view.run.coverage === "gaps" && (
          <p>
            Some requested sources or verification checks were incomplete.
            Review the individual source and comparison states.
          </p>
        )}
        {errors.map((task) => (
          <p key={task.id}>
            {stageLabelForTask(task.stage)}:{" "}
            {task.error_code === "configuration"
              ? "OpenAI configuration is missing. View Settings, configure the worker, and resume."
              : "A step could not complete. Its unavailable evidence is excluded from conclusions."}
          </p>
        ))}
        {strings(view.report?.limitations).map((limitation, index) => (
          <p key={index}>{limitation}</p>
        ))}
        <p className="field-hint">
          Review identity is still unvalidated for the real store adapters.
          Collected reviews with uncertain identities are preserved but excluded
          from numeric support and AI selection.
        </p>
      </div>
    </details>
  );
}
const stageLabelForTask = (stage: string) =>
  stage.charAt(0).toUpperCase() + stage.slice(1).replaceAll("_", " ");
