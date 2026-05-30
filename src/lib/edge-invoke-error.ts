// @ts-nocheck
import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";

/** Best-effort message from supabase.functions.invoke failure (non-2xx or network). */
export async function messageFromFunctionInvokeError(
  error: unknown,
  data?: unknown,
): Promise<string> {
  const d = data as { message?: string; error?: string } | null | undefined;
  if (d?.message) return normalizeAiErrorMessage(d.message, { kind: "analysis" });
  if (typeof d?.error === "string") {
    return normalizeAiErrorMessage(d.error, { kind: "analysis" });
  }
  const ctx = (error as { context?: { json?: () => Promise<unknown> } })?.context;
  if (ctx?.json) {
    try {
      const body = (await ctx.json()) as { message?: string; error?: string };
      if (body?.message) return normalizeAiErrorMessage(body.message, { kind: "analysis" });
      if (typeof body?.error === "string") {
        return normalizeAiErrorMessage(body.error, { kind: "analysis" });
      }
    } catch {
      /* ignore */
    }
  }
  if (error instanceof Error) {
    return normalizeAiErrorMessage(error.message, { kind: "analysis" });
  }
  return normalizeAiErrorMessage("Edge function returnerte en feil.", { kind: "analysis" });
}
