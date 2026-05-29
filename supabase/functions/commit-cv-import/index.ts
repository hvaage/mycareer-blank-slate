// deno-lint-ignore-file no-explicit-any
// commit-cv-import — leser cv_imports.raw_parsed_data, konverterer til atoms,
// dedupliserer mot eksisterende, og skriver til cv_evidence_atoms.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  convertOldCv,
  type ParsedOldCv,
} from "../_shared/cv-evidence-graph/converters/old-cv.ts";
import {
  fetchUserAtoms,
  insertAtomTree,
} from "../_shared/cv-evidence-graph/crud.ts";
import {
  findDuplicates,
  mergeAtoms,
} from "../_shared/cv-evidence-graph/deduplicate.ts";
import { validateAtom } from "../_shared/cv-evidence-graph/validators.ts";
import type { AtomInsert, CvAtom } from "../_shared/cv-evidence-graph/types.ts";

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

interface ValidationWarning {
  atom_type: string;
  error: string;
}

interface MergeEvent {
  atom_type: string;
  incoming_summary: string;
  existing_summary: string;
  existing_id: string;
  reason: string;
  confidence: number;
  action: "merged";
}

function summarizeAtom(a: { atom_type: string; content_no?: string | null; content_en?: string | null; structured_data?: unknown }): string {
  const sd = (a.structured_data ?? {}) as Record<string, any>;
  switch (a.atom_type) {
    case "role":
      return `${sd.title ?? "?"} @ ${sd.employer ?? "?"} (${sd.start_date ?? "?"}–${sd.end_date ?? "nå"})`;
    case "education":
      return `${sd.degree ?? "?"} @ ${sd.institution ?? "?"}`;
    case "skill":
      return sd.name ?? a.content_no ?? a.content_en ?? "?";
    case "language":
      return `${sd.language ?? "?"}${sd.proficiency ? ` (${sd.proficiency})` : ""}`;
    case "certification":
      return `${sd.name ?? "?"} — ${sd.issuer ?? "?"}`;
    case "project":
      return sd.name ?? a.content_no ?? "?";
    case "achievement":
      return (a.content_no ?? a.content_en ?? sd.what ?? "?").toString().slice(0, 120);
    default:
      return (a.content_no ?? a.content_en ?? JSON.stringify(sd)).toString().slice(0, 120);
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
  // Convert
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

  // -----------------------------------------------------------------------
  // Validate
  // -----------------------------------------------------------------------
  const validationWarnings: ValidationWarning[] = [];
  const skippedLog: { reason: string; context: string }[] = [];
  for (const item of conversion.skipped) {
    validationWarnings.push({ atom_type: "skipped", error: item.reason });
    skippedLog.push({ reason: item.reason, context: item.context });
  }

  const validStandalone: AtomInsert[] = [];
  for (const atom of conversion.standalone_atoms) {
    const r = validateAtom(atom);
    if (r.ok) validStandalone.push(atom);
    else validationWarnings.push({ atom_type: atom.atom_type, error: r.error ?? "ukjent" });
  }

  const validRoleTrees: typeof conversion.role_trees = [];
  for (const tree of conversion.role_trees) {
    const roleResult = validateAtom(tree.role);
    if (!roleResult.ok) {
      validationWarnings.push({ atom_type: "role", error: roleResult.error ?? "ukjent" });
      continue;
    }
    const validAchievements: Omit<AtomInsert, "parent_atom_id">[] = [];
    for (const ach of tree.achievements) {
      // Achievements krever parent_atom_id i validator — bruk midlertidig placeholder
      const r = validateAtom({
        ...(ach as AtomInsert),
        parent_atom_id: "00000000-0000-0000-0000-000000000000",
      });
      if (r.ok) validAchievements.push(ach);
      else validationWarnings.push({ atom_type: "achievement", error: r.error ?? "ukjent" });
    }
    validRoleTrees.push({ role: tree.role, achievements: validAchievements });
  }

  // -----------------------------------------------------------------------
  // Fetch existing for dedup
  // -----------------------------------------------------------------------
  let existingAtoms: CvAtom[];
  try {
    existingAtoms = await fetchUserAtoms(supabase as any, user.id, {
      onlyConfirmed: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("fetchUserAtoms failed:", msg);
    return jsonError("database_error", `Kunne ikke hente atoms: ${msg}`, 500, {
      import_id: importId,
    });
  }

  let atomsCreated = 0;
  let atomsMerged = 0;
  const mergeLog: MergeEvent[] = [];

  // -----------------------------------------------------------------------
  // Standalone — dedup + insert/merge one by one
  // -----------------------------------------------------------------------
  try {
    for (const atom of validStandalone) {
      const dupes = findDuplicates([atom], existingAtoms);
      if (dupes.length > 0) {
        const dupe = dupes[0];
        const merged = mergeAtoms(dupe.existing, atom);
        const { error: updateError } = await supabase
          .from("cv_evidence_atoms")
          .update({ ...merged, updated_at: new Date().toISOString() })
          .eq("id", dupe.existing.id)
          .eq("user_id", user.id);
        if (updateError) throw new Error(`update: ${updateError.message}`);
        atomsMerged++;
        mergeLog.push({
          atom_type: atom.atom_type,
          incoming_summary: summarizeAtom(atom),
          existing_summary: summarizeAtom(dupe.existing),
          existing_id: dupe.existing.id,
          reason: dupe.reason,
          confidence: dupe.confidence,
          action: "merged",
        });
      } else {
        const { data, error: insertError } = await supabase
          .from("cv_evidence_atoms")
          .insert(atom)
          .select("*")
          .single();
        if (insertError) throw new Error(`insert: ${insertError.message}`);
        if (data) {
          atomsCreated++;
          existingAtoms.push(data as unknown as CvAtom);
        }
      }
    }

    // ---------------------------------------------------------------------
    // Role-trees
    // ---------------------------------------------------------------------
    for (const tree of validRoleTrees) {
      const dupes = findDuplicates([tree.role], existingAtoms);
      let parentId: string;

      if (dupes.length > 0) {
        const dupe = dupes[0];
        parentId = dupe.existing.id;
        const merged = mergeAtoms(dupe.existing, tree.role);
        const { error: updateError } = await supabase
          .from("cv_evidence_atoms")
          .update({ ...merged, updated_at: new Date().toISOString() })
          .eq("id", parentId)
          .eq("user_id", user.id);
        if (updateError) throw new Error(`update role: ${updateError.message}`);
        atomsMerged++;
        mergeLog.push({
          atom_type: "role",
          incoming_summary: summarizeAtom(tree.role),
          existing_summary: summarizeAtom(dupe.existing),
          existing_id: parentId,
          reason: dupe.reason,
          confidence: dupe.confidence,
          action: "merged",
        });

        // Insert achievements direkte med kjent parent_atom_id
        if (tree.achievements.length > 0) {
          const rows = tree.achievements.map((a) => ({
            ...a,
            parent_atom_id: parentId,
          }));
          const { data, error: insertError } = await supabase
            .from("cv_evidence_atoms")
            .insert(rows)
            .select("id");
          if (insertError) throw new Error(`insert achievements: ${insertError.message}`);
          atomsCreated += data?.length ?? 0;
        }
      } else {
        // Bruk insertAtomTree-helperen
        const result = await insertAtomTree(
          supabase as any,
          tree.role,
          tree.achievements as AtomInsert[],
        );
        atomsCreated += 1 + result.children.length;
        existingAtoms.push(result.parent);
        for (const child of result.children) existingAtoms.push(child);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Database write failed mid-commit:", msg);
    return jsonError(
      "database_error",
      `Database-feil under skriving (partiell commit bevart): ${msg}`,
      500,
      {
        import_id: importId,
        atoms_created_so_far: atomsCreated,
        atoms_merged_so_far: atomsMerged,
        merge_log: mergeLog,
      },
    );
  }

  // -----------------------------------------------------------------------
  // Count and finalize
  // -----------------------------------------------------------------------
  const { count: atomsTotalNow, error: countError } = await supabase
    .from("cv_evidence_atoms")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) {
    console.warn("count failed:", countError);
  }

  const { error: finalizeError } = await supabase
    .from("cv_imports")
    .update({
      status: "committed",
      atoms_created_count: atomsCreated,
      atoms_committed_count: atomsCreated,
      committed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", importId)
    .eq("user_id", user.id);

  if (finalizeError) {
    console.error("Failed to finalize cv_imports row:", finalizeError);
    return jsonError(
      "database_error",
      `Atoms ble skrevet, men kunne ikke markere import som committed: ${finalizeError.message}`,
      500,
      {
        import_id: importId,
        atoms_created: atomsCreated,
        atoms_merged: atomsMerged,
      },
    );
  }

  return jsonResponse({
    import_id: importId,
    status: "committed",
    atoms_created: atomsCreated,
    atoms_merged: atomsMerged,
    atoms_skipped: 0,
    atoms_total_now: atomsTotalNow ?? 0,
    validation_warnings: validationWarnings,
    merge_log: mergeLog,
    skipped_log: skippedLog,
  });
});
