import { useEffect, useRef, useState, useId, type KeyboardEvent, type ReactNode } from "react";
import {
  Form,
  Link,
  NavLink,
  isRouteErrorResponse,
  useNavigation,
  useRouteError,
  useLocation,
} from "react-router";
import {
  date,
  isActive,
  money,
  runLabel,
  stageLabel,
  type ActionResult,
} from "../lib/workspace";

export function Shell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const researchActive =
    location.pathname === "/" || location.pathname.startsWith("/research/");
  const [open, setOpen] = useState(false);
  return (
    <div className="workspace">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand-row">
          <Link className="brand" to="/" aria-label="Lacuna research home">
            <span className="brand-symbol" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 5v14h14" />
                <path d="M9 5v10h10" />
                <path d="M13 5v6h6" />
              </svg>
            </span>
            Lacuna
          </Link>
          <button
            className="mobile-menu"
            aria-expanded={open}
            aria-controls="main-navigation"
            aria-label="Toggle navigation"
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden="true">{open ? "Close" : "Menu"}</span>
          </button>
        </div>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          className={open ? "nav-open" : ""}
        >
          <NavLink
            to="/"
            end
            className={researchActive ? "active" : undefined}
            aria-current={researchActive ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            <NavGlyph kind="research" />
            Research
          </NavLink>
          <NavLink to="/saved" onClick={() => setOpen(false)}>
            <NavGlyph kind="saved" />
            Saved opportunities
          </NavLink>
          <NavLink to="/settings" onClick={() => setOpen(false)}>
            <NavGlyph kind="settings" />
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <span className="local-dot" />
          Local workspace<p>Evidence before assumptions.</p>
          {import.meta.env.DEV && (
            <Link to="/reference">Component reference</Link>
          )}
        </div>
      </aside>
      <main id="main-content" className="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
function NavGlyph({ kind }: { kind: string }) {
  if (kind === "saved") return <BookmarkIcon />;
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {kind === "research" ? (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 9h8M8 13h8M8 17h4" />
        </>
      ) : (
        <>
          <path d="M4 7h16M4 17h16" />
          <circle cx="9" cy="7" r="3" fill="var(--surface)" />
          <circle cx="15" cy="17" r="3" fill="var(--surface)" />
        </>
      )}
    </svg>
  );
}
export function BookmarkIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg
      className={`bookmark-icon ${filled ? "filled" : ""}`}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 4h12v17l-6-4-6 4V4Z" />
    </svg>
  );
}
export function PageHeader({
  title,
  eyebrow,
  children,
  description,
}: {
  title: string;
  eyebrow?: string;
  children?: ReactNode;
  description?: string;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="muted page-description">{description}</p>}
      </div>
      {children && <div className="header-actions">{children}</div>}
    </header>
  );
}
export function EmptyState({
  title,
  children,
  action,
  compact = false,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "compact" : ""}`}>
      <span className="empty-mark" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="24"
          height="24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M5 4h14v16H5zM8 8h8M8 12h5" />
        </svg>
      </span>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
      {action}
    </div>
  );
}
export function Notice({
  title,
  children,
  tone = "attention",
}: {
  title: string;
  children?: ReactNode;
  tone?: "attention" | "error" | "success" | "neutral";
}) {
  return (
    <div className={`notice ${tone}`}>
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}
export function ActionFeedback({ result }: { result?: ActionResult }) {
  useEffect(() => {
    if (!result?.errors) return;
    const field = Object.keys(result.errors).find((name) => name !== "form");
    const element =
      (field
        ? document.getElementById(field) ??
          document.getElementById(`${field}-${result.values?.id ?? ""}`)
        : null) ?? document.querySelector<HTMLElement>("[data-action-error]");
    element?.focus();
  }, [result]);
  if (result?.errors)
    return (
      <div
        role="alert"
        className="notice error"
        data-action-error
        tabIndex={-1}
      >
        <strong>{result.errors.form ?? "Check the highlighted fields."}</strong>
      </div>
    );
  return result?.ok ? (
    <p className="action-success" role="status">
      {result.intent === "save"
        ? "Opportunity saved. Find it in Saved opportunities."
        : result.intent === "settings"
          ? "Settings saved."
          : result.intent === "update_saved"
            ? "Notes and status saved."
            : "Changes saved."}
    </p>
  ) : null;
}
export function FieldError({
  name,
  result,
}: {
  name: string;
  result?: ActionResult;
}) {
  return result?.errors?.[name] ? (
    <p className="field-error" id={`${name}-error`}>
      {result.errors[name]}
    </p>
  ) : null;
}
export function fieldA11y(
  name: string,
  result?: ActionResult,
  describedBy?: string,
) {
  const errorId = result?.errors?.[name] ? `${name}-error` : undefined;
  return {
    "aria-invalid": errorId ? (true as const) : undefined,
    "aria-describedby": [describedBy, errorId].filter(Boolean).join(" ") || undefined,
  };
}
export type SelectOption = { value: string; label: string };
export function SelectMenu({
  id,
  label,
  name,
  options,
  value,
  defaultValue,
  onValueChange,
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  label: string;
  name?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? options[0]?.value ?? "",
  );
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const valueInput = useRef<HTMLInputElement>(null);
  const optionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const controlled = value !== undefined;
  const selectedValue = controlled ? value : uncontrolledValue;
  const selectedIndex = Math.max(
    options.findIndex((option) => option.value === selectedValue),
    0,
  );
  const selected = options[selectedIndex];
  const listboxId = `${id}-options`;
  useEffect(() => {
    if (!controlled && defaultValue !== undefined) setUncontrolledValue(defaultValue);
  }, [controlled, defaultValue]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const choose = (nextValue: string) => {
    if (!controlled) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
    setOpen(false);
    trigger.current?.focus();
    requestAnimationFrame(() =>
      valueInput.current?.dispatchEvent(new Event("change", { bubbles: true })),
    );
  };
  const focusOption = (index: number) => {
    setOpen(true);
    requestAnimationFrame(() => optionButtons.current[index]?.focus());
  };
  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(Math.min(selectedIndex + 1, options.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(Math.max(selectedIndex - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(options.length - 1);
    }
  };
  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      optionButtons.current[Math.min(index + 1, options.length - 1)]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      optionButtons.current[Math.max(index - 1, 0)]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      optionButtons.current[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      optionButtons.current[options.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  };
  return (
    <div className={`select-menu ${className ?? ""}`.trim()} ref={root}>
      <label className="select-menu-label" htmlFor={id}>
        {label}
      </label>
      {name && <input ref={valueInput} type="hidden" name={name} value={selectedValue} />}
      <button
        ref={trigger}
        id={id}
        type="button"
        className="select-menu-trigger"
        aria-label={`${label}: ${selected?.label ?? ""}`}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selected?.label}</span>
      </button>
      {open && (
        <div className="select-menu-options" id={listboxId} role="listbox">
          {options.map((option, index) => (
            <button
              key={option.value}
              ref={(element) => {
                optionButtons.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.value === selectedValue}
              className={option.value === selectedValue ? "selected" : undefined}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
export function ChipPicker({
  id,
  label,
  name,
  options,
  selected,
  onChange,
  description,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: {
  id: string;
  label: string;
  name: string;
  options: SelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  description?: ReactNode;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const toggle = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((item) => item !== value)
      : [...selected, value];
    onChange(next);
    requestAnimationFrame(() =>
      input.current?.dispatchEvent(new Event("change", { bubbles: true })),
    );
  };
  return (
    <fieldset
      className="chip-picker"
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    >
      <legend>{label}</legend>
      <input ref={input} id={id} type="hidden" name={name} value={selected.join(", ")} />
      <div className="chip-picker-options">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={active ? "selected" : undefined}
              role="checkbox"
              aria-checked={active}
              onClick={() => toggle(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {description && <p className="field-hint">{description}</p>}
    </fieldset>
  );
}
export function Submit({
  children,
  secondary = false,
  name,
  value,
  disabled = false,
}: {
  children: ReactNode;
  secondary?: boolean;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const navigation = useNavigation();
  return (
    <button
      type="submit"
      className={secondary ? "button secondary" : "button primary"}
      name={name}
      value={value}
      disabled={disabled || navigation.state === "submitting"}
    >
      {children}
    </button>
  );
}
export function RunBadge({
  run,
  worker,
}: {
  run: { status: string; reason: string | null; coverage?: string };
  worker?: string;
}) {
  return (
    <span
      className={`badge ${run.status === "completed" && run.coverage !== "gaps" ? "success" : run.status === "paused" || run.coverage === "gaps" || worker === "not_responding" ? "attention" : ""}`}
    >
      <span className="status-dot" aria-hidden="true" />
      {runLabel(run, worker)}
    </span>
  );
}
export function WorkerNotice({ worker }: { worker: string }) {
  return worker === "running" ? null : (
    <Notice
      title={
        worker === "not_responding"
          ? "Worker not responding"
          : "Worker not running"
      }
    >
      <p>
        {worker === "not_responding"
          ? "The background research process has stopped reporting. Check its terminal and restart it if it has stopped. Interrupted work can then be resumed."
          : "Your research is saved in the queue. Start the background research process from the project folder with"}{" "}
        {worker !== "not_responding" && <code>bun run worker</code>}
        {worker !== "not_responding" && "."}
      </p>
    </Notice>
  );
}
export type ProgressView = {
  id: string;
  status: string;
  reason: string | null;
  stage: string;
  coverage: string;
  counts: { collected: number; selected: number; analyzed: number };
  budget: {
    committedUsd: number;
    remainingUsd: number;
    unknown: boolean;
    knownChargeUsd: number;
  };
  worker: string;
};
export function ProgressPanel({
  progress,
  ceiling,
  configured = true,
  result,
  readOnly = false,
}: {
  progress: ProgressView;
  ceiling: number;
  configured?: boolean;
  result?: ActionResult;
  readOnly?: boolean;
}) {
  const headingId = useId();
  const active = isActive(progress.status);
  const paused = progress.status === "paused";
  return (
    <section className="progress-panel" aria-labelledby={headingId}>
      <div className="section-heading">
        <h2 id={headingId}>
          {active ? stageLabel(progress.stage) : "Run progress"}
        </h2>
        <RunBadge run={progress} worker={progress.worker} />
      </div>
      <dl className="metrics">
        <div>
          <dt>Reviews collected</dt>
          <dd>{progress.counts.collected.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>Selected for analysis</dt>
          <dd>{progress.counts.selected.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>Successfully analyzed</dt>
          <dd>{progress.counts.analyzed.toLocaleString("en")}</dd>
        </div>
        <div>
          <dt>AI spend + reservations</dt>
          <dd>
            {money(progress.budget.committedUsd)}{" "}
            <span>of {money(ceiling)}</span>
          </dd>
        </div>
      </dl>
      <p className="metadata">
        Counts describe this research sample. Review limits are maximums;
        available evidence may be lower. Spend includes estimates and reserved
        requests.
      </p>
      {active && <WorkerNotice worker={progress.worker} />}
      {paused && progress.reason === "interrupted" && (
        <Notice title="Research was interrupted">
          <p>
            Completed work is preserved. Resume to continue from the last saved
            checkpoint.
          </p>
        </Notice>
      )}
      {paused && progress.reason === "error" && (
        <Notice
          title={
            configured
              ? "Research needs attention"
              : "OpenAI configuration is missing"
          }
        >
          <p>
            {configured ? (
              "A research step could not finish after its retries. Review coverage below and resume when the source is available."
            ) : (
              <>
                Add <code>OPENAI_API_KEY</code> to the ignored local{" "}
                <code>.env</code> file, restart the worker, then resume.{" "}
                <Link to="/settings">View configuration instructions</Link>.
              </>
            )}
          </p>
        </Notice>
      )}
      {paused && progress.reason === "user" && (
        <Notice tone="neutral" title="Paused by you">
          <p>Completed work is preserved until you choose Resume.</p>
        </Notice>
      )}
      {progress.status === "cancelled" && (
        <Notice tone="neutral" title="Research cancelled">
          <p>
            Captured evidence and completed work are preserved. Resume from the
            last saved checkpoint or refresh as a separate research run.
          </p>
        </Notice>
      )}
      {progress.budget.unknown && (
        <Notice title="Provider cost is uncertain">
          <p>
            A request has no final usage record. Its reservation is included
            above. Paid continuation stays blocked until that cost is
            reconciled; raising the ceiling does not resolve it.
          </p>
        </Notice>
      )}
      {paused && progress.reason === "budget" && !progress.budget.unknown && (
        <Notice title="AI budget reached">
          <p>
            Review the spending and raise the ceiling to continue. Completed
            analysis is preserved.
          </p>
        </Notice>
      )}
      {!readOnly && (
        <div className="run-controls">
          {active && (
            <Form method="post">
              <Submit secondary name="intent" value="pause">
                Pause
              </Submit>
            </Form>
          )}
          {(progress.status === "cancelled" ||
            (paused &&
              !["app_review", "budget"].includes(progress.reason ?? ""))) && (
            <Form method="post">
              <Submit
                name="intent"
                value="resume"
                disabled={progress.budget.unknown}
              >
                Resume
              </Submit>
            </Form>
          )}
          {paused && progress.reason === "budget" && (
            <Form method="post" className="inline-form">
              <label htmlFor="budgetUsd">
                New AI ceiling (USD)
                <input
                  id="budgetUsd"
                  name="budgetUsd"
                  type="number"
                  min={ceiling}
                  max="1000"
                  step="0.01"
                  defaultValue={
                    typeof result?.values?.budgetUsd === "string"
                      ? result.values.budgetUsd
                      : ceiling + 1
                  }
                  {...fieldA11y("budgetUsd", result)}
                />
              </label>
              <Submit
                name="intent"
                value="raise_budget"
                disabled={progress.budget.unknown}
              >
                Raise budget and resume
              </Submit>
              <FieldError name="budgetUsd" result={result} />
            </Form>
          )}
          {(active || paused) && (
            <Form method="post">
              <Submit secondary name="intent" value="cancel">
                Cancel research
              </Submit>
            </Form>
          )}
          {["completed", "cancelled"].includes(progress.status) && (
            <Form method="post">
              <Submit secondary name="intent" value="refresh">
                Refresh as new research
              </Submit>
            </Form>
          )}
        </div>
      )}
    </section>
  );
}
export function Timestamp({ value }: { value: string | number | null }) {
  return <span>{date(value)}</span>;
}
export function WorkspaceError() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return (
    <>
      <PageHeader
        title={missing ? "Page not found" : "This view could not load"}
      />
      <EmptyState
        title={
          missing
            ? "This research is unavailable"
            : "Your workspace could not be read"
        }
        action={
          <Link className="button primary" to="/">
            Return to Research
          </Link>
        }
      >
        <p>
          {missing
            ? "Choose another run or start new research."
            : "Reload the page to try again. If the problem continues, check that the local app is running and its database is available."}
        </p>
      </EmptyState>
    </>
  );
}
export function ThemeSync({ appearance }: { appearance: string }) {
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        appearance === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appearance;
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [appearance]);
  return null;
}
