// POST /api/cv/generations
//
// Fase 4B: starter generering av generell CV for innlogget bruker.
//
// Sikkerhetskontrakt:
//   - POST-only (405 ellers)
//   - streng inputvalidering (zod .strict): bare presentasjonsvalg godtas
//   - user_id, atomIds, modell-id, prompt eller rå CV-tekst avvises
//   - bruker-ID hentes kun fra verifisert JWT
//   - grunnlaget leses med brukerens egen klient (RLS)
//   - service-credential brukes først etter at eierskap er avklart
//   - saniterte svar; ingen CV-tekst, promptinnhold eller nøkler i logg
//
// Skrivekontrakt: dokument, frosset atom-snapshot og jobb — atomisk i én RPC.
// career_atoms og cv_parse_candidates røres aldri.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

type ErrorCode =
  | "method_not_allowed"
  | "invalid_origin"
  | "invalid_body"
  | "unauthorized"
  | "server_misconfigured"
  | "database_error"
  | "needs_review"
  | "blocked_no_evidence"
  | "active_run";

function fail(status: number, code: ErrorCode, message: string, extra?: Record<string, unknown>) {
  return Response.json({ ok: false, error: { code, message }, ...(extra ?? {}) }, { status });
}

const bodySchema = z
  .object({
    // Kun presentasjonsvalg. Ingen modell-, prompt- eller innholdsstyring.
    language: z.enum(["no"]).optional(),
    title: z.string().min(2).max(120).optional(),
    includeContact: z.boolean().optional(),
  })
  .strict();

const FORBIDDEN_KEYS = [
  "user_id",
  "userId",
  "atomIds",
  "atom_ids",
  "model",
  "model_id",
  "prompt",
  "system",
  "text",
  "cvText",
  "variant",
];

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
  return true;
}

