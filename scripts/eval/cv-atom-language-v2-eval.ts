/**
 * Kontrollert evaluering av cv-atom-language-no v1 mot v2.1.0 på én frossen
 * CV-import. Begge profiler kjøres som dry run mot nøyaktig samme input:
 * modellen kalles, men ingen forslag skrives.
 *
 * Bruk: bun scripts/eval/cv-atom-language-v2-eval.ts <cv_import_id> [--v1]
 *
 * Rapporterer rolleutnevnelser, rolletopologi (forgjenger og parallellitet),
 * resultatplassering med strukturell kilde, normaliserte kompetanser med
 * kildebelegg, needs_review kontra gjetning, tokenbruk og varighet.
 */
import { createClient } from "@supabase/supabase-js";
import { runProposeCvAtomsV2 } from "../../supabase/functions/_shared/cv-skills/propose-atoms-runner-v2.ts";
import { runProposeCvAtoms } from "../../supabase/functions/_shared/cv-skills/propose-atoms-runner.ts";
import { buildAtomizationInput } from "../../supabase/functions/_shared/cv-skills/role-block-preparser.ts";

const importId = process.argv[2];
const runV1 = process.argv.includes("--v1");
if (!importId) {
  console.error("Bruk: bun scripts/eval/cv-atom-language-v2-eval.ts <cv_import_id> [--v1]");
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
  .select(
    "id, local_ref, parent_local_ref, suggested_atom_type, content_no, source_quote, structured_data, status, promoted_atom_id",
  )
  .eq("import_id", importId);

const rows = (candidates ?? []) as never[];
const preparsed = buildAtomizationInput(rows);
const spanText = new Map(preparsed.sourceSpans.map((s) => [s.id, s.text]));

console.log("=== Pre-parser (frosset input) ===");
console.log("kildespenn:", preparsed.sourceSpans.length);
console.log("rolleblokker:", preparsed.roleBlocks.length);
for (const block of preparsed.roleBlocks) {
  console.log(
    ` - ${block.id} | ${block.employer ?? "?"} | ${block.title ?? "?"} | hints=${(block.appointmentHints ?? []).join(", ") || "-"}`,
  );
}

// --------------------------------------------------------------- v1 dry run
if (runV1) {
  const t0 = Date.now();
  const v1 = await runProposeCvAtoms({
    userClient: admin,
    adminClient: admin,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"]!,
    userId: importRow.user_id,
    cvImportId: importId,
    candidates: rows,
    correlationId: crypto.randomUUID(),
    startedAt: t0,
    dryRun: true,
  });
  console.log("\n=== v1 (dry run) ===");
  if (!v1.body["ok"]) {
    console.log(JSON.stringify(v1.body, null, 2));
  } else {
    const proposals = (v1.body["proposals"] ?? []) as any[];
    const byType = new Map<string, number>();
    for (const p of proposals) {
      const t = String(p.proposal_payload?.atom_type ?? "?");
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const roles = proposals.filter((p) => p.proposal_payload?.atom_type === "role");
    console.log("forslag:", proposals.length, "| per type:", JSON.stringify([...byType]));
    for (const r of roles) {
      const sd = r.proposal_payload?.structured_data ?? {};
      console.log(` - rolle: ${r.proposal_payload?.content_no} | ${sd.start_date ?? "?"}–${sd.end_date ?? "?"}`);
    }
    console.log(
      "roller uten forløpsdata (ingen forgjenger/parallellitet i v1-kontrakten):",
      roles.length,
    );
    console.log("needs_review:", proposals.filter((p: any) =>
      String(p.proposal_payload?.structured_data?.review_state) === "needs_review").length);
    console.log("forkastet:", JSON.stringify(v1.body["dropped"]));
    console.log("forbruk:", JSON.stringify(v1.body["usage"]));
  }
}

// ------------------------------------------------------------- v2.1 dry run
const runV2 = async (pipeline: "hierarchical" | "monolithic") => {
  const t0 = Date.now();
  const res = await runProposeCvAtomsV2({
    userClient: admin,
    adminClient: admin,
    anthropicApiKey: process.env["ANTHROPIC_API_KEY"]!,
    userId: importRow.user_id,
    cvImportId: importId,
    allCandidates: rows,
    selectedRefs: rows.map((c: any) => c.local_ref),
    correlationId: crypto.randomUUID(),
    startedAt: t0,
    dryRun: true,
    pipeline,
  });
  return res;
};

// Monolittisk kjøring tas bare med når den bes om: den koster et fullt kall.
const monolithic = process.argv.includes("--compare") ? await runV2("monolithic") : null;

const result = await runV2("hierarchical");

console.log("\n=== v2.1.0 (dry run) ===");
if (!result.body["ok"]) {
  console.log(JSON.stringify(result.body, null, 2));
  process.exit(1);
}
const out = result.body["output"] as any;
const gates = result.body["quality_gates"] as any;

console.log("roller:", out.roles.length);
for (const role of out.roles) {
  const conc = role.concurrentWithRoleLocalIds.join(",") || "-";
  console.log(
    ` - ${role.localId} | ${role.employer ?? "?"} | ${role.title ?? "(tittel mangler)"} | ${role.startDate ?? "?"}–${role.endDate ?? "?"} | relasjon=${role.appointmentRelation} | forgjenger=${role.predecessorRoleLocalId ?? "-"} | parallelt=${conc} | ${role.status}`,
  );
}

// --- resultatplassering ----------------------------------------------------
const ach = out.achievements as any[];
console.log("\n--- Resultatplassering ---");
console.log("resultater totalt:", ach.length);
console.log(
  "high:", ach.filter((a) => a.placementConfidence === "high").length,
  "| low:", ach.filter((a) => a.placementConfidence === "low").length,
  "| needs_review:", ach.filter((a) => a.placementConfidence === "needs_review").length,
);
console.log("uplassert (tilbake i kø):", ach.filter((a) => !a.roleLocalId).length);
console.log("plasseringskilde:", JSON.stringify(gates.placement.bySource));
console.log("nedgradert fra high (manglet struktur):", JSON.stringify(gates.placement.downgradedFromHigh));

const highs = ach.filter((a) => a.placementConfidence === "high");
console.log("high-plasseringer med strukturell kilde:", highs.length, "av", highs.length,
  highs.every((a) => a.placementSource !== "model_text_only" && a.placementSource !== "none")
    ? "(ingen bygger på tekstlikhet alene)"
    : "(FEIL: minst én mangler struktur)");

const roleLabel = (id: string | null) => {
  const r = out.roles.find((x: any) => x.localId === id);
  return r ? `${r.employer ?? "?"} · ${r.title ?? "(tittel mangler)"}` : "uplassert";
};
console.log("\n--- Fem stikkprøver ---");
const samples = [
  ...ach.filter((a) => roleLabel(a.roleLocalId).toLowerCase().includes("cisco")).slice(0, 2),
  ...ach.filter((a) => roleLabel(a.roleLocalId).toLowerCase().includes("netapp")).slice(0, 2),
  ...ach.filter((a) => !a.roleLocalId).slice(0, 1),
  ...ach,
].slice(0, 5);
for (const a of samples) {
  console.log(
    ` - ${a.localId} | ${roleLabel(a.roleLocalId)} | ${a.placementConfidence}/${a.placementSource}\n   tekst: ${a.normalizedText}\n   kilde: ${a.sourceEvidence.map((e: any) => e.sourceSpanId).join(", ")} → ${(spanText.get(a.sourceEvidence[0]?.sourceSpanId) ?? "").slice(0, 90)}`,
  );
}

// --- kompetanser -----------------------------------------------------------
console.log("\n--- Kompetanser ---");
console.log("kompetanser:", out.skills.length, "| kvalifikasjoner:", out.qualifications.length);
for (const s of out.skills.slice(0, 8)) {
  const refs = s.evidence.flatMap((e: any) => e.sourceEvidence.map((x: any) => x.sourceSpanId));
  console.log(` - ${s.canonicalLabelNo} (${s.canonicalKey}) | inferred=${s.inferred} | ${s.status} | belegg=${refs.join(",") || "-"}`);
}
console.log("kompetanser uten kildebelegg:", out.skills.filter((s: any) =>
  s.evidence.flatMap((e: any) => e.sourceEvidence).length === 0).length);

// --- kostnad og tid --------------------------------------------------------
const usage = result.body["usage"] as any;
console.log("\n--- Kostnad og tid ---");
console.log("forbruk:", JSON.stringify(usage));
console.log(
  "tid per rolleblokk:",
  Math.round(usage.duration_ms / Math.max(1, preparsed.roleBlocks.length)),
  "ms",
);
console.log("kvalitetsporter:", JSON.stringify({
  rolesTotal: gates.rolesTotal,
  rolesNeedsReview: gates.rolesNeedsReview,
  achievementsUnassigned: gates.achievementsUnassigned,
  skillsNeedsReview: gates.skillsNeedsReview,
  mergedRoleSuspicions: gates.mergedRoleSuspicions,
  longSkillLabels: gates.longSkillLabels,
}));
console.log("forkastet:", JSON.stringify(result.body["dropped"]));

// --- kanarietest: Cisco-topologi -------------------------------------------
const cisco = out.roles.filter((r: any) =>
  String(r.employer ?? "").toLowerCase().includes("cisco"),
);
console.log("\n=== Kanarietest: Cisco-topologi ===");
for (const r of cisco) {
  console.log(
    ` - ${r.title ?? "(tittel mangler)"} | ${r.startDate ?? "?"}–${r.endDate ?? "?"} | forgjenger=${r.predecessorRoleLocalId ?? "-"} | parallelt=${r.concurrentWithRoleLocalIds.join(",") || "-"} | ${r.status}`,
  );
}
const titles = cisco.map((r: any) => String(r.title ?? "").toLowerCase());
const has = (t: string) => titles.some((x: string) => x.includes(t));
const archId = cisco.find((r: any) => String(r.title ?? "").toLowerCase().includes("architecture"))?.localId;
const cooRole = cisco.find((r: any) => String(r.title ?? "").toLowerCase().includes("coo"));
const rest = cisco.find((r: any) => !r.title);
const checks: Array<[string, boolean]> = [
  ["Architecture Lead er egen rolle", has("architecture")],
  ["COO er egen rolle", has("coo")],
  ["restperiode uten oppdiktet tittel, needs_review", !!rest && rest.status === "needs_review"],
  [
    "overlapp vises begge steder",
    !!archId && !!cooRole &&
      cooRole.concurrentWithRoleLocalIds.includes(archId) &&
      cisco.find((r: any) => r.localId === archId)!.concurrentWithRoleLocalIds.includes(cooRole.localId),
  ],
  [
    "rolle kan ha både forgjenger og parallell",
    cisco.some((r: any) => r.predecessorRoleLocalId && r.concurrentWithRoleLocalIds.length > 0),
  ],
];
for (const [label, ok] of checks) console.log(`${ok ? "OK     " : "MANGLER"} ${label}`);

// --- hierarkisk kjøring: delbatcher, fletting og robusthet -----------------
const phases = (result.body["phase_metrics"] ?? []) as any[];
const merge = result.body["skill_merge"] as any;
const failedBlocks = (result.body["failed_blocks"] ?? []) as any[];
console.log("\n=== Hierarkisk kjøring ===");
console.log("modellkall:", usage.model_calls, "| veggklokketid:", usage.duration_ms, "ms");
for (const p of phases) {
  console.log(
    ` - ${p.phase} | ${p.key} | spenn=${p.spans} | ${p.durationMs}ms | in=${p.inputTokens} ut=${p.outputTokens} | ${p.ok ? "ok" : `FEIL:${p.errorCode}`} | sig=${String(p.subBatchSignature).slice(0, 12)}`,
  );
}
console.log("kompetanseflette:", JSON.stringify({
  before: merge?.before,
  after: merge?.after,
  mergedKeys: merge?.mergedKeys?.length ?? 0,
  conflicting: merge?.conflictingNormalizations?.length ?? 0,
}));
const cons = merge?.consolidation;
if (cons) {
  console.log("\n--- Kompetansekalibrering ---");
  console.log(
    "raa:", cons.before,
    "| etter synonymfletting:", cons.after,
    "| gjennomgabare:", cons.reviewable,
    "| lokale signaler:", cons.localSignals,
  );
  console.log("grunnlag:", JSON.stringify(cons.reasons));
  console.log("synonymfletting:", JSON.stringify(cons.synonymMerges));
  console.log("gjennomgabare kompetanser:", cons.reviewableLabels.join(", "));
}
console.log(
  "ufullstendige blokker:",
  failedBlocks.length,
  failedBlocks.length === 0 ? "(analysen er ferdig)" : JSON.stringify(failedBlocks),
);
console.log("skrevet til career_atoms:", result.body["career_atoms_written"] ?? 0);
console.log(
  `ytelsesport (<30s): ${usage.duration_ms < 30_000 ? "OK" : "MANGLER"} (${Math.round(usage.duration_ms / 1000)}s)`,
);

// --- monolittisk mot hierarkisk --------------------------------------------
if (monolithic?.body["ok"]) {
  const mOut = monolithic.body["output"] as any;
  const mUsage = monolithic.body["usage"] as any;
  const mGates = monolithic.body["quality_gates"] as any;
  const mCisco = mOut.roles.filter((r: any) =>
    String(r.employer ?? "").toLowerCase().includes("cisco"),
  );
  const row = (label: string, mono: unknown, hier: unknown) =>
    console.log(`${label.padEnd(34)} mono=${String(mono).padEnd(10)} hier=${String(hier)}`);
  console.log("\n=== Monolittisk mot hierarkisk (samme frosne input) ===");
  row("modellkall", 1, usage.model_calls);
  row("varighet (ms)", mUsage.duration_ms, usage.duration_ms);
  row("input-tokens", mUsage.input_tokens, usage.input_tokens);
  row("output-tokens", mUsage.output_tokens, usage.output_tokens);
  row("roller", mOut.roles.length, out.roles.length);
  row("Cisco-roller", mCisco.length, cisco.length);
  row("resultater", mOut.achievements.length, ach.length);
  row("uplasserte resultater", mGates.achievementsUnassigned, gates.achievementsUnassigned);
  row("kompetanser", mOut.skills.length, out.skills.length);
  row("kompetanser needs_review", mGates.skillsNeedsReview, gates.skillsNeedsReview);
  row("roller needs_review", mGates.rolesNeedsReview, gates.rolesNeedsReview);
  const noRegression =
    out.roles.length >= mOut.roles.length &&
    cisco.length >= mCisco.length &&
    gates.achievementsUnassigned <= mGates.achievementsUnassigned;
  console.log(`kvalitetsport (ingen regresjon): ${noRegression ? "OK" : "MANGLER"}`);
} else if (monolithic) {
  console.log("\nmonolittisk kjøring feilet:", JSON.stringify(monolithic.body));
}

// --- regnskap: hva som ikke lenger teller som resultat ----------------------
import { buildResultLedger } from "../../supabase/functions/_shared/cv-skills/result-ledger-v2.ts";

const ledger = buildResultLedger({
  input: preparsed,
  output: out,
  candidates: rows as never,
  droppedLocalIds: ((result.body["dropped"] ?? []) as any[]).map((d) => d.local_id),
});

console.log("\n=== Regnskap for resultater ===");
console.log(
  "kildespenn klassifisert som mulig resultat:", ledger.resultCandidateSpans,
  "| resultatforslag etter kvalitetsporter:", ledger.achievementProposals,
);
console.log("fordeling:", JSON.stringify(ledger.distribution));
for (const e of ledger.nonResultEntries) {
  console.log(
    `\n - span ${e.sourceSpanId}\n   utdrag: ${e.excerpt}\n   fra: ${e.previousClassification} -> ${e.newClassification} (plassering=${e.placementConfidence ?? "-"}/${e.placementSource ?? "-"})\n   hvorfor: ${e.reason}\n   synlig: ${e.visibleIn}`,
  );
}
