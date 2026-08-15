// deno-lint-ignore-file no-explicit-any
// commit-cv-import — Skjema-versjon 4.0 (parselaget)
//
// Leser cv_imports.raw_parsed_data, konverterer til parsekandidater og skriver
// dem til public.cv_parse_candidates.
//
// VIKTIG: denne funksjonen skriver ALDRI til career_atoms. Importen lander i
// parselaget. Det er gjennomgangen som promoterer en kandidat til et atom,
// etter at brukeren har bekreftet den. Ingenting herfra er evidens.
//
// Treet bæres av local_ref / parent_local_ref. Går det tapt her, kan
// gjennomgangen ikke vise achievements under riktig rolle.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  convertOldCv,
  type ParsedOldCv,
} from "../_shared/cv-evidence-graph/converters/old-cv.ts";
import {
  fetchImportCandidates,
  insertCandidates,
} from "../_shared/cv-evidence-graph/crud.ts";
import {
  findDuplicates,
} from "../_shared/cv-evidence-graph/deduplicate.ts";
import {
  validateCandidate,
  validateCandidateGraph,
} from "../_shared/cv-evidence-graph/validators.ts";
import {
  toCandidateInsert,
  type CandidateDraft,
  type CandidateInsert,
} from "../_shared/cv-evidence-graph/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(
  error: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error, message, ...extra }, status);
}

interface DroppedCandidate {
  local_ref: string;
  suggested_atom_type: string;
  summary: string;
  reason: string;
}

