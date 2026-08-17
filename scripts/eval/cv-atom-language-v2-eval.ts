/**
 * Evaluering av cv-atom-language-no v1 vs v2.1.0 på én frossen CV-import.
 *
 * Kjøres manuelt: bun scripts/eval/cv-atom-language-v2-eval.ts <cv_import_id>
 *
 * v2 kjøres som dry run: modellen kalles, men ingen forslag skrives.
 * v1-tallene leses fra allerede lagrede forslag for samme import, slik at
 * evalueringen ikke produserer nye rader i produksjonsdata.
 *
 * Skriptet rapporterer: antall roller, feilplasserte resultater, lange
 * kompetansebegreper, kanarietesten for Cisco, tokenbruk og varighet.
 */
import { createClient } from "@supabase/supabase-js";
import { runProposeCvAtomsV2 } from "../../supabase/functions/_shared/cv-skills/propose-atoms-runner-v2.ts";
import { buildAtomizationInput } from "../../supabase/functions/_shared/cv-skills/role-block-preparser.ts";

const importId = process.argv[2];
if (!importId) {
  console.error("Bruk: bun scripts/eval/cv-atom-language-v2-eval.ts <cv_import_id>");
  process.exit(1);
}

const admin = createClient(
  process.env["SUPABASE_URL"]!,
  process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
  { auth: { persistSession: false } },
);

const { data: importRow } = await admin
  .from("cv_imports")
  .select("id, user_id")
  .eq("id", importId)
  .maybeSingle();
if (!importRow) throw new Error("fant ikke importen");

const { data: candidates } = await admin
  .from("cv_parse_candidates")
  .select("id, local_ref, parent_local_ref, suggested_atom_type, content_no, structured_data")
  .eq("import_id", importId);

const rows = (candidates ?? []) as never[];
const preparsed = buildAtomizationInput(rows);
console.log("=== Pre-parser ===");
console.log("kildespenn:", preparsed.sourceSpans.length);
console.log("rolleblokker:", preparsed.roleBlocks.length);
for (const block of preparsed.roleBlocks) {
  console.log(
    ` - ${block.id} | ${block.employer ?? "?"} | ${block.title ?? "?"} | group=${block.employmentGroupKey} | hints=${(block.appointmentHints ?? []).join(",") || "-"}`,
  );
}

// --- v1-referanse fra lagrede forslag -------------------------------------
const { data: v1Rows } = await admin
  .from("atom_enrichment_proposals")
  .select("proposal_payload, source_import_id, prompt_version")
  .eq("source_import_id", importId);
const v1 = (v1Rows ?? []).filter((r: any) => String(r.prompt_version ?? "").startsWith("1."));
const v1Roles = v1.filter((r: any) => r.proposal_payload?.atom_type === "role");
console.log("\n=== v1 (lagrede forslag) ===");
console.log("forslag totalt:", v1.length, "| roller:", v1Roles.length);

// --- v2 dry run ------------------------------------------------------------
const result = await runProposeCvAtomsV2({
  userClient: admin,
  adminClient: admin,
  anthropicApiKey: process.env["ANTHROPIC_API_KEY"]!,
  userId: importRow.user_id,
  cvImportId: importId,
  allCandidates: rows,
  selectedRefs: rows.map((c: any) => c.local_ref),
  correlationId: crypto.randomUUID(),
  startedAt: Date.now(),
  dryRun: true,
});

console.log("\n=== v2.1.0 (dry run) ===");
if (!result.body["ok"]) {
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(1);
}
const out = result.body["output"] as any;
console.log("roller:", out.roles.length);
for (const role of out.roles) {
  console.log(
    ` - ${role.localId} | ${role.employer ?? "?"} | ${role.title ?? "?"} | ${role.startDate ?? "?"}–${role.endDate ?? "?"} | ${role.appointmentRelation} | ${role.status}`,
  );
}
console.log("resultater:", out.achievements.length);
console.log(
  "resultater uten rolle:",
  out.achievements.filter((a: any) => !a.roleLocalId).length,
);
console.log("kompetanser:", out.skills.length);
console.log("kvalifikasjoner:", out.qualifications.length);
console.log("kvalitetsporter:", JSON.stringify(result.body["quality_gates"]));
console.log("forkastet:", JSON.stringify(result.body["dropped"]));
console.log("forbruk:", JSON.stringify(result.body["usage"]));

// --- Kanarietest: Cisco ----------------------------------------------------
const ciscoRoles = out.roles.filter((r: any) =>
  String(r.employer ?? "").toLowerCase().includes("cisco"),
);
console.log("\n=== Kanarietest Cisco ===");
console.log("Cisco-roller foreslått:", ciscoRoles.length);
for (const r of ciscoRoles) console.log(` - ${r.title} (${r.appointmentRelation}, ${r.status})`);
const titles = ciscoRoles.map((r: any) => String(r.title ?? "").toLowerCase());
const expects = ["team lead", "architecture lead", "coo"];
for (const t of expects) {
  console.log(`${titles.some((x: string) => x.includes(t)) ? "OK  " : "MANGLER"} ${t}`);
}
