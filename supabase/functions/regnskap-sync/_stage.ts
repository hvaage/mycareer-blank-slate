// Stage-tagging helper for QA-diagnostikk. Ingen secrets/tokens/connection strings.
export type Stage =
  | "auth" | "admin_check" | "parse" | "dispatch"
  | "qa_before" | "qa_real1" | "qa_snap1" | "qa_real2" | "qa_after"
  | "select_candidates" | "ensure_status" | "claim" | "start_run"
  | "brreg_fetch" | "upsert" | "write_status" | "insert_run_items" | "finish_run"
  | "finish_run_failed" | "post_refresh_mv" | "post_analyze" | "post_warmup" | "post_patch_meta"
  | "db_connect" | "verify" | "unknown";

export class StageError extends Error {
  stage: Stage;
  code: string | null;
  cause?: unknown;
  constructor(stage: Stage, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    super(msg);
    this.name = "StageError";
    this.stage = stage;
    this.cause = cause;
    // deno-postgres surfaces PG SQLSTATE i ulike former; trekk ut trygt.
    const anyC = cause as any;
    this.code =
      (typeof anyC?.code === "string" && anyC.code) ||
      (typeof anyC?.fields?.code === "string" && anyC.fields.code) ||
      (typeof anyC?.sqlState === "string" && anyC.sqlState) ||
      null;
  }
}

export async function tagStage<T>(stage: Stage, fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (e instanceof StageError) throw e;
    throw new StageError(stage, e);
  }
}

// Trygg, kort feilmelding (uten connection strings / tokens).
export function safeMessage(msg: string): string {
  let out = msg ?? "";
  // strip postgres connection URLs
  out = out.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "postgres://[redacted]");
  // strip bearer/jwt-aktige strenger
  out = out.replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g, "[jwt]");
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
  if (out.length > 400) out = out.slice(0, 400) + "…";
  return out;
}
