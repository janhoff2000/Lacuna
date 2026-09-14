# Server-only boundary

`server/`, `worker/`, and `scripts/` run only in Bun. Browser route components
must not import from these directories, `bun:sqlite`, scraper packages, or
environment variables. A route loader or action may import a small server module
when it needs data; it must return serializable, non-secret values to the browser.

Keep reusable browser-safe domain types in `shared/`. Use `.server.ts` for any
server-only module that must live alongside a route. This separation prevents API
keys, database access, and scraper code from being bundled for the browser.
