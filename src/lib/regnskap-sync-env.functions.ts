/**
 * MIDLERTIDIG — env-diagnostikk for M5.2 QA.
 * Returnerer kun presence (true/false), aldri verdier.
 * Admin-only. Slett sammen med resten av QA-flaten.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KEYS = [
  "SUPABASE_DB_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
  "POSTGRES_URL",
  "PG_CONNECTION_STRING",
  "SUPABASE_POOLER_URL",
] as const;

export const checkRegnskapSyncEnv = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!data) throw new Error("Forbidden: admin role required");

    const presence: Record<string, boolean> = {};
    for (const k of KEYS) {
      const v = process.env[k];
      presence[k] = typeof v === "string" && v.length > 0;
    }
    return { presence };
  });
