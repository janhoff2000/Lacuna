import type { Route } from "./+types/progress";
import { openDatabase } from "../../server/db";
import { researchProgress } from "../../server/operations";

export function loader({ params }: Route.LoaderArgs) {
  if (!params.runId)
    throw new Response("Research run required", { status: 400 });
  const db = openDatabase();
  try {
    return Response.json(researchProgress(db, params.runId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message === "Unknown run"
            ? "Research not found"
            : "Progress is unavailable. Try again.",
      },
      {
        status:
          error instanceof Error && error.message === "Unknown run" ? 404 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  } finally {
    db.close();
  }
}
