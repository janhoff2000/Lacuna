// Every provider attempt passes through the reservation/accounting functions below.
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { transaction, type DB } from "./db";
import { assertAttempt, failTask, getRun, transitionInTransaction, type TaskRow } from "./runs";
import { decodeObject, encodeJson } from "../shared/types";
import { hash } from "./collectors/common";
import { instructions, schemas, PROMPT_VERSION, SCHEMA_VERSION, validateCitations, validateStageLinks, type AnalysisKind, type QuoteSource } from "./prompts";

export interface ModelPrice { inputUsdPerMillion: number; outputUsdPerMillion: number; timestamp: string; source: string }
export const DEFAULT_MODEL = "gpt-5.6-luna";
export const MODEL_CATALOG: Readonly<Record<string, ModelPrice>> = {
  "gpt-5.6-luna": { inputUsdPerMillion: 0.20, outputUsdPerMillion: 1.20, timestamp: "2026-09-12", source: "https://developers.openai.com/api/docs/models/gpt-5.6-luna" },
  "gpt-5.6-terra": { inputUsdPerMillion: 2, outputUsdPerMillion: 12, timestamp: "2026-09-12", source: "https://developers.openai.com/api/docs/models/gpt-5.6-terra" },
};
export interface AiRow {
  id: string; run_id: string; task_id: string; attempt_id: string; model: string;
  pricing_json: string; pricing_timestamp: string; status: "in_flight" | "finalized" | "unknown";
  reserved_usd: number; estimated_usd: number | null; known_charge_usd: number | null;
  input_tokens: number | null; output_tokens: number | null; provider_request_id: string | null;
}
function tokens(value: number): void { if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid token ceiling/usage"); }
// Round up to nanodollars so rounding cannot reduce a reservation.
function price(input: number, output: number, model: ModelPrice): number {
  return Math.ceil((input * model.inputUsdPerMillion + output * model.outputUsdPerMillion) * 1_000) / 1_000_000_000;
}
function validPrice(model: ModelPrice | undefined): model is ModelPrice {
  return !!model && Number.isFinite(model.inputUsdPerMillion) && model.inputUsdPerMillion >= 0 && Number.isFinite(model.outputUsdPerMillion) && model.outputUsdPerMillion >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(model.timestamp) && !!model.source;
}
export function budgetState(db: DB, runId: string) {
  const rows = db.query<AiRow, [string]>("SELECT * FROM ai_requests WHERE run_id=?").all(runId);
  const committedUsd = rows.reduce((sum, row) => sum + (row.status === "finalized" ? row.known_charge_usd ?? row.estimated_usd ?? row.reserved_usd : Math.max(row.reserved_usd, row.known_charge_usd ?? 0)), 0);
  return { committedUsd, remainingUsd: Math.max(0, getRun(db, runId).budget_usd - committedUsd), unknown: rows.some(row => row.status === "unknown"), knownChargeUsd: rows.reduce((sum, row) => sum + (row.known_charge_usd ?? 0), 0) };
}
export function reserveAi(db: DB, taskId: string, attemptId: string, ceiling: { maxInputTokens: number; maxOutputTokens: number; model?: string; requestKey?: string }, catalog: Readonly<Record<string, ModelPrice>> = MODEL_CATALOG, now = Date.now()): { id: string; reservedUsd: number } | { refused: "pricing_unknown" | "budget" | "unknown_cost" } {
  tokens(ceiling.maxInputTokens); tokens(ceiling.maxOutputTokens);
  return transaction(db, () => {
    const task = assertAttempt(db, taskId, attemptId);
    const modelName = ceiling.model ?? DEFAULT_MODEL; const model = catalog[modelName];
    const state = budgetState(db, task.run_id);
    const refused = !validPrice(model) ? "pricing_unknown" : state.unknown ? "unknown_cost" : state.remainingUsd < price(ceiling.maxInputTokens, ceiling.maxOutputTokens, model) ? "budget" : null;
    if (refused) { transitionInTransaction(db, task.run_id, "paused", "budget", now); return { refused }; }
    const reservedUsd = price(ceiling.maxInputTokens, ceiling.maxOutputTokens, model);
    const id = randomUUID();
    db.query("INSERT INTO ai_requests(id,run_id,task_id,attempt_id,model,pricing_json,pricing_timestamp,status,reserved_usd,created_at,updated_at,request_key) VALUES(?,?,?,?,?,?,?,'in_flight',?,?,?,?)").run(id, task.run_id, taskId, attemptId, modelName, encodeJson({ ...model, maxInputTokens: ceiling.maxInputTokens, maxOutputTokens: ceiling.maxOutputTokens }), model.timestamp, reservedUsd, now, now, ceiling.requestKey ?? "default");
    return { id, reservedUsd };
  });
}
export function getAiRequest(db: DB, id: string): AiRow {
  const row = db.query<AiRow, [string]>("SELECT * FROM ai_requests WHERE id=?").get(id);
  if (!row) throw new Error("Unknown AI request");
  decodeObject(row.pricing_json);
  return row;
}
// Accounting is accepted even after cancellation: a stale result may still have incurred a bill.
export function finalizeAi(db: DB, id: string, usage: { inputTokens: number; outputTokens: number } | null, knownChargeUsd: number | null, providerRequestId: string | null = null, now = Date.now()): void {
  if (usage) { tokens(usage.inputTokens); tokens(usage.outputTokens); }
  if (knownChargeUsd !== null && (!Number.isFinite(knownChargeUsd) || knownChargeUsd < 0)) throw new Error("Invalid known charge");
  transaction(db, () => {
    const row = getAiRequest(db, id);
    if (row.status === "finalized") throw new Error("AI accounting already finalized");
    const snapshot = decodeObject(row.pricing_json);
    const model = { inputUsdPerMillion: snapshot.inputUsdPerMillion, outputUsdPerMillion: snapshot.outputUsdPerMillion, timestamp: snapshot.timestamp, source: snapshot.source };
    if (typeof model.inputUsdPerMillion !== "number" || typeof model.outputUsdPerMillion !== "number" || typeof model.timestamp !== "string" || typeof model.source !== "string" || !validPrice(model as ModelPrice)) throw new Error("Invalid persisted price");
    const estimate = usage ? price(usage.inputTokens, usage.outputTokens, model as ModelPrice) : null;
    const status = usage || knownChargeUsd !== null ? "finalized" : "unknown";
    db.query("UPDATE ai_requests SET status=?,estimated_usd=?,known_charge_usd=?,input_tokens=?,output_tokens=?,provider_request_id=?,updated_at=? WHERE id=?").run(status, estimate, knownChargeUsd, usage?.inputTokens ?? null, usage?.outputTokens ?? null, providerRequestId, now, id);
    const run = getRun(db, row.run_id);
    if (run.status === "running" && (status === "unknown" || budgetState(db, run.id).committedUsd > run.budget_usd)) transitionInTransaction(db, run.id, "paused", "budget", now);
  });
}
export function markAiUnknown(db: DB, id: string, now = Date.now()): void { finalizeAi(db, id, null, null, null, now); }

export interface ProviderResponse { id: string; output_text: string; status?: string; _request_id?: string | null; usage?: { input_tokens: number; output_tokens: number } | null }
export type AiTransport = (request: ResponseCreateParamsNonStreaming, signal: AbortSignal) => Promise<ProviderResponse>;
export class AiPaused extends Error {}
export function apiConfigured(): boolean { return !!process.env.OPENAI_API_KEY?.trim(); }
export const responseTransport: AiTransport = async (request, signal) => {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 });
  return client.responses.create(request, { signal });
};
export async function analyze<K extends AnalysisKind>(db: DB, task: TaskRow, kind: K, input: unknown, sources: QuoteSource[], signal: AbortSignal, options: { transport?: AiTransport; configured?: boolean; model?: string } = {}): Promise<z.infer<(typeof schemas)[K]>> {
  const settings = decodeObject(getRun(db, task.run_id).settings_json);
  const model = options.model ?? (typeof settings.model === "string" ? settings.model : DEFAULT_MODEL);
  const inputJson = encodeJson(input); const inputHash = hash({ kind, input: inputJson, sources });
  const cached = db.query<{ output_json: string }, [string,string,string,string,string]>("SELECT output_json FROM analyses WHERE stage=? AND input_hash=? AND model=? AND prompt_version=? AND schema_version=?").get(kind, inputHash, model, PROMPT_VERSION, SCHEMA_VERSION);
  if (cached) {
    const output = schemas[kind].parse(JSON.parse(cached.output_json)); validateCitations(output, sources); validateStageLinks(kind, output, input);
    return output as z.infer<(typeof schemas)[K]>;
  }
  if (!(options.configured ?? apiConfigured())) {
    failTask(db, task.id, task.attempt_id!, { code: "configuration", jitter: 0.5 }); throw new AiPaused("Configure OPENAI_API_KEY locally and resume");
  }
  const transport = options.transport ?? responseTransport;
  // Persist the bounded repair count across manual resume/restart.
  const prior = db.query<{ count: number }, [string,string]>("SELECT COUNT(*) AS count FROM ai_requests WHERE task_id=? AND input_hash=?").get(task.id, inputHash)!.count;
  for (let attempt = prior; attempt < 2; attempt++) {
    signal.throwIfAborted(); assertAttempt(db, task.id, task.attempt_id!);
    const request: ResponseCreateParamsNonStreaming = {
      model, store: false, stream: false, service_tier: "default", max_output_tokens: kind === "extraction" ? 4000 : 6000,
      instructions: instructions(kind), input: JSON.stringify({ untrustedResearchData: input, validation: attempt ? "The previous response failed schema or literal-source validation. Regenerate conservatively; omit unsupported statements." : null }),
      text: { format: { type: "json_schema", name: `lacuna_${kind}`, strict: true, schema: z.toJSONSchema(schemas[kind]) } },
    };
    // UTF-8 bytes are a conservative upper bound for text tokens; include the
    // complete schema/instructions and extra protocol overhead in the reservation.
    const maxInputTokens = Buffer.byteLength(JSON.stringify(request)) + 2048;
    if (maxInputTokens > 200_000) throw new Error("AI input exceeds bounded batch size");
    const reservation = reserveAi(db, task.id, task.attempt_id!, { model, maxInputTokens, maxOutputTokens: request.max_output_tokens!, requestKey: `${kind}:${inputHash}:${attempt}` });
    if ("refused" in reservation) throw new AiPaused(reservation.refused);
    db.query("UPDATE ai_requests SET prompt_version=?,schema_version=?,input_hash=? WHERE id=?").run(PROMPT_VERSION, SCHEMA_VERSION, inputHash, reservation.id);
    let response: ProviderResponse;
    try { response = await transport(request, signal); }
    catch { markAiUnknown(db, reservation.id); throw new AiPaused("Response unavailable; cost remains uncertain"); }
    // Accounting survives cancellation. Never save late analysis output afterward.
    db.query("UPDATE ai_requests SET provider_response_id=?,usage_json=? WHERE id=?").run(response.id, response.usage ? encodeJson(response.usage) : null, reservation.id);
    finalizeAi(db, reservation.id, response.usage ? { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } : null, null, response._request_id ?? response.id);
    signal.throwIfAborted(); assertAttempt(db, task.id, task.attempt_id!);
    try {
      if (response.status && response.status !== "completed") throw new Error("Incomplete response");
      const output = schemas[kind].parse(JSON.parse(response.output_text)); validateCitations(output, sources); validateStageLinks(kind, output, input);
      db.query("INSERT INTO analyses(id,run_id,task_id,stage,input_hash,source_ids_json,model,prompt_version,schema_version,output_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stage,input_hash,model,prompt_version,schema_version) DO NOTHING").run(randomUUID(), task.run_id, task.id, kind, inputHash, encodeJson(sources.map(s => s.id)), model, PROMPT_VERSION, SCHEMA_VERSION, encodeJson(output), Date.now());
      return output as z.infer<(typeof schemas)[K]>;
    } catch {
      db.query("UPDATE ai_requests SET error_code='invalid_structured_output' WHERE id=?").run(reservation.id);
    }
  }
  throw new Error("Structured output failed validation after bounded repair");
}
