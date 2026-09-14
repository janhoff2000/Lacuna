# Lacuna design system

## Direction

A focused research workspace for discovering unmet app needs and inspecting the evidence behind them. Use compact structure inspired by the supplied Linear reference, warm light surfaces inspired by ElevenLabs, and restrained dark contrast/violet accents inspired by Resend.

The distinctive interaction is the direct link between a claim and its source passages. Give review evidence and competitor comparisons the space needed to read and question a conclusion.

These are Lacuna's rules, adapted from the supplied references. Do not copy marketing-page heroes, oversized headlines, section gaps, or contradictory reference rules into the application.

## Keep implementation simple

- One shared CSS theme with light/dark token values; use the same components and layout for both appearances.
- Use shadcn primitives directly. Extract Lacuna components when they are reused or make a substantial screen easier to read; avoid wrapping every button, field, or label in a new abstraction.
- Use ordinary CSS grid/flex layouts and responsive breakpoints. No custom layout engine, draggable/resizable workspace, or persisted panel arrangements in v1.
- Use React Router navigation/forms and local React state. A selected opportunity can be represented in the URL; do not synchronize it across a separate global store.
- Implement claim-to-evidence navigation with source IDs, anchors, and a selected highlight. No graph visualization or specialized annotation engine.
- Keep the component reference as one development-only route using existing components and fixtures. No separate Storybook site, package, or documentation platform.
- Show common research controls first and put adjustable limits in one Advanced section. Keep internal sampling/cache tuning out of the user interface.

## Color tokens

Use semantic CSS variables connected to the shadcn theme. Values below are starting tokens; verify rendered text/control/focus contrast before finalizing them.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | `#FDFCFC` | `#08090A` |
| Secondary surface / navigation | `#F5F3F1` | `#0F1011` |
| Raised surface / popover | `#FFFFFF` | `#161718` |
| Primary text | `#201F22` | `#F0F0F2` |
| Secondary text | `#625F69` | `#A1A4AF` |
| Decorative divider | `#E7E3E8` | `#292C33` |
| Accent text / focus | `#6550B5` | `#B5A3F2` |
| Selected surface | `#EFEBF8` | `#242030` |
| Primary action background | `#201F22` | `#F0F0F2` |
| Primary action text | `#FDFCFC` | `#161718` |

- Default to system appearance; allow persisted light/dark/system selection without a flash of the wrong theme.
- Violet identifies interactions, selected items, links, and source highlights. It is not a universal AI decoration color.
- Use separately tested semantic colors for errors, attention, and successful completion; always pair with text or icons.
- Distinguish research priority, evidence confidence, personal status, and run state through labels. Do not imply that High priority guarantees a good business.
- Faint divider tokens are decorative; input outlines/focus/selected controls must remain distinguishable at required contrast.

## Typography

- Inter Variable for navigation, prose, labels, and headings; self-host where practical, with system sans-serif fallbacks supporting multilingual text.
- Controls: 14px, weight 400–500, line-height about 1.4.
- Metadata: 12–13px with readable contrast; do not use very faint text for required evidence details.
- Evidence and report prose: 16px, weight 400, line-height 1.55–1.65; aim for 60–75 characters per line.
- Section headings: 18–20px, weight 500–600.
- Report/page headings: 24–28px, weight 500, modest negative tracking.
- Monospace only for actual technical identifiers or keyboard shortcuts. Use tabular numbers for aligned counts and costs.
- Sentence case throughout. Avoid display-sized marketing headlines, all-caps labels, and decorative colored words.
- Preserve original scripts and punctuation in review excerpts. Label translations and permit viewing originals.

## Geometry and spacing

- Base spacing unit: 4px. Typical gaps: 8, 12, 16, 24, 32px.
- Buttons and inputs: 6px corner radius. Floating panels/dialogs: 12px. Tags may use pill shapes.
- Use continuous list rows and thin dividers rather than placing every item in a card.
- Compact controls must retain usable pointer targets; expand touch targets on smaller screens.
- Separate surfaces with tone and borders. Restrict shadows to overlays where depth helps identify layering.

