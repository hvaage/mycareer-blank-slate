// cv-atom-language-no v2.1.0 — parsing, evidenskontroll og forslagsbygging.
//
// Ren logikk: ingen database, ingen nettverk. Alt som slipper gjennom her har
// ordrett kildebelegg i input, og ingenting skrives til career_atoms.

import type { PreparserCandidate } from "./role-block-preparser.ts";
import type {
  AchievementProposal,
  AppointmentRelation,
  AtomizationIssue,
  CvAtomizationInput,
  CvAtomizationOutput,
  PlacementConfidence,
  QualificationProposal,
  RoleAtomProposal,
  SkillProposal,
  SourceEvidence,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import { ATOMIZATION_ISSUE_CODES } from "./vendor/cv-atom-language-no/v2/types.ts";
import type { ProposalRow } from "./atom-proposal-pipeline.ts";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function normalizeForMatch(v: string): string {
  return v.normalize("NFKC").toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();
}

function parseEvidence(v: unknown): SourceEvidence[] {
  if (!Array.isArray(v)) return [];
  const out: SourceEvidence[] = [];
  for (const item of v) {
    if (!isObject(item)) continue;
    const id = str(item["sourceSpanId"]);
    const quote = str(item["sourceQuote"]);
    if (!id || !quote) continue;
    out.push({ sourceSpanId: id, sourceQuote: quote });
  }
  return out;
}

const PLACEMENTS: PlacementConfidence[] = ["high", "low", "needs_review"];
const RELATIONS: AppointmentRelation[] = ["single", "successive", "concurrent", "ambiguous"];

export type ParseV2Outcome =
  | { ok: true; output: CvAtomizationOutput; warnings: string[] }
  | { ok: false; errors: string[] };

/** Runtime-validering av modellsvaret. Ingen tillit til formen. */
export function parseAtomizationOutput(text: string | null): ParseV2Outcome {
  if (!text || !text.trim()) return { ok: false, errors: ["tomt svar"] };
  const trimmed = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, errors: ["svaret er ikke gyldig JSON"] };
  }
  if (!isObject(raw)) return { ok: false, errors: ["svaret er ikke et objekt"] };

  const warnings: string[] = [];

  const roles: RoleAtomProposal[] = [];
  for (const [i, item] of (Array.isArray(raw["roles"]) ? raw["roles"] : []).entries()) {
    if (!isObject(item)) {
      warnings.push(`rolle ${i}: ikke et objekt`);
      continue;
    }
    const localId = str(item["localId"]);
    if (!localId) {
      warnings.push(`rolle ${i}: localId mangler`);
      continue;
    }
    const relation = str(item["appointmentRelation"]) as AppointmentRelation | null;
    roles.push({
      localId,
      roleBlockId: str(item["roleBlockId"]),
      employmentGroupKey: str(item["employmentGroupKey"]),
      title: str(item["title"]),
      employer: str(item["employer"]),
      startDate: str(item["startDate"]),
      endDate: str(item["endDate"]),
      datePrecision: (str(item["datePrecision"]) as RoleAtomProposal["datePrecision"]) ?? null,
      sourceEvidence: parseEvidence(item["sourceEvidence"]),
      appointmentRelation: relation && RELATIONS.includes(relation) ? relation : "ambiguous",
      predecessorRoleLocalId: str(item["predecessorRoleLocalId"]),
      concurrentWithRoleLocalIds: strList(item["concurrentWithRoleLocalIds"]),
      status: str(item["status"]) === "needs_review" ? "needs_review" : "proposed",
      issues: strList(item["issues"]),
    });
  }

  const achievements: AchievementProposal[] = [];
  for (const [i, item] of (Array.isArray(raw["achievements"]) ? raw["achievements"] : []).entries()) {
    if (!isObject(item)) {
      warnings.push(`resultat ${i}: ikke et objekt`);
      continue;
    }
    const localId = str(item["localId"]);
    const normalizedText = str(item["normalizedText"]);
    if (!localId || !normalizedText) {
      warnings.push(`resultat ${i}: obligatoriske felt mangler`);
      continue;
    }
    const placement = str(item["placementConfidence"]) as PlacementConfidence | null;
    const status = str(item["status"]);
    achievements.push({
      localId,
      roleLocalId: str(item["roleLocalId"]),
      normalizedText,
      sourceEvidence: parseEvidence(item["sourceEvidence"]),
      placementConfidence:
        placement && PLACEMENTS.includes(placement) ? placement : "needs_review",
      placementReasons: strList(item["placementReasons"]),
      status:
        status === "unassigned" || status === "needs_review"
          ? (status as AchievementProposal["status"])
          : "proposed",
      issues: strList(item["issues"]),
    });
  }

  const skills: SkillProposal[] = [];
  for (const [i, item] of (Array.isArray(raw["skills"]) ? raw["skills"] : []).entries()) {
    if (!isObject(item)) {
      warnings.push(`kompetanse ${i}: ikke et objekt`);
      continue;
    }
    const localId = str(item["localId"]);
    const label = str(item["canonicalLabelNo"]);
    if (!localId || !label) {
      warnings.push(`kompetanse ${i}: obligatoriske felt mangler`);
      continue;
    }
    const evidence = Array.isArray(item["evidence"])
      ? item["evidence"].filter(isObject).map((e) => ({
          roleLocalId: str(e["roleLocalId"]),
          achievementLocalId: str(e["achievementLocalId"]),
          sourceEvidence: parseEvidence(e["sourceEvidence"]),
        }))
      : [];
    const placement = str(item["placementConfidence"]) as PlacementConfidence | null;
    skills.push({
      localId,
      canonicalLabelNo: label,
      displayLabel: str(item["displayLabel"]) ?? label,
      canonicalKey: str(item["canonicalKey"]) ?? canonicalSkillKey(label),
      inferred: item["inferred"] !== false,
      evidence,
      placementConfidence:
        placement && PLACEMENTS.includes(placement) ? placement : "needs_review",
      placementReasons: strList(item["placementReasons"]),
      status: str(item["status"]) === "needs_review" ? "needs_review" : "proposed",
      issues: strList(item["issues"]),
    });
  }

  const qualifications: QualificationProposal[] = [];
  for (const item of Array.isArray(raw["qualifications"]) ? raw["qualifications"] : []) {
    if (!isObject(item)) continue;
    const localId = str(item["localId"]);
    const normalizedText = str(item["normalizedText"]);
    const kind = str(item["kind"]);
    if (!localId || !normalizedText) continue;
    qualifications.push({
      localId,
      kind: (["education", "certification", "language", "tool"].includes(kind ?? "")
        ? kind
        : "certification") as QualificationProposal["kind"],
      normalizedText,
      sourceEvidence: parseEvidence(item["sourceEvidence"]),
      status: str(item["status"]) === "needs_review" ? "needs_review" : "proposed",
      issues: strList(item["issues"]),
    });
  }

  const issues: AtomizationIssue[] = [];
  for (const item of Array.isArray(raw["issues"]) ? raw["issues"] : []) {
    if (!isObject(item)) continue;
    const code = str(item["code"]);
    if (!code || !(ATOMIZATION_ISSUE_CODES as readonly string[]).includes(code)) continue;
    issues.push({
      code: code as AtomizationIssue["code"],
      sourceSpanIds: strList(item["sourceSpanIds"]),
      message: str(item["message"]) ?? "",
    });
  }

  if (roles.length + achievements.length + skills.length + qualifications.length === 0) {
    return { ok: false, errors: ["svaret inneholdt ingen forslag", ...warnings] };
  }

  return { ok: true, output: { roles, achievements, skills, qualifications, issues }, warnings };
}

