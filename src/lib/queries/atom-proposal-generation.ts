/**
 * Module 5.1 — deterministic, user-triggered atom proposal generation (no AI, no Edge).
 * Karriereontologi v4: alle forslag genereres mot `career_atoms`.
 * Inserts rows into atom_enrichment_batches / atom_enrichment_proposals only.
 */

import { supabase } from "@/lib/supabase";
import type { Json, Tables, TablesInsert } from "@/integrations/supabase/types";
import {
  insertExplicitEvidenceFromPlan,
  insertExplicitPreferenceFromPlan,
  isAutoStructurableEvidence,
  isExplicitStructuredPreference,
} from "@/lib/atom-explicit-writes";
import {
  bareTermFromLabel,
  evidenceAtomTypeFor,
  evidencePlanToCareerAtom,
  findEvidencePointersForSkill,
  INDIRECT_ATOM_TYPES,
  logicalKeyFromCareerAtom,
  preferencePlanToCareerAtom,
  type CareerAtomFields,
} from "@/lib/career-atom-v4-mapping";
import {
  evidenceLogicalKeyFromRow,
  generateEvidenceAtomsFromCvEvidenceAtoms,
  generateEvidenceAtomsFromCvImports,
  generateEvidenceAtomsFromDocuments,
  generateEvidenceAtomsFromLinkedInProfile,
  generateEvidenceAtomsFromProfile,
  generatePreferenceAtomsFromCareerProfile,
  generatePreferenceAtomsFromProfile,
  preferenceLogicalKeyFromRow,
  stableAtomHash,
  type CvImportRow,
  type DocumentRow,
  type PlannedEvidenceAtom,
  type PlannedPreferenceAtom,
} from "@/lib/career-atom-refresh";

type ProposalInsert = TablesInsert<"atom_enrichment_proposals">;

function normLabel(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function canonicalPayloadJson(payload: Record<string, unknown>): string {
  const keys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const k of keys) {
    let v = payload[k];
    if (k === "label" && payload.dimension === "role_type" && typeof v === "string") {
      v = normLabel(v);
    }
    sorted[k] = v;
  }
  return JSON.stringify(sorted);
}

function proposalDedupeFingerprint(p: {
  source_hash: string | null | undefined;
  proposal_action: string;
  target_atom_type: string;
  proposal_payload: Json;
}): string {
  const rec =
    typeof p.proposal_payload === "object" &&
    p.proposal_payload !== null &&
    !Array.isArray(p.proposal_payload)
      ? (p.proposal_payload as Record<string, unknown>)
      : {};
  return stableAtomHash([
    p.source_hash ?? "",
    p.proposal_action,
    p.target_atom_type,
    canonicalPayloadJson(rec),
  ]);
}

/** Én plan per semantisk preferanse (samme dimension/label/value), foretrekk karriereprofil som kilde. */
function dedupePlannedPreferencesBySemantic(
  planned: PlannedPreferenceAtom[],
): PlannedPreferenceAtom[] {
  const m = new Map<string, PlannedPreferenceAtom>();
  for (const p of planned) {
    const k = `${normLabel(p.dimension)}|${normLabel(p.label)}|${normLabel(p.value ?? "")}`;
    const existing = m.get(k);
    if (!existing) {
      m.set(k, p);
      continue;
    }
    const prefer =
      existing.source === "career_profile"
        ? existing
        : p.source === "career_profile"
          ? p
          : existing;
    m.set(k, prefer);
  }
  return [...m.values()];
}

function preferenceProposalCopy(pl: PlannedPreferenceAtom): {
  rationale: string;
  explanation: string;
} {
  const sf = pl.source_field ?? "";
  if (pl.dimension === "role_type") {
    if (sf.startsWith("desired_role_types:")) {
      return {
        rationale: "Rollen står blant målroller i karriereprofilen din.",
        explanation:
          "Matching og vurderinger fungerer best når ønskede roller også er lagret som tydelige karrierepreferanser. Godkjenn for å strukturere noe du allerede har valgt — ikke fordi noe mangler i fritekst.",
      };
    }
    if (sf.startsWith("target_roles:") || sf === "target_role") {
      return {
        rationale: "Rollen er registrert som mål i profilen din.",
        explanation:
          "Vi foreslår å gjøre det om til en strukturert karrierepreferanse slik at sammenligning med stillinger og veiledning blir enklere.",
      };
    }
  }
  return {
    rationale: "Regelbasert utledning fra lagret karriere- eller profildata.",
    explanation: "Godkjenn for å legge inn preferansen i standardformat i karriereprofilen din.",
  };
}

