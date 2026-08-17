// Felles server-kontekst for de asynkrone atomiseringsjobbene.
//
// Ansvar: verifisere pålogging, håndheve eierskap med brukerens egen klient
// (RLS) før service-credential tas i bruk, og hente kandidatgrunnlaget.
// Ingen CV-tekst logges, og service-credential lastes først etter eierskap.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { CV_ATOMIZATION_JOB_LIMITS } from "./contract.ts";

/** Tegnvekt for én kandidat. Samme mål som frontend bruker før start. */
export function candidateCharSize(candidate: Record<string, unknown>): number {
  const parts = [candidate["content_no"], candidate["content_en"], candidate["source_quote"]];
  return parts.reduce<number>((n, v) => n + (typeof v === "string" ? v.length : 0), 0);
}

export type JobContext = {
  ok: true;
  userId: string;
  userClient: ReturnType<typeof createClient<Database>>;
  adminClient: any;
  anthropicApiKey: string;
  allCandidates: unknown[];
  selectedRefs: string[];
};

export type JobContextError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export async function loadJobContext(args: {
  request: Request;
  cvImportId: string;
  candidateIds?: string[];
  /** Krev at minst én kandidat gjenstår til analyse (bare ved start). */
  requireEligible: boolean;
}): Promise<JobContext | JobContextError> {
  const err = (status: number, code: string, message: string): JobContextError => ({
    ok: false,
    status,
    code,
    message,
  });

  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  const modelKey = process.env["ANTHROPIC" + "_API_KEY"];
  if (!supabaseUrl || !publishableKey || !modelKey) {
    return err(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
  }

  const authHeader = args.request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
    return err(401, "unauthorized", "Mangler gyldig pålogging.");
  }
  const userClient = createClient<Database>(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return err(401, "unauthorized", "Mangler gyldig pålogging.");

  const { data: importRow, error: importError } = await userClient
    .from("cv_imports")
    .select("id")
    .eq("id", args.cvImportId)
    .eq("user_id", userId)
    .maybeSingle();
  if (importError) return err(500, "database_error", "Kunne ikke lese importen.");
  if (!importRow) return err(404, "not_found", "Fant ikke importen.");

  const { data: candidateRows, error: candError } = await userClient
    .from("cv_parse_candidates")
    .select(
      "id, local_ref, parent_local_ref, suggested_atom_type, content_no, content_en, source_quote, structured_data, status, promoted_atom_id",
    )
    .eq("import_id", args.cvImportId)
    .eq("user_id", userId);
  if (candError) return err(500, "database_error", "Kunne ikke lese kandidatene.");

  const all = (candidateRows ?? []) as unknown as {
    id: string;
    local_ref: string;
    status: string | null;
    promoted_atom_id: string | null;
  }[];
  const byId = new Map(all.map((c) => [c.id, c]));

  let selected = all;
  if (args.candidateIds && args.candidateIds.length > 0) {
    if (args.candidateIds.some((id) => !byId.has(id))) {
      return err(400, "invalid_candidates", "Én eller flere kandidater hører ikke til importen.");
    }
    selected = args.candidateIds.map((id) => byId.get(id)!);
  }
  const eligible = selected.filter((c) => c.promoted_atom_id === null && c.status !== "bekreftet");
  if (args.requireEligible && eligible.length === 0) {
    return err(400, "no_candidates", "Ingen kandidater til analyse i denne importen.");
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  return {
    ok: true,
    userId,
    userClient,
    adminClient: supabaseAdmin,
    anthropicApiKey: modelKey,
    allCandidates: all,
    selectedRefs: eligible.map((c) => c.local_ref),
  };
}

// ---------------------------------------------------------------------------
// Bakgrunnsarbeider: kontekst uten brukersesjon
// ---------------------------------------------------------------------------
//
// Modellarbeidet kjøres av en kontrollert arbeider med egen autentisering
// (delt hemmelighet), ikke av brukerens egne kall. Arbeideren tar lås på
// jobben, henter kandidatgrunnlaget med service-credential og slipper låsen
// når steget er ferdig. Eierskap er allerede fastslått da jobben ble opprettet.

export type WorkerJobContext = {
  ok: true;
  jobId: string;
  userId: string;
  cvImportId: string;
  attempts: number;
  adminClient: any;
  anthropicApiKey: string;
  allCandidates: unknown[];
  selectedRefs: string[];
  leaseOwner: string;
};

export async function reapStaleAtomizationJobs(): Promise<Record<string, unknown> | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any).rpc("internal_cv_atomization_reap", {
    p_max_attempts: 6,
  });
  return (data as Record<string, unknown> | null) ?? null;
}

export async function claimWorkerJobContext(args: {
  leaseOwner: string;
  jobId?: string | null;
  leaseSeconds?: number;
}): Promise<WorkerJobContext | JobContextError | { ok: false; status: 204; code: "no_job"; message: string }> {
  const err = (status: number, code: string, message: string): JobContextError => ({
    ok: false,
    status,
    code,
    message,
  });

  const modelKey = process.env["ANTHROPIC" + "_API_KEY"];
  if (!modelKey) return err(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adminClient: any = supabaseAdmin;

  const { data: claimed, error: claimError } = await adminClient.rpc(
    "internal_cv_atomization_claim",
    {
      p_owner: args.leaseOwner,
      p_lease_seconds: args.leaseSeconds ?? 180,
      p_job_id: args.jobId ?? null,
      p_max_attempts: 6,
    },
  );
  if (claimError) return err(500, "database_error", "Kunne ikke ta jobben.");
  const row = Array.isArray(claimed) ? claimed[0] : claimed;
  if (!row) return { ok: false, status: 204, code: "no_job", message: "Ingen jobb å kjøre." };

  const { data: candidateRows, error: candError } = await adminClient
    .from("cv_parse_candidates")
    .select(
      "id, local_ref, parent_local_ref, suggested_atom_type, content_no, content_en, source_quote, structured_data, status, promoted_atom_id",
    )
    .eq("import_id", row.cv_import_id)
    .eq("user_id", row.user_id);
  if (candError) return err(500, "database_error", "Kunne ikke lese kandidatene.");

  const all = (candidateRows ?? []) as {
    id: string;
    local_ref: string;
    status: string | null;
    promoted_atom_id: string | null;
  }[];
  const eligible = all.filter((c) => c.promoted_atom_id === null && c.status !== "bekreftet");

  return {
    ok: true,
    jobId: row.job_id as string,
    userId: row.user_id as string,
    cvImportId: row.cv_import_id as string,
    attempts: Number(row.attempts ?? 1),
    adminClient,
    anthropicApiKey: modelKey,
    allCandidates: all,
    selectedRefs: eligible.map((c) => c.local_ref),
    leaseOwner: args.leaseOwner,
  };
}