export function canonicalSkillKey(label: string): string {
  return label
    .toLocaleLowerCase("nb-NO")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Kvalitetsporter — deterministiske, kjøres etter modellsvaret
// ---------------------------------------------------------------------------

export type QualityGateReport = {
  rolesTotal: number;
  rolesNeedsReview: number;
  achievementsUnassigned: number;
  skillsNeedsReview: number;
  mergedRoleSuspicions: string[];
  longSkillLabels: string[];
};

const MAX_SKILL_WORDS = 6;

/**
 * Sammenslått rolle: én foreslått rolle for en rolleblokk der pre-parseren fant
 * signaler om flere utnevnelser. Gir varsel og needs_review, ikke splitting —
 * systemet dikter aldri opp en rolle brukeren ikke har belegg for.
 */
export function applyQualityGates(
  output: CvAtomizationOutput,
  input: CvAtomizationInput,
): { output: CvAtomizationOutput; report: QualityGateReport } {
  const rolesByBlock = new Map<string, RoleAtomProposal[]>();
  for (const role of output.roles) {
    const key = role.roleBlockId ?? "__none__";
    rolesByBlock.set(key, [...(rolesByBlock.get(key) ?? []), role]);
  }

  const mergedRoleSuspicions: string[] = [];
  const issues = [...output.issues];

  for (const block of input.roleBlocks) {
    const hints = block.appointmentHints ?? [];
    const multiSignals = hints.filter((h) =>
      ["successive_language", "promotion_language", "concurrent_language", "inner_period_reference", "role_label_in_text"].includes(h),
    );
    const proposed = rolesByBlock.get(block.id) ?? [];
    if (multiSignals.length > 0 && proposed.length <= 1) {
      mergedRoleSuspicions.push(block.id);
      for (const role of proposed) {
        role.status = "needs_review";
        if (!role.issues.includes("merged_role_detected")) role.issues.push("merged_role_detected");
        if (role.appointmentRelation === "single") role.appointmentRelation = "ambiguous";
      }
      issues.push({
        code: "merged_role_detected",
        sourceSpanIds: block.sourceSpanIds,
        message:
          "Kilden har signaler om flere stillinger hos samme arbeidsgiver, men bare én rolle ble foreslått.",
      });
    }
    // Gruppenøkkelen er deterministisk og settes alltid fra pre-parseren.
    for (const role of proposed) role.employmentGroupKey = block.employmentGroupKey ?? null;
  }

  const longSkillLabels: string[] = [];
  for (const skill of output.skills) {
    const words = skill.canonicalLabelNo.split(/\s+/).filter(Boolean);
    if (words.length > MAX_SKILL_WORDS || skill.canonicalLabelNo.length > 60) {
      longSkillLabels.push(skill.localId);
      skill.status = "needs_review";
      if (!skill.issues.includes("ambiguous_compound_skill")) {
        skill.issues.push("ambiguous_compound_skill");
      }
    }
  }

  const roleIds = new Set(output.roles.map((r) => r.localId));
  for (const achievement of output.achievements) {
    if (achievement.roleLocalId && !roleIds.has(achievement.roleLocalId)) {
      achievement.roleLocalId = null;
      achievement.status = "unassigned";
      achievement.placementConfidence = "needs_review";
    }
    if (!achievement.roleLocalId && achievement.status === "proposed") {
      achievement.status = "unassigned";
    }
  }

  // Dedupliser kompetanser på kanonisk nøkkel: ett forslag, flere evidensrefs.
  const byKey = new Map<string, SkillProposal>();
  for (const skill of output.skills) {
    const key = skill.canonicalKey || canonicalSkillKey(skill.canonicalLabelNo);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...skill, canonicalKey: key });
      continue;
    }
    existing.evidence = [...existing.evidence, ...skill.evidence];
    if (skill.status === "needs_review") existing.status = "needs_review";
  }
  const skills = [...byKey.values()];

  return {
    output: { ...output, skills, issues },
    report: {
      rolesTotal: output.roles.length,
      rolesNeedsReview: output.roles.filter((r) => r.status === "needs_review").length,
      achievementsUnassigned: output.achievements.filter((a) => a.status === "unassigned").length,
      skillsNeedsReview: skills.filter((s) => s.status === "needs_review").length,
      mergedRoleSuspicions,
      longSkillLabels,
    },
  };
}

