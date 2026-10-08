import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AndroidLogoIcon, AppleLogoIcon } from "@phosphor-icons/react/ssr";
import { Form, Link } from "react-router";
import { languageMatchesAny, type JsonObject } from "../../shared/types";
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
import { BookmarkIcon, EmptyState, Notice, Submit } from "./workspace";

export type ResearchView = ReturnType<typeof readResearch>;
export type SourceView = ResearchView["sources"][number];
const OPPORTUNITY_TABS = [
  { id: "assessment", label: "Assessment" },
  { id: "evidence", label: "Evidence" },
  { id: "comparison", label: "Competitors" },
  { id: "apps-coverage", label: "Apps and coverage" },
] as const;
type OpportunityTab = (typeof OPPORTUNITY_TABS)[number]["id"];
function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <span className="info-tip">
      <button
        type="button"
        className="info-tip-trigger"
        aria-label={`About ${label}`}
        aria-describedby={id}
      >
        i
      </button>
      <span id={id} className="info-tooltip" role="tooltip">
        {children}
      </span>
    </span>
  );
}
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
function languageLabel(language: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "language" }).of(language) ??
      language.toUpperCase()
    );
  } catch {
    return language.toUpperCase();
  }
}
function coverageGapLabel(reason: string, count: number): string {
  if (reason === "Not verified: listing has no official website")
    return `${count} app ${count === 1 ? "listing has" : "listings have"} no official website to verify.`;
  if (reason === "five_page_limit")
    return "An official website check stopped at the five-page safety limit.";
  if (
    reason ===
    "Only the 30 batch themes with most distinct source support entered bounded opportunity synthesis; all batch themes remain linked in checkpoints"
  )
    return "Opportunity synthesis used the 30 themes with the strongest source support; lower-support themes were not turned into opportunities.";
  if (reason === "Metadata limit prevented complete counterpart/alternative checks")
    return "The research limit prevented some competitor and alternative checks.";
  if (reason === "Competitor claims could not be validated")
    return "Some competitor claims could not be validated.";
  if (reason === "Combined app functionality summary failed validation")
    return "The combined functionality summary could not be generated; app listings and opportunity evidence remain available.";
  if (
    reason ===
    "Report prose synthesis failed; validated evidence and code-computed assessment retained"
  )
    return "The final prose summary could not be generated; the evidence-backed opportunities and assessments are still available.";
  const readable = reason.replaceAll("_", " ");
  return `${readable.charAt(0).toUpperCase()}${readable.slice(1)}${count > 1 ? ` (${count} occurrences)` : ""}`;
}
function RatingStars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      className="review-rating"
      aria-label={`${rating} out of 5 stars`}
      title={`${rating} out of 5 stars`}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={index < filled ? "star-filled" : "star-empty"}
          aria-hidden="true"
        >
          {index < filled ? "★" : "☆"}
        </span>
      ))}
    </span>
  );
}
export function SourceLink({
  source,
  children,
}: {
  source?: SourceView;
  children?: React.ReactNode;
}) {
  const url = safeUrl(source?.url);
  const label =
    source?.payload.directReviewUrl === true
      ? "Open review"
      : source?.kind === "review"
        ? "Open app listing"
        : "Open source";
  return url ? (
    <a className="external-link" href={url} target="_blank" rel="noreferrer">
      {children ?? label}
      <span className="external-link-icon" aria-hidden="true">
        ↗
      </span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <span className="muted">No source URL captured</span>
  );
}
function PrioritySignal({ priority }: { priority: number }) {
  const level = { 1: "High", 2: "Medium", 3: "Low" }[priority];
  const activeBars = { 1: 3, 2: 2, 3: 1 }[priority] ?? 0;
  const label = level ?? "Unassessed";
  return (
    <span
      className={`priority-signal priority-${label.toLowerCase()}`}
      aria-label={`${label} priority`}
    >
      <span className="priority-bars" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <i key={index} className={index < activeBars ? "active" : ""} />
        ))}
      </span>
      <span>{label} priority</span>
    </span>
  );
}
function ConfidenceSignal({ confidence }: { confidence: string }) {
  const normalized = confidence.toLowerCase();
  const level = ["high", "medium", "low"].includes(normalized)
    ? normalized
    : "unassessed";
  const label = level.charAt(0).toUpperCase() + level.slice(1);
  return (
    <span
      className={`confidence-signal confidence-${level}`}
      aria-label={`${label} confidence`}
      title={`${label} confidence`}
    >
      <span className="confidence-mark" aria-hidden="true" />
      <span>{label} confidence</span>
    </span>
  );
}
function DirectionSignal({ direction }: { direction: string }) {
  if (!direction) return null;
  const android = <AndroidLogoIcon aria-hidden="true" size={14} weight="regular" />;
  const ios = <AppleLogoIcon aria-hidden="true" size={14} weight="regular" />;
  if (direction === "android_to_ios")
    return (
      <span className="direction-signal" title="Android to iOS">
        {android}
        <span>Android</span>
        <span>→</span>
        {ios}
        <span>iOS</span>
      </span>
    );
  if (direction === "ios_to_android")
    return (
      <span className="direction-signal" title="iOS to Android">
        {ios}
        <span>iOS</span>
        <span>→</span>
        {android}
        <span>Android</span>
      </span>
    );
  return (
    <span className="direction-signal" title="Both directions">
      {android}
      {ios}
      <span>Both directions</span>
    </span>
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
      <div className="row-labels">
        <PrioritySignal priority={num(opportunity.priority)} />
        <ConfidenceSignal
          confidence={str(opportunity.confidence, "Unassessed")}
        />
      </div>
      <div className="row-overline">
        <span>
          {count !== undefined
            ? `${num(count)} supporting reviews`
            : "Preliminary evidence"}
        </span>
        <DirectionSignal direction={str(opportunity.direction)} />
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
  counter,
  appTitle,
  spokenLanguages,
}: {
  source: SourceView;
  findings: JsonObject[];
  counter: boolean;
  appTitle: string;
  spokenLanguages: string[];
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
  const sourceFindings = findings.filter(
    (candidate) => str(candidate.sourceId) === source.id,
  );
  const originalLanguage = str(sourceFindings[0]?.originalLanguage);
  const translations = new Map<string, string>();
  const uncertainties = new Set<string>();
  for (const finding of sourceFindings) {
    const translation = str(obj(finding.translation).text);
    const translationLanguage = str(obj(finding.translation).language);
    if (
      translation &&
      translationLanguage &&
      finding.translationScope === "full_review" &&
      !languageMatchesAny(originalLanguage, spokenLanguages) &&
      languageMatchesAny(translationLanguage, spokenLanguages)
    ) {
      translations.set(translation, translationLanguage);
    }
    for (const uncertainty of strings(finding.uncertainty)) {
      uncertainties.add(uncertainty);
    }
  }
  return (
    <article
      id={sourceAnchor(source.id)}
      className="evidence-passage"
      tabIndex={-1}
      aria-label={`${counter ? "Counterevidence" : "Evidence"} from ${appTitle}`}
    >
      <div className="evidence-header">
        <div className="source-heading">
          <span className="source-kind">
            {counter ? "Counterevidence" : provenance}
          </span>
          <SourceLink source={source} />
        </div>
        <h3>{appTitle}</h3>
        <div className="review-meta" aria-label="Source details">
          <span className="review-store">{storeLabel(source.store)}</span>
          {typeof source.payload.rating === "number" && (
            <RatingStars rating={source.payload.rating} />
          )}
          <span>
            <span className="review-meta-label">Review</span>{" "}
            {date(str(source.payload.date) || null)}
          </span>
          <span>
            <span className="review-meta-label">Captured</span>{" "}
            {date(source.captured_at)}
          </span>
        </div>
        <p className="metadata">
          Requested storefront: {locale.requestedCountry} · Requested language:{" "}
          {locale.requestedLanguage} · Detected language: {locale.detectedLanguage}
        </p>
      </div>
      <div className="evidence-body">
        <blockquote dir="auto">
          {body || "No text passage was captured."}
        </blockquote>
        {translations.size > 0 && (
          <div className="translation">
            {[...translations].map(([translation, language]) => (
              <div key={translation}>
                <span className="metadata">
                  {`Translation · ${languageLabel(language)}`}
                </span>
                <p>{translation}</p>
              </div>
            ))}
          </div>
        )}
        {uncertainties.size > 0 && (
          <aside className="evidence-uncertainty" aria-label="Uncertainty">
            <span>Uncertainty</span>
            <p>{[...uncertainties].join(" ")}</p>
          </aside>
        )}
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
  saved = false,
  sample = false,
  spokenLanguages = ["en"],
}: {
  opportunity: JsonObject & { id: string };
  sources: SourceView[];
  base: string;
  selectedSource?: string | null;
  saveEnabled?: boolean;
  saved?: boolean;
  sample?: boolean;
  spokenLanguages?: string[];
}) {
  const [activeTab, setActiveTab] = useState<OpportunityTab>(() =>
    selectedSource ? "evidence" : "assessment",
  );
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const verification = obj(opportunity.verification);
  const counts = obj(opportunity.counts);
  const confidence = str(opportunity.confidence, "Unassessed");
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
  useEffect(() => {
    setActiveTab(selectedSource ? "evidence" : "assessment");
  }, [opportunity.id, selectedSource]);
  useEffect(() => {
    if (!selectedSource) return;
    if (activeTab !== "evidence") return;
    const frame = requestAnimationFrame(() =>
      document
        .getElementById(sourceAnchor(selectedSource))
        ?.scrollIntoView({ block: "start" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [activeTab, selectedSource, opportunity.id]);
  const selectTab = (tab: OpportunityTab) => setActiveTab(tab);
  const moveTabFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight")
      nextIndex = (index + 1) % OPPORTUNITY_TABS.length;
    else if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + OPPORTUNITY_TABS.length) % OPPORTUNITY_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = OPPORTUNITY_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = OPPORTUNITY_TABS[nextIndex];
    selectTab(next.id);
    tabRefs.current[nextIndex]?.focus();
  };
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
              value={saved ? "unsave" : "save"}
              disabled={!saved && !saveEnabled}
              aria-label={saved ? "Remove from saved opportunities" : "Save opportunity"}
            >
              <BookmarkIcon filled={saved} />
              {saved ? "Saved" : "Save opportunity"}
            </Submit>
          </Form>
        )}
      </div>
      <p className="eyebrow">App concept</p>
      <p className="report-prose">{str(opportunity.concept, str(opportunity.need))}</p>
      {strings(opportunity.coreFeatures).length > 0 && (
        <section className="concept-brief" aria-labelledby="concept-core-features">
          <h3 id="concept-core-features">What it should do</h3>
          <ul className="plain-list">
            {strings(opportunity.coreFeatures).map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </section>
      )}
      {strings(opportunity.differentiators).length > 0 && (
        <section className="concept-brief" aria-labelledby="concept-differentiators">
          <h3 id="concept-differentiators">How it should beat the competition</h3>
          <ul className="plain-list">
            {strings(opportunity.differentiators).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
      {strings(opportunity.executionPriorities).length > 0 && (
        <section className="concept-brief" aria-labelledby="concept-execution">
          <h3 id="concept-execution">Execution priorities</h3>
          <ul className="plain-list">
            {strings(opportunity.executionPriorities).map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>
      )}
      {str(opportunity.competitorPattern) && (
        <dl className="audience">
          <dt>Observed competitor gap</dt>
          <dd>{str(opportunity.competitorPattern)}</dd>
        </dl>
      )}
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
      <nav className="detail-nav" aria-label="Opportunity sections" role="tablist">
        {OPPORTUNITY_TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => {
              tabRefs.current[index] = element;
            }}
            id={`opportunity-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`opportunity-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => moveTabFocus(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <section
        id="opportunity-panel-assessment"
        className="detail-section"
        role="tabpanel"
        aria-labelledby="opportunity-tab-assessment"
        hidden={activeTab !== "assessment"}
      >
        <h3 className="info-heading">
          How strong is this opportunity?
          <InfoTip label="the opportunity assessment">
            Priority suggests what to investigate first. Evidence confidence
            describes how strongly the collected reviews and verification checks
            support this opportunity.
          </InfoTip>
        </h3>
        <div className="assessment-grid">
          <div>
            <p className="assessment-label">
              {{ 1: "High", 2: "Medium", 3: "Low" }[
                num(opportunity.priority)
              ] ?? "Unassessed"}{" "}
              investigation priority
              <InfoTip label="investigation priority">
                This orders opportunities for further research. High requires
                strong evidence confidence and severe reported impact; conflicting
                evidence lowers the priority.
              </InfoTip>
            </p>
            <ul className="plain-list">
              {strings(opportunity.priorityReasons).map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="assessment-label">
              {confidence.charAt(0).toUpperCase() + confidence.slice(1)} confidence
              <InfoTip label="evidence confidence">
                This measures the strength of the evidence using distinct and
                recent reviews, represented products and developers, valid source
                links, and completed verification checks.
              </InfoTip>
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
        <p className="metadata assessment-basis">
          {num(counts.supportingReviews).toLocaleString("en")} source-linked{" "}
          {num(counts.supportingReviews) === 1 ? "review supports" : "reviews support"}{" "}
          this opportunity · {num(opportunity.denominator).toLocaleString("en")} reviews
          analyzed overall · Verification: {str(opportunity.status, "Preliminary")}
          <InfoTip label="verification status">
            A supporting review is a captured source directly linked to this
            opportunity. Verification also checks whether citations and competitor
            claims could be confirmed. A partial result means at least one required
            check or source was unavailable.
          </InfoTip>
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
      <section
        id="opportunity-panel-evidence"
        className="detail-section"
        role="tabpanel"
        aria-labelledby="opportunity-tab-evidence"
        hidden={activeTab !== "evidence"}
      >
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
                counter={counterIds.includes(source.id)}
                appTitle={str(
                  listing?.payload.title,
                  str(source.payload.title, source.app_id ?? "Website passage"),
                )}
                spokenLanguages={spokenLanguages}
              />
            );
          })
        ) : (
          <Notice title="Source passages unavailable">
            <p>This preliminary result does not have readable passages yet.</p>
          </Notice>
        )}
      </section>
      <section
        id="opportunity-panel-comparison"
        className="detail-section"
        role="tabpanel"
        aria-labelledby="opportunity-tab-comparison"
        hidden={activeTab !== "comparison"}
      >
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
      <section
        id="opportunity-panel-apps-coverage"
        className="detail-section"
        role="tabpanel"
        aria-labelledby="opportunity-tab-apps-coverage"
        hidden={activeTab !== "apps-coverage"}
      >
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
  savedOpportunityIds = [],
  sample = false,
  spokenLanguages = ["en"],
}: {
  opportunities: Array<JsonObject & { id: string }>;
  sources: SourceView[];
  base: string;
  selectedId?: string | null;
  selectedSource?: string | null;
  complete: boolean;
  savedOpportunityIds?: string[];
  sample?: boolean;
  spokenLanguages?: string[];
}) {
  const [search, setSearch] = useState("");
  const selected = opportunities.find((item) => item.id === selectedId);
  const filtered = opportunities.filter((item) =>
    `${str(item.title)} ${str(item.concept)} ${str(item.need)} ${strings(item.coreFeatures).join(" ")}`
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
            saved={savedOpportunityIds.includes(selected.id)}
            sample={sample}
            spokenLanguages={spokenLanguages}
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

export function MarketOverview({ report }: { report?: JsonObject | null }) {
  const overview = obj(report?.marketOverview);
  const common = objects(overview.commonCapabilities);
  const specialized = objects(overview.specializedCapabilities);
  const workflow = strings(overview.sharedWorkflow);
  if (!str(overview.coreProblem) && !common.length && !specialized.length) return null;
  const capabilityList = (items: JsonObject[]) => (
    <ul className="market-capability-list">
      {items.map((capability, index) => {
        const support = new Set(strings(capability.sourceIds)).size;
        return (
          <li key={`${str(capability.name)}-${index}`}>
            <h3>{str(capability.name, "Unnamed capability")}</h3>
            <p>{str(capability.description)}</p>
            <span className="metadata">
              Supported by {support} researched app {support === 1 ? "listing" : "listings"}
            </span>
          </li>
        );
      })}
    </ul>
  );
  return (
    <section className="market-overview" aria-labelledby="market-overview-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Current app landscape</p>
          <h2 id="market-overview-title">What apps in this niche currently do</h2>
        </div>
        <span className="metadata">{num(overview.appCount)} apps combined</span>
      </div>
      <p className="market-core-problem">{str(overview.coreProblem)}</p>
      {workflow.length > 0 && (
        <div className="market-workflow">
          <h3>Typical workflow</h3>
          <ol>{workflow.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>
      )}
      <div className="market-capability-columns">
        <section>
          <h3>Common functionality</h3>
          <p className="metadata">The baseline repeatedly documented across the cohort.</p>
          {capabilityList(common)}
        </section>
        {specialized.length > 0 && (
          <section>
            <h3>Functionality only some apps offer</h3>
            <p className="metadata">Meaningful variations that are not yet the shared baseline.</p>
            {capabilityList(specialized)}
          </section>
        )}
      </div>
      <div className="market-comparison-summary">
        <span className="eyebrow">Baseline for the app suggestions</span>
        <p>{str(overview.comparisonSummary)}</p>
      </div>
    </section>
  );
}

export function ExploreLead({ report }: { report?: JsonObject | null }) {
  const lead = obj(report?.exploration);
  if (!str(lead.title)) return null;
  return (
    <section className="explore-lead" aria-labelledby="explore-lead-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Explore result</p>
          <h2 id="explore-lead-title">{str(lead.title)}</h2>
        </div>
        <span className="metadata">Promising niche lead · not market proof</span>
      </div>
      <p className="explore-problem">{str(lead.problem)}</p>
      <dl className="explore-facts">
        <div><dt>Audience</dt><dd>{str(lead.audience)}</dd></div>
        <div><dt>Competition signal</dt><dd>{str(lead.saturationSignal)}</dd></div>
        <div><dt>Observed apps</dt><dd>{num(lead.observedAppCount)}</dd></div>
        <div><dt>Observed developers</dt><dd>{num(lead.observedDeveloperCount)}</dd></div>
      </dl>
      <div className="explore-rationale">
        <h3>Why it was selected</h3>
        <p>{str(lead.whyPromising)}</p>
      </div>
      {strings(lead.uncertainty).length > 0 && (
        <Notice title="What Explore cannot establish">
          <ul className="plain-list">{strings(lead.uncertainty).map((item) => <li key={item}>{item}</li>)}</ul>
        </Notice>
      )}
    </section>
  );
}
const TRANSFER_STATE: Record<string, { label: string; tone: string }> = {
  open: { label: "No local alternative found", tone: "success" },
  unscreened: { label: "Alternatives not screened", tone: "attention" },
  incomplete: { label: "Search incomplete", tone: "attention" },
  not_searched: { label: "Alternatives not searched", tone: "" },
  unchecked: { label: "Absence not confirmed", tone: "attention" },
  alternatives: { label: "Local alternatives exist", tone: "" },
  regional_variant: { label: "Possible regional variant", tone: "" },
  same_listing: { label: "Availability unreliable", tone: "attention" },
};
export function TransferLeads({ report }: { report?: JsonObject | null }) {
  const transfer = obj(report?.transfer);
  if (!str(transfer.targetCountry)) return null;
  const leads = objects(transfer.leads);
  const source = str(transfer.sourceCountry);
  const target = str(transfer.targetCountry);
  const listings = (title: string, items: JsonObject[]) =>
    items.length > 0 && (
      <p className="metadata">
        {title}:{" "}
        {items.map((item, index) => (
          <span key={str(item.id)}>
            {index > 0 && " · "}
            {safeUrl(str(item.url)) ? (
              <a href={safeUrl(str(item.url))} target="_blank" rel="noreferrer">
                {str(item.title, str(item.appId))}
              </a>
            ) : (
              str(item.title, str(item.appId))
            )}
          </span>
        ))}
      </p>
    );
  return (
    <section className="explore-lead" aria-labelledby="transfer-leads-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Market transfer</p>
          <h2 id="transfer-leads-title">
            {`${source} apps not found in the ${target} storefront`}
          </h2>
        </div>
        <span className="metadata">
          {num(transfer.found) > leads.length
            ? `${leads.length} of ${num(transfer.found)} leads listed · not market proof`
            : "Leads to investigate · not market proof"}
        </span>
      </div>
      <dl className="explore-facts transfer-facts">
        <div><dt>Apps checked</dt><dd>{num(transfer.checked)}</dd></div>
        <div><dt>Already in {target}</dt><dd>{num(transfer.available)}</dd></div>
        <div><dt>Not found in {target}</dt><dd>{num(transfer.unavailable)}</dd></div>
        <div><dt>Tied to {source} only</dt><dd>{num(transfer.marketSpecific)}</dd></div>
      </dl>
      {leads.length ? (
        <ol className="transfer-list">
          {leads.map((lead) => {
            const check = obj(lead.check);
            const state = TRANSFER_STATE[str(lead.state, str(check.state))] ?? TRANSFER_STATE.incomplete;
            const url = safeUrl(str(lead.url));
            return (
              <li key={str(lead.key)}>
                <div className="transfer-heading">
                  <h3>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">{str(lead.title)}</a>
                    ) : (
                      str(lead.title)
                    )}
                  </h3>
                  <span className={`badge ${state.tone}`}>{state.label}</span>
                </div>
                <p className="metadata">
                  {[
                    storeLabel(str(lead.store)),
                    str(lead.developer),
                    str(lead.category),
                    typeof lead.ratingTotal === "number"
                      ? `${lead.ratingTotal.toLocaleString("en")} ${source} ratings`
                      : "",
                    str(lead.released) ? `Released ${date(str(lead.released))}` : "",
                    lead.availability === "unavailable" && typeof lead.availabilityCheckedAt === "number"
                      ? `Not found in ${target} on ${date(lead.availabilityCheckedAt)}`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p>{str(lead.coreFunctionality) || str(lead.reason)}</p>
                {str(lead.coreFunctionality) && (
                  <p className="muted">{str(lead.reason)}</p>
                )}
                {str(check.conclusion) && <p className="muted">{str(check.conclusion)}.</p>}
                {listings("Same name or developer", objects(check.regionalVariants))}
                {listings(`Alternatives in ${target}`, objects(check.alternatives))}
                {listings("Not screened", objects(check.unscreened))}
                {strings(lead.barriers).length > 0 && (
                  <details>
                    <summary>Possible reasons it is absent</summary>
                    <ul className="plain-list">
                      {strings(lead.barriers).map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </details>
                )}
                {objects(check.queries).length > 0 && (
                  <details>
                    <summary>Searches run in {target}</summary>
                    <ul className="plain-list">
                      {objects(check.queries).map((query, index) => (
                        <li key={index}>
                          {str(query.kind) === "same_product" ? "Same product" : "Same job"}: “{str(query.query)}”
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <Notice title="No transfer leads in this sample">
          <p>
            Every sampled app was already listed in {target}, tied to {source},
            or could not be checked. Try other categories or a deeper run.
          </p>
        </Notice>
      )}
      <Notice title="What this check cannot establish">
        <ul className="plain-list">
          <li>Absence is tested by app ID in one storefront; a renamed local edition or a web-only competitor would not be detected.</li>
          <li>A Google Play listing can be visible in {target} without being installable there, so some gaps may be missed.</li>
          <li>Store searches are bounded samples. They cannot show demand, market size, or that no competitor exists.</li>
        </ul>
      </Notice>
    </section>
  );
}
const IDEA_VERDICT: Record<string, { label: string; tone: string }> = {
  none_reported: { label: "No local equivalent reported", tone: "success" },
  equivalent_unconfirmed: { label: "Equivalent reported, unconfirmed", tone: "attention" },
  not_researched: { label: "Target market not researched", tone: "" },
  reported_present: { label: "Reported as already present", tone: "" },
  equivalent_confirmed: { label: "Local equivalent confirmed", tone: "" },
};
const IDEA_STATUS: Record<string, string> = {
  no_sources: "None of the pasted sources could be read, so nothing below is verified.",
  not_profiled: "Sources were fetched but not analysed. The description is the pasted claim.",
  fetched: "Sources were fetched but not analysed. The description is the pasted claim.",
  failed: "The analysis failed source validation. The description is the pasted claim.",
  pending: "This idea was not processed.",
};
export function BusinessIdeas({ report }: { report?: JsonObject | null }) {
  const ideas = obj(report?.ideas);
  if (!str(ideas.targetCountry)) return null;
  const source = str(ideas.sourceCountry);
  const target = str(ideas.targetCountry);
  const leads = objects(ideas.leads);
  const link = (url: string, label: string) =>
    safeUrl(url) ? (
      <a href={safeUrl(url)} target="_blank" rel="noreferrer">{label}</a>
    ) : (
      label
    );
  const fact = (label: string, value: string) =>
    value && (
      <p>
        <strong>{label}:</strong> {value}
      </p>
    );
  return (
    <section className="explore-lead" aria-labelledby="business-ideas-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Business ideas</p>
          <h2 id="business-ideas-title">{`${source} businesses to consider for ${target}`}</h2>
        </div>
        <span className="metadata">From your pasted research · not market proof</span>
      </div>
      <ol className="transfer-list">
        {leads.map((lead) => {
          const profile = obj(lead.profile);
          const market = obj(lead.market);
          const verdict = IDEA_VERDICT[str(market.verdict, "not_researched")] ?? IDEA_VERDICT.not_researched;
          const profiled = str(lead.status) === "profiled";
          return (
            <li key={str(lead.id)}>
              <div className="transfer-heading">
                <h3>{link(str(lead.officialUrl), str(lead.name))}</h3>
                <span className={`badge ${verdict.tone}`}>{verdict.label}</span>
              </div>
              {profiled ? (
                <>
                  <p>{str(profile.whatItIs)}</p>
                  {fact("Customer", str(profile.customer))}
                  <ol className="idea-steps">
                    {strings(profile.howItWorks).map((step) => <li key={step}>{step}</li>)}
                  </ol>
                  {fact("Revenue model", str(profile.revenueModel))}
                  {fact("Pricing", str(profile.pricing))}
                  {fact("Traction", str(profile.traction))}
                  {fact(`Dependence on ${source}`, `${str(profile.sourceMarketDependence).replace("_", " ")} — ${str(profile.dependenceReason)}`)}
                </>
              ) : (
                <>
                  <p>{str(lead.summary) || "No description was pasted."}</p>
                  <p className="muted">{IDEA_STATUS[str(lead.status)] ?? IDEA_STATUS.pending}</p>
                </>
              )}
              {str(market.note) && <p className="muted">Pasted finding for {target}: {str(market.note)}</p>}
              {objects(market.equivalents).length > 0 && (
                <ul className="plain-list">
                  {objects(market.equivalents).map((equivalent, index) => (
                    <li key={index}>
                      {link(str(equivalent.url), str(equivalent.name))} ·{" "}
                      {str(equivalent.fit) === "core"
                        ? "confirmed from its page as the same job"
                        : str(equivalent.fit)
                          ? "its page describes a different job"
                          : "not confirmed from its page"}
                      {str(equivalent.reason) && ` — ${str(equivalent.reason)}`}
                    </li>
                  ))}
                </ul>
              )}
              {profiled && objects(profile.evidence).length > 0 && (
                <details>
                  <summary>Quoted evidence</summary>
                  {objects(profile.evidence).map((item, index) => (
                    <blockquote className="idea-evidence" key={index}>
                      “{str(item.excerpt)}” — {link(str(item.url), "source")}
                    </blockquote>
                  ))}
                </details>
              )}
              {profiled && strings(profile.barriers).length + strings(profile.uncertainty).length > 0 && (
                <details>
                  <summary>Possible barriers and open questions</summary>
                  <ul className="plain-list">
                    {[...strings(profile.barriers), ...strings(profile.uncertainty)].map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </details>
              )}
              {objects(lead.failures).length > 0 && (
                <p className="metadata">
                  {objects(lead.failures).length} pasted {objects(lead.failures).length === 1 ? "source" : "sources"} could not be read.
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <Notice title="What this cannot establish">
        <ul className="plain-list">
          <li>The list of ideas and every target-market finding come from research you ran elsewhere. Lacuna only verified what the fetched pages say.</li>
          <li>“No local equivalent reported” means the pasted research named none. Lacuna cannot tell how thorough that search was.</li>
          <li>Company pages describe themselves favourably. Nothing here shows demand, market size or legal feasibility in {target}.</li>
        </ul>
      </Notice>
    </section>
  );
}
export function CoverageDetails({ view }: { view: ResearchView }) {
  const gaps = Array.isArray(view.run.coverageDetails.gaps)
    ? objects(view.run.coverageDetails.gaps)
    : [];
  const requestedCountries = strings(view.run.settings.countries);
  const requestedStores = strings(view.run.settings.stores);
  const reportCounts = obj(view.report?.counts);
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
        represented: snapshots > 0,
      };
    });
  const representedCountries = new Set(
    streams.filter((stream) => stream.represented).map((stream) => stream.country),
  );
  const collectedReviews = view.sources.filter(
    (source) => source.kind === "review",
  ).length;
  const collectedCount = num(reportCounts.collected) || collectedReviews;
  const analyzedCount = num(reportCounts.analyzed);
  const outsideAnalysisCount = Math.max(0, collectedCount - analyzedCount);
  const gapCounts = gaps.reduce((counts, gap) => {
    const reason = str(gap.reason, "A requested source was unavailable.");
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const summarizedGaps = [...gapCounts.entries()];
  const issueCount = summarizedGaps.length + errors.length;
  const limitations = strings(view.report?.limitations);
  return (
    <details className="coverage-details">
      <summary>
        Research coverage · {representedCountries.size} of{" "}
        {requestedCountries.length} markets represented
        {issueCount
          ? ` · ${issueCount} ${issueCount === 1 ? "caveat" : "caveats"}`
          : ""}
      </summary>
      <div className="coverage-body">
        <p className="coverage-explanation">
          {issueCount
            ? "Some requested evidence was unavailable. The report excludes it from its conclusions."
            : "The requested markets and stores are represented in the evidence used by this report."}
        </p>
        <dl className="coverage-metrics">
          <div>
            <dt>Markets with reviews</dt>
            <dd>
              {representedCountries.size} <span>of {requestedCountries.length}</span>
            </dd>
          </div>
          <div>
            <dt>Outside analysis sample</dt>
            <dd>{outsideAnalysisCount}</dd>
          </div>
          <div>
            <dt>Reviews collected</dt>
            <dd>{collectedCount}</dd>
          </div>
          <div>
            <dt>Successfully analyzed</dt>
            <dd>{analyzedCount}</dd>
          </div>
        </dl>
        {issueCount > 0 && (
          <section className="coverage-issues" aria-labelledby="coverage-issues-title">
            <h3 id="coverage-issues-title">What is missing</h3>
            <ul>
              {summarizedGaps.map(([reason, count]) => (
                <li key={reason}>
                  {coverageGapLabel(reason, count)}
                </li>
              ))}
              {errors.map((task) => (
                <li key={task.id}>
                  {stageLabelForTask(task.stage)}:{" "}
                  {task.error_code === "configuration"
                    ? "OpenAI configuration was missing, so this step could not run."
                    : "This step did not complete, and its unavailable evidence was excluded."}
                </li>
              ))}
            </ul>
          </section>
        )}
        {!gaps.length && view.run.coverage === "gaps" && (
          <p className="coverage-warning">
            Some requested sources or verification checks were incomplete.
            Review the individual source and comparison states.
          </p>
        )}
        {limitations.length > 0 && (
          <section className="coverage-limitations">
            <h3>Limits to this report</h3>
            <ul>
              {limitations.map((limitation, index) => (
                <li key={index}>{limitation}</li>
              ))}
            </ul>
          </section>
        )}
        <details className="coverage-technical">
          <summary>Collection details ({streams.length} app-market sources)</summary>
          <p>
            Requested markets: {requestedCountries.join(", ")} · Stores:{" "}
            {requestedStores.map(storeLabel).join(" and ")}
          </p>
          <p>
            Apps reviewed maximum: {num(view.run.input?.mode === "explore" ? view.run.settings.exploreAppLimit : view.run.settings.appLimit)} · Explore
            discovery pool: {num(view.run.settings.discoveryLimit)} · Review
            selection maximum: {num(view.run.settings.reviewLimit)}
          </p>
          {streams.length ? (
            <ul>
              {streams.map((stream) => (
                <li key={stream.id}>
                  {stream.store} · {stream.country} · {stream.language} · {stream.state}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Collection details were not recorded.</p>
          )}
          <p className="field-hint">
            Review identity is still unvalidated for the real store adapters.
            Collected reviews with uncertain identities are preserved but excluded
            from numeric support and AI selection.
          </p>
        </details>
      </div>
    </details>
  );
}
const stageLabelForTask = (stage: string) =>
  stage.charAt(0).toUpperCase() + stage.slice(1).replaceAll("_", " ");