function summarize(c: CandidateDraft): string {
  const sd = (c.structured_data ?? {}) as Record<string, any>;
  switch (c.suggested_atom_type) {
    case "role":
      return `${sd.title ?? "?"} @ ${sd.employer ?? "?"} (${sd.start_date ?? "?"}–${sd.end_date ?? "nå"})`;
    case "education":
      return `${sd.degree ?? "?"} @ ${sd.institution ?? "?"}`;
    case "skill":
    case "domain":
    case "tool":
      return String(sd.name ?? c.content_no ?? c.content_en ?? "?");
    case "language":
      return `${sd.language ?? "?"}${sd.level ? ` (${sd.level})` : ""}`;
    case "certification":
      return `${sd.name ?? "?"} — ${sd.issuer ?? "?"}`;
    default:
      return String(c.content_no ?? c.content_en ?? sd.what ?? JSON.stringify(sd))
        .slice(0, 120);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Bruk POST.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonError("unauthorized", "Du må være innlogget.", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError("unauthorized", "Du må være innlogget.", 401);
  }

  let body: { import_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_input", "Kunne ikke lese JSON-body.", 400);
  }

  const importId = body.import_id;
  if (typeof importId !== "string" || !UUID_RE.test(importId)) {
    return jsonError(
      "invalid_input",
      "import_id mangler eller er ikke en gyldig UUID.",
      400,
    );
  }

  // -----------------------------------------------------------------------
  // Fetch and validate import row
  // -----------------------------------------------------------------------
  const { data: importRow, error: fetchError } = await supabase
    .from("cv_imports")
    .select("*")
    .eq("id", importId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    console.error("Failed to fetch cv_imports row:", fetchError);
    return jsonError("database_error", "Kunne ikke hente import-rad.", 500);
  }
  if (!importRow) {
    return jsonError("not_found", "Import ble ikke funnet.", 404);
  }
  if (importRow.status === "committed") {
    return jsonError(
      "already_committed",
      "Denne importen er allerede committed.",
      400,
      { import_id: importId },
    );
  }
  if (importRow.status !== "parsed") {
    return jsonError(
      "invalid_status",
      `Status må være 'parsed', er '${importRow.status}'.`,
      400,
      { import_id: importId },
    );
  }
  if (!importRow.raw_parsed_data || typeof importRow.raw_parsed_data !== "object") {
    return jsonError(
      "invalid_status",
      "Import-rad mangler raw_parsed_data.",
      400,
      { import_id: importId },
    );
  }

  const sourceFormat: "pdf" | "docx" =
    importRow.import_type === "old_cv_pdf" ? "pdf" : "docx";

  // -----------------------------------------------------------------------
  // Convert → flat kandidatliste med local_ref-tre
  // -----------------------------------------------------------------------
  let conversion;
  try {
    conversion = convertOldCv(
      importRow.raw_parsed_data as ParsedOldCv,
      {
        user_id: user.id,
        import_id: importRow.id,
        source_format: sourceFormat,
      },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("convertOldCv failed:", msg);
    await supabase
      .from("cv_imports")
      .update({
        status: "failed",
        error_message: `conversion_failed: ${msg.slice(0, 800)}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("user_id", user.id);
    return jsonError(
      "conversion_failed",
      `Konvertering feilet: ${msg}`,
      500,
      { import_id: importId },
    );
  }

  const dropped: DroppedCandidate[] = [];
  const skippedLog: { reason: string; context: string }[] = conversion.skipped;

  // -----------------------------------------------------------------------
  // Validate hver kandidat. Faller en rolle bort, faller barna med — men
  // begge deler rapporteres, ingenting forsvinner stille.
  // -----------------------------------------------------------------------
  const perCandidateValid: CandidateDraft[] = [];
  for (const c of conversion.candidates) {
    const r = validateCandidate(c);
    if (r.ok) {
      perCandidateValid.push(c);
    } else {
      dropped.push({
        local_ref: c.local_ref,
        suggested_atom_type: c.suggested_atom_type,
        summary: summarize(c),
        reason: r.error ?? "ukjent valideringsfeil",
      });
    }
  }

  const survivingRefs = new Set(perCandidateValid.map((c) => c.local_ref));
  const withIntactParents: CandidateDraft[] = [];
  for (const c of perCandidateValid) {
    if (c.parent_local_ref != null && !survivingRefs.has(c.parent_local_ref)) {
      dropped.push({
        local_ref: c.local_ref,
        suggested_atom_type: c.suggested_atom_type,
        summary: summarize(c),
        reason:
          `forelderen ${c.parent_local_ref} falt bort i validering — konteksten ville gått tapt`,
      });
      continue;
    }
    withIntactParents.push(c);
  }

  // Hele treet må henge sammen før vi skriver noe.
  const graphResult = validateCandidateGraph(withIntactParents);
  if (!graphResult.ok) {
    return jsonError(
      "invalid_graph",
      `Kandidattreet henger ikke sammen: ${graphResult.error}`,
      422,
      { import_id: importId, dropped, skipped_log: skippedLog },
    );
  }

  // -----------------------------------------------------------------------
  // Dedup mot kandidater som allerede ligger i denne importen (re-kjøring).
  // Vi slår ikke sammen mot andre importer: brukeren skal se hver kilde.
  // -----------------------------------------------------------------------
  let existing;
  try {
    existing = await fetchImportCandidates(supabase as any, importId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fetchImportCandidates failed:", msg);
    return jsonError("database_error", `Kunne ikke lese kandidater: ${msg}`, 500, {
      import_id: importId,
    });
  }

  const duplicateRefs = new Set<string>();
  if (existing.length > 0) {
    for (const pair of findDuplicates(withIntactParents, existing)) {
      duplicateRefs.add((pair.incoming as CandidateDraft).local_ref);
    }
  }

  const toInsert: CandidateInsert[] = withIntactParents
    .filter((c) => !duplicateRefs.has(c.local_ref))
    .map((c) => toCandidateInsert(c, { user_id: user.id, import_id: importId }));

  // -----------------------------------------------------------------------
  // Skriv til parselaget — én batch, slik at treet lander samlet
  // -----------------------------------------------------------------------
  let inserted: number;
  try {
    const result = await insertCandidates(supabase as any, toInsert);
    inserted = result.inserted.length;
    for (const r of result.rejected) {
      dropped.push({
        local_ref: r.candidate.local_ref,
        suggested_atom_type: r.candidate.suggested_atom_type,
        summary: summarize(r.candidate),
        reason: r.error,
      });
    }
    if (inserted === 0 && toInsert.length > 0) {
      return jsonError(
        "database_error",
        "Ingen kandidater ble skrevet. Se dropped for årsak.",
        500,
        { import_id: importId, dropped, skipped_log: skippedLog },
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("insertCandidates failed:", msg);
    return jsonError("database_error", `Kunne ikke skrive kandidater: ${msg}`, 500, {
      import_id: importId,
      dropped,
      skipped_log: skippedLog,
    });
  }

  // -----------------------------------------------------------------------
  // Tell og avslutt
  // -----------------------------------------------------------------------
  const { count: candidatesTotal, error: countError } = await supabase
    .from("cv_parse_candidates")
    .select("*", { count: "exact", head: true })
    .eq("import_id", importId);

  if (countError) {
    console.warn("count failed:", countError);
  }

  const { error: finalizeError } = await supabase
    .from("cv_imports")
    .update({
      status: "committed",
      atoms_created_count: inserted,
      atoms_committed_count: 0, // ingenting er promotert til atomer ennå
      committed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("user_id", user.id);

  if (finalizeError) {
    console.error("Failed to finalize cv_imports row:", finalizeError);
    return jsonError(
      "database_error",
      `Kandidatene ble skrevet, men importen kunne ikke markeres ferdig: ${finalizeError.message}`,
      500,
      { import_id: importId, candidates_created: inserted, dropped },
    );
  }

  const roleCount = toInsert.filter((c) => c.suggested_atom_type === "role").length;
  const childCount = toInsert.filter((c) => c.parent_local_ref != null).length;

  return jsonResponse({
    import_id: importId,
    status: "committed",
    layer: "parse_candidates",
    candidates_created: inserted,
    candidates_duplicate_skipped: duplicateRefs.size,
    candidates_total_in_import: candidatesTotal ?? inserted,
    roles: roleCount,
    children_with_parent: childCount,
    atoms_created: 0,
    note:
      "Kandidatene venter på gjennomgang. Ingenting er evidens før brukeren har bekreftet det.",
    dropped,
    skipped_log: skippedLog,
  });
});
