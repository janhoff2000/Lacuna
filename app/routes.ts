import { index, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("routes/research-index.tsx"),
  route("research/new", "routes/new-research.tsx"),
  route("research/:runId", "routes/research.tsx"),
  route("research/:runId/progress", "routes/progress.ts"),
  route("saved", "routes/saved.tsx"),
  route("settings", "routes/settings.tsx"),
  ...(process.env.NODE_ENV !== "production"
    ? [route("reference", "routes/reference.tsx")]
    : []),
] satisfies RouteConfig;
