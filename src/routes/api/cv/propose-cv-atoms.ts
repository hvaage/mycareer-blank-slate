// POST /api/cv/propose-cv-atoms
//
// Fase 3B: normaliserer parsekandidater fra én CV-import til atomforslag.
//
// Kanonisk inputkilde er public.cv_parse_candidates knyttet til public.cv_imports.
// `documents` brukes verken som evidenskilde eller normaliseringsinput.
// Klienten kan ikke sende tekst — bare cvImportId og eventuelt candidateIds.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - streng inputvalidering (zod .strict): fritekstfelter gir 400
//   - user_id i body avvises
//   - JWT verifiseres server-side; bruker-id kommer kun fra auth-kontekst
//   - eierskap håndheves med brukerens egen klient (RLS) før service-credential
//   - fremmed/ukjent import gir samme 404
//   - sanitert JSON-feilmodell; ingen CV-tekst eller nøkler i logg
//   - modell-, vendor- og nøkkellogikk lastes dynamisk fra serverkjøremodulen,
//     slik at ingenting av det kan havne i klientbunten
//
// Skrivekontrakt: kun atom_enrichment_batches + atom_enrichment_proposals.
// career_atoms er urørt før brukerens gjennomgang og v4-apply.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type ErrorCode =
  | "method_not_allowed"
  | "invalid_origin"
  | "invalid_body"
  | "unauthorized"
  | "not_found"
  | "invalid_candidates"
  | "no_candidates"
  | "server_misconfigured"
  | "database_error";

function fail(status: number, code: ErrorCode, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

const UUID = z.string().uuid();

const bodySchema = z
  .object({
    cvImportId: UUID,
    // Én forespørsel = én delbatch. Frontend deler større utvalg selv.
    candidateIds: z.array(UUID).min(1).max(80).optional(),
    regenerate: z.boolean().optional(),
    // Atomiseringsprofil. v1 er ordinær standard. v2_1 er foreløpig en
    // feature-flagget canary og kjøres bare når den bes om eksplisitt.
    profile: z.enum(["v1", "v2_1"]).optional(),
    // v2_1 kjører hierarkisk som standard. "monolithic" beholdes for måling.
    pipeline: z.enum(["hierarchical", "monolithic"]).optional(),
    correlation_id: UUID.optional(),
  })
  .strict();

function sameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const check = (value: string | null) => {
    if (!value) return null;
    try {
      return new URL(value).host === host;
    } catch {
      return false;
    }
  };
  const o = check(request.headers.get("origin"));
  if (o !== null) return o;
  const r = check(request.headers.get("referer"));
  if (r !== null) return r;
  // Bearer-basert auth uten cookies: ingen ambient credentials å forfalske.
  return true;
}

