// POST /api/linkedin/imports — brukerens opplasting av LinkedIn-eksport (ZIP).
// GET  /api/linkedin/imports — brukerens egne importer (status og tellere).
//
// Sikkerhetskontrakt:
//   - krever gyldig pålogging (Bearer-token verifiseres før all databasekontakt)
//   - skriving skjer med adminklient først ETTER at bruker-id er verifisert
//   - ruten skriver aldri til produktdata; kun linkedin_*-tabellene
//   - svar inneholder aldri LinkedIn-innhold, kun tellere, status og feilkoder

import { createFileRoute } from "@tanstack/react-router";
import { LINKEDIN_PURPOSES, LINKEDIN_LIMITS } from "@/lib/linkedin/contract";

function fail(status: number, code: string, message: string) {
  return Response.json({ ok: false, error: { code, message } }, { status });
}

async function authenticate(request: Request) {
  const { createClient } = await import("@supabase/supabase-js");
  const supabaseUrl = process.env["SUPABASE_URL"];
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!supabaseUrl || !publishableKey) {
    return { error: fail(500, "server_misconfigured", "Backend er ikke ferdig konfigurert.") };
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length < 16) {
    return { error: fail(401, "unauthorized", "Mangler gyldig pålogging.") };
  }
  const userClient = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  const { data } = await userClient.auth.getUser();
  const userId = data?.user?.id;
  if (!userId) return { error: fail(401, "unauthorized", "Mangler gyldig pålogging.") };
  return { userClient, userId };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const Route = createFileRoute("/api/linkedin/imports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;

        // Importer som ble avbrutt underveis (f.eks. tidsavbrudd) markeres som
        // feilet slik at brukeren ser hva som skjedde og kan prøve på nytt.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        await supabaseAdmin
          .from("linkedin_imports")
          .update({ status: "failed", error_code: "import_interrupted", active_phase: null, heartbeat_at: null })
          .eq("user_id", auth.userId)
          .in("status", ["uploaded", "validating", "staging"])
          .lt("created_at", staleBefore);

        const { data, error } = await auth.userClient
          .from("linkedin_imports")
          .select(
            "id, status, error_code, created_at, staged_at, staged_record_count, known_file_count, unknown_file_count, excluded_file_count, invalid_file_count, purged_at",
          )
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return fail(500, "database_error", "Kunne ikke hente importene dine.");
        return Response.json({ ok: true, imports: data ?? [] });
      },


      POST: async ({ request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return auth.error;
        const { userId } = auth;

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return fail(400, "invalid_body", "Kunne ikke lese opplastingen.");
        }

        const file = form.get("file");
        if (!(file instanceof File)) {
          return fail(400, "invalid_body", "Legg ved ZIP-filen fra LinkedIn.");
        }
        if (file.size > LINKEDIN_LIMITS.maxCompressedBytes) {
          return fail(413, "archive_too_large", "Arkivet er for stort.");
        }

        const rawPurposes = form.getAll("purposes").flatMap((v) => String(v).split(","));
        const purposes = Array.from(
          new Set(
            rawPurposes
              .map((p) => p.trim())
              .filter((p): p is (typeof LINKEDIN_PURPOSES)[number] =>
                (LINKEDIN_PURPOSES as readonly string[]).includes(p),
              ),
          ),
        );
        if (purposes.length === 0) {
          return fail(400, "no_purpose_selected", "Velg minst ett formål for importen.");
        }

        const archive = new Uint8Array(await file.arrayBuffer());
        const archiveSha256 = await sha256Hex(archive);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const insertImportRow = async () =>
          await supabaseAdmin
            .from("linkedin_imports")
            .insert({
              user_id: userId,
              archive_sha256: archiveSha256,
              status: "uploaded",
              archive_available: true,
            })
            .select("id")
            .single();

        let { data: importRow, error: insertError } = await insertImportRow();

        // Partial unique index (user_id, archive_sha256) where purged_at is null
        // and status <> 'cancelled': the same archive was uploaded before.
        if (insertError?.code === "23505") {
          const { data: existing } = await supabaseAdmin
            .from("linkedin_imports")
            .select("id, status")
            .eq("user_id", userId)
            .eq("archive_sha256", archiveSha256)
            .is("purged_at", null)
            .neq("status", "cancelled")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const activeStatuses = ["uploaded", "validating", "staged", "reconciliation_ready"];
          if (existing && activeStatuses.includes(existing.status as string)) {
            return fail(
              409,
              "import_already_exists",
              "Denne LinkedIn-eksporten er allerede lastet opp. Fullfør eller avbryt den pågående importen først.",
            );
          }

          if (existing) {
            await supabaseAdmin
              .from("linkedin_imports")
              .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
              .eq("id", existing.id)
              .eq("user_id", userId);
            ({ data: importRow, error: insertError } = await insertImportRow());
          }
        }

        if (insertError || !importRow) {
          console.error("[linkedin/imports] insert failed", insertError);
          return fail(500, "database_error", "Kunne ikke registrere importen.");
        }
        const importId = importRow.id as string;


        const { error: purposeError } = await supabaseAdmin
          .from("linkedin_import_purposes")
          .insert(
            purposes.map((purpose) => ({
              linkedin_import_id: importId,
              user_id: userId,
              purpose,
              selection_source: "user_input",
            })),
          );
        if (purposeError) {
          return fail(500, "database_error", "Kunne ikke lagre formålene for importen.");
        }

        const attemptId = crypto.randomUUID();
        await supabaseAdmin
          .from("linkedin_imports")
          .update({
            active_phase: "validation",
            attempt_id: attemptId,
            heartbeat_at: new Date().toISOString(),
            staging_started_at: new Date().toISOString(),
          })
          .eq("id", importId);

        try {
          const { validateAndStageArchive } = await import("@/lib/linkedin/stage.server");
          const outcome = await validateAndStageArchive({
            admin: supabaseAdmin as never,
            userId,
            importId,
            attemptId,
            archive,
            selectedPurposes: purposes,
          });

          await supabaseAdmin
            .from("linkedin_imports")
            .update({
              status: outcome.ok ? "reconciliation_ready" : outcome.status,
              error_code: outcome.errorCode ?? null,
              active_phase: null,
              heartbeat_at: null,
              content_manifest_hash: outcome.contentManifestHash || null,
              known_file_count: outcome.knownFileCount,
              unknown_file_count: outcome.unknownFileCount,
              excluded_file_count: outcome.excludedFileCount,
              valid_file_count: outcome.validFileCount,
              invalid_file_count: outcome.invalidFileCount,
              staged_record_count: outcome.stagedRecordCount,
              excluded_reason_counts: outcome.excludedReasonCounts,
              validated_at: new Date().toISOString(),
              staged_at: outcome.ok ? new Date().toISOString() : null,
            })
            .eq("id", importId);

          if (!outcome.ok) {
            return Response.json(
              {
                ok: false,
                import_id: importId,
                status: outcome.status,
                error: {
                  code: outcome.errorCode ?? "staging_failed",
                  message: "Arkivet kunne ikke leses. Last ned en ny eksport og prøv igjen.",
                },
              },
              { status: 422 },
            );
          }

          // Avstemming: deterministisk, skriver kun forslag — aldri produktdata.
          const { runReconciliation } = await import("@/lib/linkedin/reconciliation/engine.server");
          const result = await runReconciliation(supabaseAdmin as never, { userId, importId });

          return Response.json({
            ok: true,
            import_id: importId,
            status: "reconciliation_ready",
            counts: {
              known: outcome.knownFileCount,
              unknown: outcome.unknownFileCount,
              excluded: outcome.excludedFileCount,
              invalid: outcome.invalidFileCount,
              staged_records: outcome.stagedRecordCount,
            },
            proposals: result.ok
              ? result.runs.reduce((sum, r) => sum + (r.proposals ?? 0), 0)
              : 0,
          });
        } catch (error) {
          console.error(
            "[linkedin-imports] staging failed",
            error instanceof Error ? error.name : "unknown",
          );
          await supabaseAdmin
            .from("linkedin_imports")
            .update({
              status: "failed",
              error_code: "worker_error",
              active_phase: null,
              heartbeat_at: null,
            })
            .eq("id", importId);
          return fail(500, "staging_failed", "Importen feilet. Prøv igjen.");
        }
      },
    },
  },
});
