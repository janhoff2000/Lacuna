# Task 4 follow-up fixes

- Research-mode validation now marks each radio invalid and associates it with the stable `mode-error` message. Platform-direction validation preserves its explanatory hint while adding the stable `direction-error` association.
- Active progress polling now refreshes immediately when the page becomes visible or the window regains focus. It still performs at most one request at a time, ignores late updates after cleanup, and stops after paused or terminal progress.
- Focused workspace tests cover both validation associations and the two immediate-refresh events.

Verification passed: `bun test tests/workspace.test.tsx` (18 tests), `bun test` (113 tests), `bun run typecheck`, `bun run lint`, and `bun run build`.
