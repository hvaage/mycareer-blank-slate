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

        const { data, error } = await auth.userClient
          .from("linkedin_imports")
          .select(
            "id, status, error_code, error_summary, active_phase, heartbeat_at, created_at, staged_at, staged_record_count, known_file_count, unknown_file_count, excluded_file_count, invalid_file_count, purged_at, archive_available",
          )
          .order("created_at", { ascending: false })
          .limit(20);
        if (error) return fail(500, "database_error", "Kunne ikke hente importene dine.");

        const imports = (data ?? []) as Array<Record<string, unknown>>;
        const ids = imports.map((i) => i["id"] as string);


        // Fremdrift kommer fra forsøkstabellen, ikke fra denne forespørselen:
        // arbeideren jobber videre uavhengig av om nettleseren er åpen.
        let attempts: Array<Record<string, unknown>> = [];
        if (ids.length > 0) {
          const { data: attemptRows } = await auth.userClient
            .from("linkedin_import_attempts")
            .select(
              "id, linkedin_import_id, attempt_number, status, phase, retry_count, max_attempts, next_retry_at, heartbeat_at, processed_files_count, staged_records_count, warning_count, error_code, created_at",
            )
            .in("linkedin_import_id", ids)
            .order("attempt_number", { ascending: false });
          attempts = attemptRows ?? [];
        }

        const latestByImport = new Map<string, Record<string, unknown>>();
        for (const a of attempts) {
          const key = a["linkedin_import_id"] as string;
          if (!latestByImport.has(key)) latestByImport.set(key, a);
        }

        return Response.json({
          ok: true,
          imports: imports.map((i) => ({
            ...i,
            latest_attempt: latestByImport.get(i["id"] as string) ?? null,

          })),
        });
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
              // Settes først når ZIP-filen faktisk ligger i lagringen.
              archive_available: false,
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

          const activeStatuses = ["uploaded", "validating", "staging", "staged", "reconciliation_ready"];
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

        // Lagring av arkivet er en forutsetning for bakgrunnskjøring.
        // Feiler den, feiler importen kontrollert her og nå.
        const storagePath = `${userId}/${importId}.zip`;
        const upload = await supabaseAdmin.storage
          .from("linkedin-imports")
          .upload(storagePath, archive, { contentType: "application/zip", upsert: true });

        if (upload.error) {
          console.error("[linkedin/imports] storage upload failed", upload.error.message);
          await supabaseAdmin
            .from("linkedin_imports")
            .update({
              status: "failed",
              error_code: "archive_storage_failed",
              error_summary: "Arkivet kunne ikke lagres.",
            })
            .eq("id", importId);
          return fail(500, "archive_storage_failed", "Arkivet kunne ikke lagres. Prøv igjen.");
        }

        await supabaseAdmin
          .from("linkedin_imports")
          .update({ archive_storage_path: storagePath, archive_available: true })
          .eq("id", importId);

        const { data: attemptId, error: enqueueError } = await supabaseAdmin.rpc(
          "linkedin_import_enqueue",
          { p_import_id: importId },
        );
        if (enqueueError) {
          console.error("[linkedin/imports] enqueue failed", enqueueError.code);
          return fail(500, "enqueue_failed", "Importen kunne ikke settes i kø. Prøv igjen.");
        }

        // Umiddelbar kvittering. Videre arbeid skjer i bakgrunnen, og brukeren
        // får varsel i appen når importen er ferdig.
        return Response.json(
          {
            ok: true,
            import_id: importId,
            attempt_id: attemptId,
            status: "queued",
            message:
              "Importen er mottatt og kjøres i bakgrunnen. Du kan lukke siden — du får varsel når den er klar til gjennomgang.",
          },
          { status: 202 },
        );
      },
    },
  },
});