export const Route = createFileRoute("/api/cv/generations")({
  server: {
    handlers: {
      GET: async () => fail(405, "method_not_allowed", "Bruk POST."),
      POST: async ({ request }) => {
        const correlationId = crypto.randomUUID();
        if (!sameOrigin(request)) {
          return fail(403, "invalid_origin", "Forespørselen må komme fra samme opphav.");
        }

        const supabaseUrl = process.env["SUPABASE_URL"];
        const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!supabaseUrl || !publishableKey) {
          return fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.");
        }

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          raw = {};
        }
        if (raw && typeof raw === "object") {
          const keys = Object.keys(raw as Record<string, unknown>);
          if (keys.some((k) => FORBIDDEN_KEYS.includes(k))) {
            return fail(400, "invalid_body", "Feltet kan ikke sendes i forespørselen.");
          }
        }
        const parsed = bodySchema.safeParse(raw ?? {});
        if (!parsed.success) {
          return fail(400, "invalid_body", "Bare presentasjonsvalg godtas i denne forespørselen.");
        }

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

        // ------------------------------------------------------- grunnlaget
        const { data: atomRows, error: atomError } = await userClient
          .from("career_atoms")
          .select(
            "id, user_id, atom_kind, atom_type, atom_class, parent_atom_id, content_no, content_en, structured_data, source_type, source_ref, source_quote, confidence, attestation, state, mangel_state, user_confirmed, user_locked, is_active, stale_at, target_position_id, created_at, updated_at",
          )
          .eq("user_id", userId);
        if (atomError) {
          return fail(500, "database_error", "Kunne ikke lese grunnlaget ditt.");
        }

        const { count: openProposals } = await userClient
          .from("atom_enrichment_proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_review")
          .neq("proposal_action", "flag_conflict");
        const { count: conflicts } = await userClient
          .from("atom_enrichment_proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_review")
          .eq("proposal_action", "flag_conflict");

        const { assessReadiness, eligibleAtoms } = await import(
          "../../../../supabase/functions/_shared/cv-skills/adapters/career-atom-adapter.ts"
        );
        const rows = (atomRows ?? []) as never[];
        const readiness = assessReadiness({
          rows,
          openProposals: openProposals ?? 0,
          conflicts: conflicts ?? 0,
        });

        // needs_review og blocked_no_evidence gir null modellkall.
        if (readiness.status === "blocked_no_evidence") {
          return fail(409, "blocked_no_evidence", "Du har ikke nok bekreftet grunnlag ennå.", {
            readiness,
          });
        }
        if (readiness.status === "needs_review") {
          return fail(409, "needs_review", "Løs konfliktene i grunnlaget først.", { readiness });
        }

        // -------------------------------------------------- profil/kontakt
        const { data: profile } = await userClient
          .from("profiles")
          .select("full_name, display_name, headline, email, phone, target_city, target_country, linkedin_vanity_url")
          .eq("id", userId)
          .maybeSingle();

        const contact = {
          full_name: profile?.full_name ?? profile?.display_name ?? "",
          headline: profile?.headline ?? null,
          city: profile?.target_city ?? null,
          country: profile?.target_country ?? null,
          phone: profile?.phone ?? null,
          email: profile?.email ?? null,
          linkedin_url: profile?.linkedin_vanity_url
            ? `https://www.linkedin.com/in/${profile.linkedin_vanity_url}`
            : null,
        };

        // ----------------------------------------- frosset snapshot + jobb
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { buildSnapshot, sha256Hex, snapshotHashInput } = await import(
          "../../../../supabase/functions/_shared/cv-skills/generation/contract.ts"
        );

        const eligible = eligibleAtoms(rows);
        const frozenAt = new Date().toISOString();
        const snapshot = buildSnapshot(eligible, {}, frozenAt);
        const snapshotHash = await sha256Hex(snapshotHashInput(snapshot));

        const { data: profileRow, error: profileError } = await supabaseAdmin.rpc(
          "internal_ai_get_active_profile",
          { p_task_key: "cv_general_generation" },
        );
        if (profileError || !profileRow) {
          return fail(500, "server_misconfigured", "Genereringen er ikke tilgjengelig akkurat nå.");
        }

        const { data: created, error: createError } = await supabaseAdmin.rpc(
          "internal_ai_create_cv_generation",
          {
            p_user_id: userId,
            p_title: parsed.data.title ?? "Generell CV",
            p_presentation: {
              language: parsed.data.language ?? "no",
              includeContact: parsed.data.includeContact !== false,
            },
            p_atom_ids: eligible.map((a) => a.id),
            p_snapshot: snapshot as never,
            p_snapshot_hash: snapshotHash,
            p_readiness: readiness as never,
            p_profile_id: (profileRow as { profile_id: string }).profile_id,
          },
        );
        if (createError) {
          console.error("[cv-generations] create failed", JSON.stringify({ correlationId }));
          return fail(500, "database_error", "Kunne ikke starte genereringen.");
        }
        const res = (created ?? {}) as {
          ok?: boolean;
          error_code?: string;
          job_id?: string;
          document_group_id?: string;
          document_version_id?: string;
          status?: string;
          step?: string;
        };
        if (res.ok !== true) {
          const code = res.error_code === "active_run" ? "active_run" : "database_error";
          return fail(
            code === "active_run" ? 429 : 500,
            code,
            code === "active_run"
              ? "En generering pågår allerede."
              : "Kunne ikke starte genereringen.",
          );
        }

        // Kontaktdata legges på jobben etter opprettelse — modellen ser dem aldri.
        await supabaseAdmin.rpc("internal_ai_set_job_contact" as never, {} as never).catch?.(
          () => undefined,
        );
        await supabaseAdmin
          .from("cv_generation_jobs")
          .update({
            input_payload: {
              variant: "general",
              presentation: {
                language: parsed.data.language ?? "no",
                includeContact: parsed.data.includeContact !== false,
              },
              document_id: res.document_version_id,
              snapshot_hash: snapshotHash,
              readiness,
              contact,
            } as never,
          })
          .eq("id", res.job_id!);

        return Response.json({
          ok: true,
          jobId: res.job_id,
          documentGroupId: res.document_group_id,
          documentVersionId: res.document_version_id,
          status: res.status ?? "queued",
          step: res.step ?? "prepare_snapshot",
          readiness,
        });
      },
    },
  },
});