export const Route = createFileRoute("/api/cv/propose-cv-atoms")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const startedAt = Date.now();
        const correlationId = crypto.randomUUID();

        if (!sameOrigin(request)) {
          return fail(403, "invalid_origin", "Forespørselen må komme fra samme opphav.");
        }

        const supabaseUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const modelKey = process.env["ANTHROPIC" + "_API_KEY"];
        if (!supabaseUrl || !publishableKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        // ------------------------------------------------------------ input
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = null;
        }
        if (raw && typeof raw === "object" && "user_id" in (raw as Record<string, unknown>)) {
          return fail(400, "invalid_body", "user_id kan ikke sendes i forespørselen.");
        }
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return fail(
            400,
            "invalid_body",
            "Ugyldig forespørsel. Bare cvImportId og candidateIds godtas — tekst kan ikke sendes inn.",
          );
        }
        const { cvImportId, candidateIds, regenerate } = parsed.data;
        // Canary: v2_1 må velges eksplisitt til kvalitets- og ytelsesportene
        // er grønne. Vanlig brukerflyt kjører fortsatt v1.
        const profileChoice = parsed.data.profile ?? "v1";

        // -------------------------------------------------------------- jwt
        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }
        const token = authHeader.slice("Bearer ".length);
        const userClient = createClient<Database>(supabaseUrl, publishableKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
        });
        const { data: userData, error: userError } = await userClient.auth.getUser();
        const userId = userData?.user?.id;
        if (userError || !userId) {
          return fail(401, "unauthorized", "Mangler gyldig pålogging.");
        }

        // --------------------------------------------------------- eierskap
        const { data: importRow, error: importError } = await userClient
          .from("cv_imports")
          .select("id, user_id, status")
          .eq("id", cvImportId)
          .eq("user_id", userId)
          .maybeSingle();
        if (importError) {
          return fail(500, "database_error", "Kunne ikke lese importen.");
        }
        if (!importRow) {
          return fail(404, "not_found", "Fant ikke importen.");
        }

        // ------------------------------------------------------- kandidater
        const { data: candidateRows, error: candError } = await userClient
          .from("cv_parse_candidates")
          .select(
            "id, local_ref, parent_local_ref, suggested_atom_type, content_no, content_en, source_quote, structured_data, status, promoted_atom_id",
          )
          .eq("import_id", cvImportId)
          .eq("user_id", userId);
        if (candError) {
          return fail(500, "database_error", "Kunne ikke lese kandidatene.");
        }

        const all = (candidateRows ?? []) as unknown as {
          id: string;
          local_ref: string;
          status: string | null;
          promoted_atom_id: string | null;
        }[];
        const byId = new Map(all.map((c) => [c.id, c]));

        let selected = all;
        if (candidateIds) {
          if (candidateIds.some((id) => !byId.has(id))) {
            return fail(
              400,
              "invalid_candidates",
              "Én eller flere kandidater hører ikke til denne importen.",
            );
          }
          selected = candidateIds.map((id) => byId.get(id)!);
        }

        // Allerede bekreftede kandidater har nådd karriereoversikten gjennom
        // gjennomgangen og skal ikke få nye forslag.
        const eligible = selected.filter(
          (c) => c.promoted_atom_id === null && c.status !== "bekreftet",
        );
        if (eligible.length === 0) {
          return fail(400, "no_candidates", "Ingen kandidater til normalisering i denne importen.");
        }

        if (!modelKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        // ---------------------------- service-credential først etter eierskap
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          if (profileChoice === "v1") {
            const { runProposeCvAtoms } = await import(
              "../../../../supabase/functions/_shared/cv-skills/propose-atoms-runner.ts"
            );
            const outcome = await runProposeCvAtoms({
              userClient,
              adminClient: supabaseAdmin,
              anthropicApiKey: modelKey,
              userId,
              cvImportId,
              candidates: eligible as never,
              correlationId,
              startedAt,
              regenerate: regenerate === true,
            });
            return Response.json(outcome.body, { status: outcome.status });
          }

          const { runProposeCvAtomsV2 } = await import(
            "../../../../supabase/functions/_shared/cv-skills/propose-atoms-runner-v2.ts"
          );
          const outcome = await runProposeCvAtomsV2({
            userClient,
            adminClient: supabaseAdmin,
            anthropicApiKey: modelKey,
            userId,
            cvImportId,
            // Hele importen er kontekst; rolleblokkene bygges deterministisk.
            allCandidates: all as never,
            selectedRefs: (eligible as unknown as { local_ref: string }[]).map((c) => c.local_ref),
            correlationId,
            startedAt,
            regenerate: regenerate === true,
            pipeline: parsed.data.pipeline ?? "hierarchical",
          });
          return Response.json(outcome.body, { status: outcome.status });
        } catch (err) {
          console.error(
            "[propose-cv-atoms] unhandled",
            JSON.stringify({ correlationId, name: (err as Error)?.name ?? "Error" }),
          );
          return fail(500, "database_error", "Noe gikk galt. Ingen forslag ble lagret.");
        }
      },
    },
  },
});