function mergePreferencePlanned(
  career: PlannedPreferenceAtom[],
  profile: PlannedPreferenceAtom[],
): PlannedPreferenceAtom[] {
  const m = new Map<string, PlannedPreferenceAtom>();
  for (const p of career) m.set(p.logicalKey, p);
  for (const p of profile) {
    if (!m.has(p.logicalKey)) m.set(p.logicalKey, p);
  }
  return [...m.values()];
}

function mergeEvidencePlanned(parts: PlannedEvidenceAtom[][]): PlannedEvidenceAtom[] {
  const m = new Map<string, PlannedEvidenceAtom>();
  for (const part of parts) {
    for (const e of part) {
      if (!m.has(e.logicalKey)) m.set(e.logicalKey, e);
    }
  }
  return [...m.values()];
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

type CareerAtomRow = Tables<"career_atoms">;

function hasLeadershipEvidenceEvidence(rows: CareerAtomRow[]): boolean {
  for (const r of rows) {
    if (!r.is_active || r.atom_kind !== "evidens") continue;
    const lab = norm(r.content_no);
    if (
      r.atom_type === "role" ||
      lab.includes("leder") ||
      lab.includes("ledelse") ||
      lab.includes("manager")
    ) {
      return true;
    }
  }
  return false;
}


export type GenerateAtomEnrichmentProposalsResult = {
  batchId: string | null;
  proposalsInserted: number;
  proposalsSkippedDuplicate: number;
  preferencesAutoStructured: number;
  evidenceAutoStructured: number;
};

/**
 * Leser innlogget bruker via `auth.getUser()`, speiler eksplisitte profil-/dokumentdata til
 * preferanser og dokumentert erfaring der det er trygt, og oppretter ellers ventende forslag
 * for tolkning og avklaring.
 */
export async function generateAtomEnrichmentProposals(): Promise<GenerateAtomEnrichmentProposalsResult> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error("Du må være innlogget.");

  const [careerRes, profileRes, atomsRes, docsRes, cvImportsRes, cvEvCountRes] = await Promise.all([
    supabase.from("user_career_profiles").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("career_atoms").select("*").eq("user_id", userId),
    supabase
      .from("documents")
      .select("id, title, document_type, deleted_at")
      .eq("user_id", userId)
      .is("deleted_at", null),
    supabase.from("cv_imports").select("id, status, source_filename").eq("user_id", userId),
    supabase
      .from("cv_evidence_atoms")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  if (careerRes.error) throw careerRes.error;
  if (profileRes.error) throw profileRes.error;
  if (atomsRes.error) throw atomsRes.error;
  if (docsRes.error) throw docsRes.error;
  if (cvImportsRes.error) throw cvImportsRes.error;
  if (cvEvCountRes.error) throw cvEvCountRes.error;

  const careerProfile = careerRes.data as Tables<"user_career_profiles"> | null;
  const profile = profileRes.data as Tables<"profiles"> | null;
  const documents = (docsRes.data ?? []) as DocumentRow[];
  const cvImports = (cvImportsRes.data ?? []) as CvImportRow[];
  const cvEvidenceCount = cvEvCountRes.count ?? 0;

  const plannedPrefs = dedupePlannedPreferencesBySemantic(
    mergePreferencePlanned(
      generatePreferenceAtomsFromCareerProfile(careerProfile),
      generatePreferenceAtomsFromProfile(profile),
    ),
  );

  const CV_IMPORT_ACTIVE = new Set(["parsed", "reviewed", "committed"]);
  const hasActiveCvImport = cvImports.some((i) => CV_IMPORT_ACTIVE.has(i.status));

  let plannedEvidenceEff = mergeEvidencePlanned([
    generateEvidenceAtomsFromProfile(profile),
    generateEvidenceAtomsFromLinkedInProfile(profile),
    generateEvidenceAtomsFromDocuments(documents),
    generateEvidenceAtomsFromCvImports(cvImports),
    generateEvidenceAtomsFromCvEvidenceAtoms(cvEvidenceCount),
  ]);
  if (hasActiveCvImport) {
    plannedEvidenceEff = plannedEvidenceEff.filter(
      (e) => e.source_field !== "cv_evidence_atoms:summary",
    );
  }

  let atoms = (atomsRes.data ?? []) as CareerAtomRow[];
  let preferencesAutoStructured = 0;
  let evidenceAutoStructured = 0;

  const activeAtoms = () => atoms.filter((a) => a.is_active);
  const hasLogicalKey = (key: string) =>
    activeAtoms().some((a) => logicalKeyFromCareerAtom(a.structured_data) === key);

  /** Kandidater som kan belegge en kompetanse indirekte. */
  const pointerCandidates = () =>
    activeAtoms()
      .filter((a) => a.atom_kind === "evidens")
      .map((a) => ({
        id: a.id,
        atom_class: a.atom_class,
        atom_type: a.atom_type,
        content_no: a.content_no,
      }));

  const latestRoleAtomId = (): string | null => {
    const roles = activeAtoms().filter((a) => a.atom_type === "role");
    if (roles.length === 0) return null;
    roles.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return roles[0]!.id;
  };

  for (const pl of plannedPrefs) {
    if (!isExplicitStructuredPreference(pl)) continue;
    if (hasLogicalKey(pl.logicalKey)) continue;
    try {
      const id = await insertExplicitPreferenceFromPlan(userId, pl);
      preferencesAutoStructured += 1;
      atoms.push({
        ...(preferencePlanToCareerAtom(pl) as unknown as CareerAtomRow),
        id,
        user_id: userId,
        is_active: true,
        atom_class: null,
        created_at: new Date().toISOString(),
      });
    } catch {
      /* RLS eller unikhetskonflikt — hopp over enkeltforsøk */
    }
  }

  /**
   * Kompetanse og eksponering som mangler pekere blir ikke skrevet automatisk.
   * De faller ned til forslagsløypa og blir spørsmål til brukeren.
   */
  type PointerGap = { plan: PlannedEvidenceAtom; atomType: "skill" | "domain"; reason: string };
  const pointerGaps: PointerGap[] = [];

  const resolvePointers = (
    ev: PlannedEvidenceAtom,
  ): { atomType: ReturnType<typeof evidenceAtomTypeFor>; ids: string[]; parent: string | null } => {
    const atomType = evidenceAtomTypeFor(ev.category);
    if (!atomType) return { atomType: null, ids: [], parent: null };
    if (atomType === "skill") {
      return {
        atomType,
        ids: findEvidencePointersForSkill(bareTermFromLabel(ev.label), pointerCandidates()),
        parent: null,
      };
    }
    if (atomType === "domain") {
      const role = latestRoleAtomId();
      return { atomType, ids: role ? [role] : [], parent: role };
    }
    return { atomType, ids: [], parent: null };
  };

  for (const ev of plannedEvidenceEff) {
    const { atomType, ids, parent } = resolvePointers(ev);
    if (!atomType) continue;
    if (INDIRECT_ATOM_TYPES.has(atomType) && ids.length === 0) {
      pointerGaps.push({
        plan: ev,
        atomType: atomType as "skill" | "domain",
        reason:
          atomType === "skill"
            ? "Ingen kvalifikasjon, resultat eller rolle i karriereprofilen nevner denne kompetansen."
            : "Ingen rolle å knytte eksponeringen til.",
      });
      continue;
    }
    if (!isAutoStructurableEvidence(ev, { skipCvEvidenceSummary: hasActiveCvImport })) continue;
    if (hasLogicalKey(ev.logicalKey)) continue;
    try {
      const id = await insertExplicitEvidenceFromPlan(userId, ev, {
        atomType,
        evidenceAtomIds: ids,
        parentAtomId: parent,
      });
      evidenceAutoStructured += 1;
      atoms.push({
        ...(evidencePlanToCareerAtom(ev, {
          atomType,
          evidenceAtomIds: ids,
          parentAtomId: parent,
        }) as unknown as CareerAtomRow),
        id,
        user_id: userId,
        is_active: true,
        atom_class: null,
        created_at: new Date().toISOString(),
      });
    } catch {
      /* RLS eller unikhetskonflikt */
    }
  }

  if (preferencesAutoStructured > 0 || evidenceAutoStructured > 0) {
    const reloadRes = await supabase.from("career_atoms").select("*").eq("user_id", userId);
    if (reloadRes.error) throw reloadRes.error;
    atoms = (reloadRes.data ?? []) as CareerAtomRow[];
  }

  const activeAtomRows = atoms.filter((a) => a.is_active);


  const rejectCutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: dedupeRows, error: dedupeErr } = await supabase
    .from("atom_enrichment_proposals")
    .select("source_hash, proposal_action, target_atom_type, proposal_payload, status")
    .eq("user_id", userId)
    .in("status", ["pending_review", "needs_more_context", "approved"])
    .order("created_at", { ascending: false })
    .limit(450);
  if (dedupeErr) throw dedupeErr;

  const { data: rejectRows, error: rejErr } = await supabase
    .from("atom_enrichment_proposals")
    .select("source_hash, proposal_action, target_atom_type, proposal_payload")
    .eq("user_id", userId)
    .eq("status", "rejected")
    .gte("reviewed_at", rejectCutoff)
    .order("reviewed_at", { ascending: false })
    .limit(200);
  if (rejErr) throw rejErr;

  let skippedDuplicate = 0;
  const toInsert: ProposalInsert[] = [];
  const fpSeen = new Set<string>();
  for (const r of dedupeRows ?? []) {
    fpSeen.add(
      proposalDedupeFingerprint({
        source_hash: r.source_hash,
        proposal_action: r.proposal_action,
        target_atom_type: r.target_atom_type,
        proposal_payload: r.proposal_payload as Json,
      }),
    );
  }
  const rejectFp = new Set(
    (rejectRows ?? []).map((r) =>
      proposalDedupeFingerprint({
        source_hash: r.source_hash,
        proposal_action: r.proposal_action,
        target_atom_type: r.target_atom_type,
        proposal_payload: r.proposal_payload as Json,
      }),
    ),
  );

  const pushProposal = (row: ProposalInsert) => {
    const fp = proposalDedupeFingerprint({
      source_hash: row.source_hash,
      proposal_action: row.proposal_action,
      target_atom_type: row.target_atom_type,
      proposal_payload: row.proposal_payload as Json,
    });
    if (fpSeen.has(fp) || rejectFp.has(fp)) {
      skippedDuplicate += 1;
      return;
    }
    fpSeen.add(fp);
    toInsert.push(row);
  };

  const runPrefCreates = () => {
    for (const pl of plannedPrefs) {
      if (isExplicitStructuredPreference(pl)) continue;
      const exists = activePrefs.some((ap) => preferenceLogicalKeyFromRow(ap) === pl.logicalKey);
      if (exists) continue;
      const isCareer = pl.source === "career_profile";
      const payload: Record<string, unknown> = {
        dimension: pl.dimension,
        label: pl.label,
        value: pl.value,
        importance_score: pl.importance_score,
        confidence_score: pl.confidence_score,
        source: pl.source,
        source_field: pl.source_field,
        source_hash: pl.source_hash,
        career_profile_id: pl.career_profile_id,
        reasoning: pl.reasoning,
      };
      const copy = preferenceProposalCopy(pl);
      pushProposal({
        user_id: userId,
        batch_id: "",
        proposal_action: "create_atom",
        target_atom_type: "user_preference_atom",
        source_type: "deterministic_module_5_1",
        source_id: pl.source_field,
        source_hash: pl.source_hash,
        source_table: isCareer ? "user_career_profiles" : "profiles",
        source_record_id: isCareer ? (careerProfile?.id ?? null) : (profile?.id ?? null),
        proposal_payload: payload as Json,
        rationale: copy.rationale,
        explanation: copy.explanation,
        confidence: 0.85,
        inferred: true,
        status: "pending_review",
      });
    }
  };

  const runEvCreates = () => {
    for (const ev of plannedEvidenceEff) {
      if (isAutoStructurableEvidence(ev, { skipCvEvidenceSummary: hasActiveCvImport })) continue;
      const exists = activeEvidence.some((ae) => evidenceLogicalKeyFromRow(ae) === ev.logicalKey);
      if (exists) continue;
      const srcTable =
        ev.source === "document"
          ? "documents"
          : ev.source === "cv_import"
            ? "cv_imports"
            : ev.source === "profile"
              ? "profiles"
              : ev.source === "linkedin"
                ? "profiles"
                : null;
      let srcRec: string | null = null;
      if (ev.source === "document" && ev.source_document_id) srcRec = ev.source_document_id;
      else if (ev.source === "cv_import") {
        const m = /^cv_import:([^:]+)/.exec(ev.source_field);
        srcRec = m?.[1] ?? null;
      } else if (ev.source === "profile" || ev.source === "linkedin") srcRec = profile?.id ?? null;

      const payload: Record<string, unknown> = {
        category: ev.category,
        label: ev.label,
        description: ev.description,
        strength_score: ev.strength_score,
        confidence_score: ev.confidence_score,
        source: ev.source,
        source_field: ev.source_field,
        source_document_id: ev.source_document_id,
        source_profile_field: ev.source_profile_field,
        source_hash: ev.source_hash,
        evidence_type: ev.evidence_type,
        reasoning: ev.reasoning,
      };
      pushProposal({
        user_id: userId,
        batch_id: "",
        proposal_action: "create_atom",
        target_atom_type: "user_evidence_atom",
        source_type: "deterministic_module_5_1",
        source_id: ev.source_field,
        source_hash: ev.source_hash,
        source_table: srcTable,
        source_record_id: srcRec,
        proposal_payload: payload as Json,
        rationale: "Funnet i dokument eller profilfelt du har lagret.",
        explanation: "Godkjenn for å vise dette som dokumentert erfaring i karriereprofilen.",
        confidence: 0.8,
        inferred: false,
        status: "pending_review",
      });
    }
  };

  const runHeuristics = () => {
    if (
      careerProfile &&
      (careerProfile.leadership_ambition ?? 0) >= 5 &&
      !hasLeadershipEvidenceEvidence(activeEvidence)
    ) {
      const payload: Record<string, unknown> = {
        gap: "leadership",
        recommendation:
          "Karriereprofilen signalerer sterk lederambisjon, men vi fant ikke tydelig dokumentert ledererfaring i den strukturerte erfaringen din. Vurder å legge inn roller eller resultater fra CV eller dokumenter.",
        related_profile_fields: ["leadership_ambition", "leadership_level"],
      };
      const sh = stableAtomHash(["m51", "suggest_evidence", "leadership_gap", userId]);
      pushProposal({
        user_id: userId,
        batch_id: "",
        proposal_action: "suggest_evidence",
        target_atom_type: "user_evidence_atom",
        source_type: "deterministic_module_5_1",
        source_id: "leadership_gap",
        source_hash: sh,
        source_table: "user_career_profiles",
        source_record_id: careerProfile.id,
        proposal_payload: payload as Json,
        rationale: "Avvik mellom ambisjon og dokumentert erfaring i profilen.",
        explanation:
          "Godkjenning lagrer ikke dokumentert erfaring for deg — det bekrefter at du har sett forslaget.",
        confidence: 0.75,
        inferred: true,
        status: "pending_review",
      });
    }

    if (careerProfile && (careerProfile.leadership_ambition ?? 0) >= 5) {
      const lvl = norm(careerProfile.leadership_level);
      const icLike =
        !!lvl &&
        (/\b(ic|individual\s*contributor|spesialist|medarbeider|ikke\s*leder)\b/.test(lvl) ||
          lvl.includes("individual contributor"));
      if (icLike) {
        const payload: Record<string, unknown> = {
          conflict: "leadership_ambition_vs_level",
          detail:
            "Karriereprofilen har høy lederambisjon, men ledernivå er satt som individbidrag/spesialist. Avklar om målet er people leadership eller dyp fagledelse.",
          fields: {
            leadership_ambition: careerProfile.leadership_ambition,
            leadership_level: careerProfile.leadership_level,
          },
        };
        const sh = stableAtomHash(["m51", "flag_conflict", "leadership_ambition_vs_level", userId]);
        pushProposal({
          user_id: userId,
          batch_id: "",
          proposal_action: "flag_conflict",
          target_atom_type: "user_preference_atom",
          source_type: "deterministic_module_5_1",
          source_id: "leadership_ambition_vs_level",
          source_hash: sh,
          source_table: "user_career_profiles",
          source_record_id: careerProfile.id,
          proposal_payload: payload as Json,
          rationale: "Mulig motstrid mellom lederambisjon og registrert ledernivå.",
          explanation:
            "Godkjenning markerer at du har tatt stilling — ingen endring skrives automatisk til karrierepreferanser.",
          confidence: 0.7,
          inferred: true,
          status: "pending_review",
        });
      }
    }

    if (
      careerProfile &&
      careerProfile.years_experience == null &&
      (careerProfile.desired_role_types?.filter(Boolean).length ?? 0) >= 1
    ) {
      const payload: Record<string, unknown> = {
        topic: "experience_vs_target_roles",
        recommendation:
          "Du har valgt målroller, men års erfaring er ikke satt. Presiser erfaringsnivå for bedre matching og færre feiltolkninger.",
        fields_to_review: ["years_experience", "desired_role_types"],
      };
      const sh = stableAtomHash([
        "m51",
        "suggest_preference_clarification",
        "years_vs_roles",
        userId,
      ]);
      pushProposal({
        user_id: userId,
        batch_id: "",
        proposal_action: "suggest_preference_clarification",
        target_atom_type: "user_preference_atom",
        source_type: "deterministic_module_5_1",
        source_id: "years_experience_vs_roles",
        source_hash: sh,
        source_table: "user_career_profiles",
        source_record_id: careerProfile.id,
        proposal_payload: payload as Json,
        rationale: "Ufullstendig profilkontekst for målroller.",
        explanation:
          "Godkjenning bekrefter at du har sett hintet — ingen preferanse skrives automatisk.",
        confidence: 0.65,
        inferred: true,
        status: "pending_review",
      });
    }

    if (
      careerProfile &&
      (careerProfile.compensation_importance ?? 0) >= 5 &&
      (careerProfile.work_life_balance_importance ?? 0) >= 5
    ) {
      const payload: Record<string, unknown> = {
        topic: "compensation_vs_balance",
        recommendation:
          "Både kompensasjon og livsbalanse er satt svært høyt. Det kan være lurt å avklare hva som veier tyngst i neste steg.",
        fields_to_review: ["compensation_importance", "work_life_balance_importance"],
      };
      const sh = stableAtomHash(["m51", "suggest_preference_clarification", "comp_vs_wlb", userId]);
      pushProposal({
        user_id: userId,
        batch_id: "",
        proposal_action: "suggest_preference_clarification",
        target_atom_type: "user_preference_atom",
        source_type: "deterministic_module_5_1",
        source_id: "compensation_vs_work_life_balance",
        source_hash: sh,
        source_table: "user_career_profiles",
        source_record_id: careerProfile.id,
        proposal_payload: payload as Json,
        rationale: "Mulig dobbel topp-prioritet mellom lønn og livsbalanse.",
        explanation: "Godkjenning bekrefter gjennomgang — ingen preferanse skrives automatisk.",
        confidence: 0.6,
        inferred: true,
        status: "pending_review",
      });
    }
  };

  runPrefCreates();
  runEvCreates();
  runHeuristics();

  if (toInsert.length === 0) {
    return {
      batchId: null,
      proposalsInserted: 0,
      proposalsSkippedDuplicate: skippedDuplicate,
      preferencesAutoStructured,
      evidenceAutoStructured,
    };
  }

  const batchPayload: TablesInsert<"atom_enrichment_batches"> = {
    user_id: userId,
    title: "Regelbaserte forslag",
    source_type: "deterministic_module_5_1",
    source_table: "user_career_profiles",
    source_record_id: careerProfile?.id ?? null,
    source_hash: stableAtomHash([
      "m51_batch",
      userId,
      careerProfile?.updated_at ?? "",
      profile?.updated_at ?? "",
      String(plannedPrefs.length),
      String(plannedEvidenceEff.length),
    ]),
    context: {
      generator: "module_5_1",
      planned_preference_count: plannedPrefs.length,
      planned_evidence_count: plannedEvidenceEff.length,
      preferences_auto_structured: preferencesAutoStructured,
      evidence_auto_structured: evidenceAutoStructured,
    } as Json,
    status: "open",
  };

  const { data: batchRow, error: batchErr } = await supabase
    .from("atom_enrichment_batches")
    .insert(batchPayload)
    .select("id")
    .single();
  if (batchErr) throw batchErr;
  const batchId = batchRow!.id as string;

  const rows = toInsert.map((r) => ({ ...r, batch_id: batchId }));
  const { error: insErr } = await supabase.from("atom_enrichment_proposals").insert(rows);
  if (insErr) throw insErr;

  return {
    batchId,
    proposalsInserted: rows.length,
    proposalsSkippedDuplicate: skippedDuplicate,
    preferencesAutoStructured,
    evidenceAutoStructured,
  };
}