## Layout

Desktop: left-aligned navigation, compact opportunity list, and a larger reading pane. Suggested starting widths: navigation 208–224px, opportunity list 320–380px, flexible detail pane. Adjust at real viewport sizes.

```text
┌──────────────┬─────────────────────────────────────────────┐
│ Lacuna       │ Research title                 Run actions  │
│              ├───────────────────┬─────────────────────────┤
│ Research     │ Search / filters  │ Selected opportunity    │
│ Saved        │                   │ Need and audience       │
│ Settings     │ Opportunity list  │ Priority / confidence   │
│              │                   │ Evidence / competitors  │
│              │                   │ Source passages         │
└──────────────┴───────────────────┴─────────────────────────┘
```

- Research index shows real active/recent runs and a clear New research action. Empty state explains how to begin.
- Run reports lead with opportunities, not decorative statistics. Coverage and progress remain accessible.
- On smaller screens collapse navigation and use list-to-detail navigation with a clear Back action. Do not squeeze three panes into mobile widths.
- Comparisons may scroll horizontally with clear column headers. Keep source prose readable without horizontal scrolling.

## Core components

### Opportunity row

Title, concise need/audience, perspective/direction, priority and confidence labels, evidence count. Use app icons sparingly for recognition. A selected row has a subtle violet-tinted surface and an additional non-color selection cue.

### Opportunity detail

Present the need, affected audience, why it may be underserved, and the evidence. Keep speculative product proposals distinct from observed user statements. Provide Save and source navigation near the relevant content.

### Evidence passage

Show quoted original text with app/store, rating, date, and source link where available. Translation is explicitly labeled. Selecting a claim reveals/highlights the linked passages and allows keyboard navigation without unexpected focus loss.

### Competitor comparison

Use aligned capability rows with text states such as Documented support, Reported problems, and Not verified. Each assertion links to a captured source. Do not render unknown as a negative checkmark.

### Progress and recovery

Show current stage, truthful counts, cost estimate, and relevant actions. Do not invent a percentage when remaining work is unknown. Distinguish Paused, Interrupted, Awaiting app review, Budget reached, and Completed with gaps.

Queued runs must distinguish Worker not running and Worker not responding, with startup/recovery guidance. Review allowances are labeled maximums; confidence labels expose their supporting counts and verification checks.

### Saved opportunity status

Use the exact labels: To investigate, Investigating, Consider, Dismissed. These represent the user's judgment. Notes and status updates must not be overwritten by research refreshes.

### Buttons and forms

- Primary action uses neutral filled styling; secondary uses outline/ghost styling.
- Name actions concretely: Start research, Review apps, Pause, Resume, Raise budget, Save opportunity.
- Resolve country presets to visible countries. Cross-platform options show explicit direction.
- Errors explain what failed and provide a next action. Keep worker internals, task IDs, and raw stack traces out of normal flows.

## Motion and accessibility

- Short 120–180ms transitions for user-triggered selection, opening, and state changes. Respect reduced motion.
- Avoid repeated entrance animations, animated backgrounds, glows, and decorative 3D assets.
- Keyboard-accessible lists, dialogs, tabs, forms, and evidence links; visible focus in both themes.
- Meet WCAG AA text contrast targets; verify essential control boundaries and focus indicators. Never encode state through color alone.
- Announce meaningful asynchronous state changes without announcing every polling update or stealing focus.

## Implementation and review

- Build on shadcn primitives with one theme and reusable Lacuna components. Avoid ad hoc colors or duplicated state styling in route files.
- Include a development-only component reference with populated, empty, loading, error, preliminary, partial, and recovery examples.
- Inspect actual rendered screens in both themes, including long multilingual reviews, dense comparisons, long app titles, and narrow viewports.
- Use clearly labeled sample data during visual review; sample evidence must never look like a completed live research run.
- Refine spacing/contrast after rendered inspection while preserving this direction.