// ---------------------------------------------------------------------------
// Forslagsrader
// ---------------------------------------------------------------------------

export type BuildContext = {
  cvImportId: string;
  inputSignature: string;
  modelRunId: string;
  promptVersion: string;
  normalizerVersion: string;
  /** local_ref -> kandidatrad. */
  candidatesByRef: Map<string, PreparserCandidate>;
  /** local_ref -> kanonisk innholdshash. */
  spanHashes: Map<string, string>;
  /** local_ref -> kildetekst, brukt til ordrett sitatkontroll. */
  spanTexts: Map<string, string>;
};

export type BuildResult = {
  kept: ProposalRow[];
  dropped: { local_id: string; reason: string }[];
};

function firstAnchor(
  evidence: SourceEvidence[],
  ctx: BuildContext,
): { spanId: string; quote: string } | null {
  for (const e of evidence) {
    const text = ctx.spanTexts.get(e.sourceSpanId);
    if (!text) continue;
    if (!normalizeForMatch(text).includes(normalizeForMatch(e.sourceQuote))) continue;
    return { spanId: e.sourceSpanId, quote: e.sourceQuote };
  }
  return null;
}

/** Bygger forslagsrader. Alt uten ordrett kildebelegg forkastes. */
export function buildProposalRows(
  output: CvAtomizationOutput,
  ctx: BuildContext,
): BuildResult {
  const kept: ProposalRow[] = [];
  const dropped: { local_id: string; reason: string }[] = [];

  const push = (args: {
    localId: string;
    atomType: string;
    contentNo: string;
    evidence: SourceEvidence[];
    action: ProposalRow["proposal_action"];
    reviewState: string;
    extra: Record<string, unknown>;
    rationale: string;
  }) => {
    const anchor = firstAnchor(args.evidence, ctx);
    if (!anchor) {
      dropped.push({ local_id: args.localId, reason: "sitatet finnes ikke i kildeteksten" });
      return;
    }
    const candidate = ctx.candidatesByRef.get(anchor.spanId);
    const hash = ctx.spanHashes.get(anchor.spanId);
    if (!candidate || !hash) {
      dropped.push({ local_id: args.localId, reason: "ukjent kildespenn" });
      return;
    }
    kept.push({
      proposal_action: args.action,
      target_atom_type: "career_atom",
      source_type: "cv_import",
      source_table: "cv_parse_candidates",
      source_record_id: candidate.id,
      source_id: ctx.cvImportId,
      source_import_id: ctx.cvImportId,
      source_hash: hash,
      normalizer_version: ctx.normalizerVersion,
      prompt_version: ctx.promptVersion,
      model_run_id: ctx.modelRunId,
      confidence: args.reviewState === "needs_review" ? 0.5 : 0.8,
      inferred: true,
      rationale: args.rationale.slice(0, 2000),
      explanation: null,
      proposal_payload: {
        atom_kind: "evidens",
        atom_type: args.atomType,
        content_no: args.contentNo,
        source_type: "cv_import",
        source_ref: ctx.cvImportId,
        source_quote: anchor.quote,
        confidence: "imported",
        structured_data: {
          parse_candidate_id: candidate.id,
          cv_import_id: ctx.cvImportId,
          parse_local_ref: candidate.local_ref,
          source_hash: hash,
          input_signature: ctx.inputSignature,
          review_state: args.reviewState,
          model_run_id: ctx.modelRunId,
          prompt_version: ctx.promptVersion,
          normalizer_version: ctx.normalizerVersion,
          generated_by: "cv-atom-language-no@2.1.0",
          ...args.extra,
        },
      },
    });
  };

  for (const role of output.roles) {
    const title = role.title ?? "Stilling mangler";
    push({
      localId: role.localId,
      atomType: "role",
      contentNo: role.employer ? `${title} hos ${role.employer}` : title,
      evidence: role.sourceEvidence,
      action: "create_atom",
      reviewState: role.status,
      rationale: `Rolleutnevnelse (${role.appointmentRelation}).`,
      extra: {
        local_id: role.localId,
        role_block_id: role.roleBlockId,
        employment_group_key: role.employmentGroupKey,
        title: role.title,
        employer: role.employer,
        start_date: role.startDate,
        end_date: role.endDate,
        date_precision: role.datePrecision,
        appointment_relation: role.appointmentRelation,
        predecessor_role_local_id: role.predecessorRoleLocalId,
        concurrent_with_role_local_ids: role.concurrentWithRoleLocalIds,
        issues: role.issues,
      },
    });
  }

  for (const a of output.achievements) {
    push({
      localId: a.localId,
      atomType: "achievement",
      contentNo: a.normalizedText,
      evidence: a.sourceEvidence,
      action: "create_atom",
      reviewState: a.status === "proposed" ? "ready_for_atom" : a.status,
      rationale: a.placementReasons.join(", ") || "Resultat knyttet til rolleblokk.",
      extra: {
        local_id: a.localId,
        role_local_id: a.roleLocalId,
        placement_confidence: a.placementConfidence,
        placement_reasons: a.placementReasons,
        issues: a.issues,
      },
    });
  }

  for (const s of output.skills) {
    const evidence = s.evidence.flatMap((e) => e.sourceEvidence);
    push({
      localId: s.localId,
      atomType: "skill",
      contentNo: s.canonicalLabelNo,
      evidence,
      action: "suggest_evidence",
      reviewState: s.status === "proposed" ? "ready_for_atom" : s.status,
      rationale: s.placementReasons.join(", ") || "Kompetanse utledet fra rolle- og resultatbelegg.",
      extra: {
        local_id: s.localId,
        canonical_key: s.canonicalKey,
        display_label: s.displayLabel,
        inferred: s.inferred,
        placement_confidence: s.placementConfidence,
        evidence_refs: s.evidence.map((e) => ({
          role_local_id: e.roleLocalId ?? null,
          achievement_local_id: e.achievementLocalId ?? null,
          source_span_ids: e.sourceEvidence.map((x) => x.sourceSpanId),
        })),
        issues: s.issues,
      },
    });
  }

  for (const q of output.qualifications) {
    push({
      localId: q.localId,
      atomType: q.kind === "tool" ? "tool" : q.kind,
      contentNo: q.normalizedText,
      evidence: q.sourceEvidence,
      action: q.kind === "tool" ? "suggest_evidence" : "create_atom",
      reviewState: q.status === "proposed" ? "ready_for_atom" : q.status,
      rationale: "Kvalifikasjon fra kilden.",
      extra: { local_id: q.localId, kind: q.kind, issues: q.issues },
    });
  }

  return { kept, dropped };
}
