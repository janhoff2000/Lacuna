# AGENTS.md

Lacuna is a local, loopback-only app-market research workspace built with Bun, React Router, React, TypeScript, and SQLite.

## Working rules

- Install exact dependencies with `bun install --frozen-lockfile`.
- Run database migrations with `bun run migrate`.
- Use `bun run dev` for the web app and worker together.
- Keep the web app and worker bound to loopback; do not broaden network exposure without explicit approval.
- Treat review-ID stability as a documented product assumption, not a platform guarantee.
- Preserve successful pipeline checkpoints and source evidence when later AI synthesis fails.
- Never expose `OPENAI_API_KEY` or other secrets in source, logs, screenshots, commits, or responses.
- Do not run paid or live-provider trials unless the user explicitly asks for them.

## Verification

Use the smallest relevant checks while working. Before handing off a substantive change, run as applicable:

- `bun run test`
- `bun run typecheck`
- `bun run lint`
- `bun run build`

Do not claim that deterministic tests prove live store-provider behavior, paid OpenAI behavior, or production readiness.
