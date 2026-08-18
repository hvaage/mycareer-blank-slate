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

/**
 * Kontrakt v3: modellen sender bare sourceSpanIds. Eldre svar med
 * sourceEvidence-objekter godtas fortsatt, men sitatet hentes uansett fra
 * frosset input i hydrateEvidence().
 */
function parseEvidence(item: Record<string, unknown>): SourceEvidence[] {
  const out: SourceEvidence[] = [];
  const seen = new Set<string>();
  const add = (id: string | null) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({ sourceSpanId: id, sourceQuote: "" });
  };
  for (const id of strList(item["sourceSpanIds"])) add(id);
  const legacy = item["sourceEvidence"];
  if (Array.isArray(legacy)) {
    for (const e of legacy) if (isObject(e)) add(str(e["sourceSpanId"]));
  }
  return out;
}

/**
 * Fyller ordrett sitat, side og offset fra frosset input. Ukjente span-id-er
 * forkastes, slik at ingen påstand kan peke på noe kilden ikke har.
 */
export function hydrateEvidence(
  output: CvAtomizationOutput,
  input: CvAtomizationInput,
): CvAtomizationOutput {
  const spans = new Map(input.sourceSpans.map((s) => [s.id, s]));
  const hydrate = (evidence: SourceEvidence[]): SourceEvidence[] => {
    const out: SourceEvidence[] = [];
    for (const e of evidence) {
      const span = spans.get(e.sourceSpanId);
      if (!span || !span.text.trim()) continue;
      out.push({
        sourceSpanId: span.id,
        sourceQuote: span.text.trim(),
        page: span.page ?? null,
        startOffset: span.startOffset ?? null,
        endOffset: span.endOffset ?? null,
      });
    }
    return out;
  };
  return {
    ...output,
    roles: output.roles.map((r) => ({ ...r, sourceEvidence: hydrate(r.sourceEvidence) })),
    achievements: output.achievements.map((a) => ({
      ...a,
      sourceEvidence: hydrate(a.sourceEvidence),
    })),
    skills: output.skills.map((s) => ({
      ...s,
      evidence: s.evidence.map((e) => ({ ...e, sourceEvidence: hydrate(e.sourceEvidence) })),
    })),
    qualifications: output.qualifications.map((q) => ({
      ...q,
      sourceEvidence: hydrate(q.sourceEvidence),
    })),
  };
}

const PLACEMENTS: PlacementConfidence[] = ["high", "low", "needs_review"];
const RELATIONS: AppointmentRelation[] = ["single", "successive", "concurrent", "ambiguous"];

export type ParseV2Outcome =
  | { ok: true; output: CvAtomizationOutput; warnings: string[] }
  | { ok: false; errors: string[] };

/** Runtime-validering av modellsvaret. Ingen tillit til formen. */
export function parseAtomizationOutput(
  text: string | null,
  options: { allowEmpty?: boolean } = {},
): ParseV2Outcome {
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
      sourceEvidence: parseEvidence(item),
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
      sourceEvidence: parseEvidence(item),
      placementConfidence:
        placement && PLACEMENTS.includes(placement) ? placement : "needs_review",
      // Utledes deterministisk i kvalitetsportene; modellen bestemmer den ikke.
      placementSource: "none",
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
          sourceEvidence: parseEvidence(e),
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
      sourceEvidence: parseEvidence(item),
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

  if (
    options.allowEmpty !== true &&
    roles.length + achievements.length + skills.length + qualifications.length === 0
  ) {
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
  /** Rolleforløp per ansettelsesgruppe, med begge relasjoner bevart. */
  roleTopology: Array<{
    localId: string;
    employmentGroupKey: string | null;
    title: string | null;
    startDate: string | null;
    endDate: string | null;
    predecessorRoleLocalId: string | null;
    concurrentWithRoleLocalIds: string[];
    appointmentRelation: AppointmentRelation;
  }>;
  /** Provisoriske roller: strukturelt sikre, men trenger én avklaring. */
  provisionalRoles: Array<{
    localId: string;
    employer: string | null;
    startDate: string | null;
    endDate: string | null;
    reason: string;
    attachedContentLocalIds: string[];
  }>;
  contentKinds: { result: number; deliverable: number; roleEvidence: number };
  placement: {
    high: number;
    low: number;
    needsReview: number;
    bySource: Record<string, number>;
    downgradedFromHigh: string[];
  };
};

/**
 * Innholdstype ut fra språket i utsagnet. Dette avgjør IKKE plassering:
 * alt strukturelt koblet innhold blir værende på rollen sin.
 */
export function classifyContentKind(
  text: string,
): "result" | "deliverable" | "role_evidence" {
  const t = (text ?? "").toLowerCase();
  const roleEvidence =
    /\b(served on|sat on|member of|part of the .*team|medlem av|satt i|deltok i)\b/.test(t);
  if (roleEvidence) return "role_evidence";
  const measurable =
    /\d|\b(exceeded|grew|increased|reduced|delivered|won|achieved|økte|reduserte|leverte|oppnådde)\b/.test(
      t,
    );
  if (measurable) return "result";
  const deliverable =
    /\b(built|co-developed|developed|designed|led .*(training|program)|implemented|etablerte|utviklet|innførte)\b/.test(
      t,
    );
  if (deliverable) return "deliverable";
  return "result";
}

const MAX_SKILL_WORDS = 6;



// --- datohjelpere: kun sammenligning, aldri utfylling av manglende datoer ---

function dateValue(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const m = /^(\d{4})(?:-(\d{2}))?/.exec(value);
  if (!m) return fallback;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

function overlaps(a: RoleAtomProposal, b: RoleAtomProposal): boolean {
  if (!a.startDate && !a.endDate) return false;
  if (!b.startDate && !b.endDate) return false;
  const aStart = dateValue(a.startDate, -Infinity);
  const aEnd = dateValue(a.endDate, Infinity);
  const bStart = dateValue(b.startDate, -Infinity);
  const bEnd = dateValue(b.endDate, Infinity);
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Utleder rolleforløpet deterministisk fra datoene i forslagene. Én rolle kan
 * både ha en forgjenger og løpe parallelt med en annen: begge relasjonene
 * lagres eksplisitt, og appointmentRelation er bare en oppsummerende etikett.
 */
export function deriveRoleTopology(roles: RoleAtomProposal[]): void {
  const groups = new Map<string, RoleAtomProposal[]>();
  for (const role of roles) {
    const key = role.employmentGroupKey ?? `role:${role.localId}`;
    groups.set(key, [...(groups.get(key) ?? []), role]);
  }

  for (const group of groups.values()) {
    for (const role of group) {
      const concurrent = group
        .filter((other) => other.localId !== role.localId && overlaps(role, other))
        .map((other) => other.localId);
      role.concurrentWithRoleLocalIds = [
        ...new Set([...role.concurrentWithRoleLocalIds, ...concurrent]),
      ].filter((id) => id !== role.localId && group.some((r) => r.localId === id));

      const roleStart = dateValue(role.startDate, -Infinity);
      let predecessor: RoleAtomProposal | null = null;
      for (const other of group) {
        if (other.localId === role.localId) continue;
        if (overlaps(role, other)) continue;
        const otherEnd = dateValue(other.endDate, Infinity);
        if (otherEnd > roleStart) continue;
        if (!predecessor || otherEnd > dateValue(predecessor.endDate, Infinity)) {
          predecessor = other;
        }
      }
      role.predecessorRoleLocalId =
        predecessor?.localId ??
        (role.predecessorRoleLocalId &&
        group.some((r) => r.localId === role.predecessorRoleLocalId)
          ? role.predecessorRoleLocalId
          : null);

      const hasConcurrent = role.concurrentWithRoleLocalIds.length > 0;
      const hasPredecessor = role.predecessorRoleLocalId !== null;
      if (role.appointmentRelation !== "ambiguous") {
        role.appointmentRelation = hasConcurrent
          ? "concurrent"
          : hasPredecessor
            ? "successive"
            : group.length > 1
              ? "successive"
              : "single";
      }
    }
  }
}

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

  // Rolleforløp utledes av datoene, ikke av modelletiketten.
  deriveRoleTopology(output.roles);

  const rolesById = new Map(output.roles.map((r) => [r.localId, r]));
  const spanById = new Map(input.sourceSpans.map((s) => [s.id, s]));
  const blockById = new Map(input.roleBlocks.map((b) => [b.id, b]));
  const downgradedFromHigh: string[] = [];
  const bySource: Record<string, number> = {};

  for (const achievement of output.achievements) {
    const role = achievement.roleLocalId ? rolesById.get(achievement.roleLocalId) : undefined;
    if (achievement.roleLocalId && !role) {
      achievement.roleLocalId = null;
    }

    let source: AchievementProposal["placementSource"] = "none";
    if (role) {
      const block = role.roleBlockId ? blockById.get(role.roleBlockId) : undefined;
      const blockSpanIds = new Set(block?.sourceSpanIds ?? []);
      const roleSpanIds = new Set(role.sourceEvidence.map((e) => e.sourceSpanId));
      for (const evidence of achievement.sourceEvidence) {
        const span = spanById.get(evidence.sourceSpanId);
        if (!span) continue;
        if (block && span.parentLocalRef === block.id) {
          source = "role_block_parent";
          break;
        }
        if (blockSpanIds.has(span.id)) {
          source = "role_block_span";
          break;
        }
        if (roleSpanIds.has(span.id)) {
          source = "inner_appointment_span";
          break;
        }
        source = "model_text_only";
      }
    }
    achievement.placementSource = source;
    bySource[source] = (bySource[source] ?? 0) + 1;

    const structural =
      source === "role_block_parent" ||
      source === "role_block_span" ||
      source === "inner_appointment_span";

    achievement.contentKind = classifyContentKind(achievement.normalizedText);

    if (!structural) {
      // Tekstlikhet alene er ikke plassering. Resultatet går tilbake i kø.
      if (achievement.placementConfidence === "high") downgradedFromHigh.push(achievement.localId);
      achievement.roleLocalId = null;
      achievement.status = "unassigned";
      achievement.placementConfidence = "needs_review";
      if (!achievement.issues.includes("achievement_unassigned")) {
        achievement.issues.push("achievement_unassigned");
      }
    } else {
      // Strukturell kobling er plassering, også når rollen mangler tittel.
      // Da avklares tittelen én gang på rollen — ikke per resultat.
      if (role && !(role.title ?? "").trim()) {
        role.provisional = true;
        role.needsReviewReason = role.needsReviewReason ?? "missing_role_title";
        if (!role.issues.includes("missing_role_title")) role.issues.push("missing_role_title");
      }
      achievement.status = "proposed";
      achievement.placementConfidence = "high";
      if (!achievement.placementReasons.includes(source)) {
        achievement.placementReasons = [...achievement.placementReasons, source];
      }
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
      roleTopology: output.roles.map((r) => ({
        localId: r.localId,
        employmentGroupKey: r.employmentGroupKey,
        title: r.title,
        startDate: r.startDate,
        endDate: r.endDate,
        predecessorRoleLocalId: r.predecessorRoleLocalId,
        concurrentWithRoleLocalIds: r.concurrentWithRoleLocalIds,
        appointmentRelation: r.appointmentRelation,
      })),
      provisionalRoles: output.roles
        .filter((r) => r.provisional)
        .map((r) => ({
          localId: r.localId,
          employer: r.employer,
          startDate: r.startDate,
          endDate: r.endDate,
          reason: r.needsReviewReason ?? "missing_role_title",
          attachedContentLocalIds: output.achievements
            .filter((a) => a.roleLocalId === r.localId)
            .map((a) => a.localId),
        })),
      contentKinds: {
        result: output.achievements.filter((a) => (a.contentKind ?? "result") === "result").length,
        deliverable: output.achievements.filter((a) => a.contentKind === "deliverable").length,
        roleEvidence: output.achievements.filter((a) => a.contentKind === "role_evidence").length,
      },
      placement: {

        high: output.achievements.filter((a) => a.placementConfidence === "high").length,
        low: output.achievements.filter((a) => a.placementConfidence === "low").length,
        needsReview: output.achievements.filter((a) => a.placementConfidence === "needs_review")
          .length,
        bySource,
        downgradedFromHigh,
      },
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
    // Flere kompetanser kan dele samme kildespenn (én kompetanseliste i CV-en).
    // Uten en stabil, kompetansespesifikk nøkkel ville de kollidere med
    // hverandre i lagringen og bare den første blitt skrevet.
    const canonicalKey =
      typeof args.extra["canonical_key"] === "string" ? (args.extra["canonical_key"] as string) : "";
    const rowHash =
      (args.atomType === "skill" || args.atomType === "domain") && canonicalKey
        ? `${hash}:${canonicalKey}`
        : hash;
    kept.push({
      proposal_action: args.action,
      target_atom_type: "career_atom",
      source_type: "cv_import",
      source_table: "cv_parse_candidates",
      source_record_id: candidate.id,
      source_id: ctx.cvImportId,
      source_import_id: ctx.cvImportId,
      source_hash: rowHash,

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
        provisional: role.provisional === true,
        needs_review_reason: role.needsReviewReason ?? null,
        issues: role.issues,
      },
    });
  }

  for (const a of output.achievements) {
    const kind = a.contentKind ?? "result";
    push({
      localId: a.localId,
      atomType: kind === "role_evidence" ? "role_evidence" : "achievement",
      contentNo: a.normalizedText,
      evidence: a.sourceEvidence,
      action: "create_atom",
      reviewState: a.status === "proposed" ? "ready_for_atom" : a.status,
      rationale: a.placementReasons.join(", ") || "Resultat knyttet til rolleblokk.",
      extra: {
        local_id: a.localId,
        role_local_id: a.roleLocalId,
        content_kind: kind,
        placement_confidence: a.placementConfidence,
        placement_source: a.placementSource,
        placement_reasons: a.placementReasons,
        issues: a.issues,
      },
    });
  }


  for (const s of output.skills) {
    const evidence = s.evidence.flatMap((e) => e.sourceEvidence);
    // Kalibrering fra konsolideringsfasen, når den er kjørt. Lokale
    // evidenssignaler lagres fortsatt — de er bare ikke en gjennomgangsoppgave.
    const calibrated = s as typeof s & {
      tier?: "reviewable" | "local_signal";
      tierReasons?: string[];
      roleCount?: number;
      achievementCount?: number;
      breadth?: "multiple_roles" | "single_role" | "single_result" | "none";

      explicit?: boolean;
      // Fase 4 — kompetansebelegg. Settes bare når fasen har kjørt.
      skillPlacementConfidence?: "high" | "medium" | "low" | "none";
      skillPlacementSource?: string;
      skillPlacementReason?: string;
      evidenceConflicts?: string[];
    };
    const tier = calibrated.tier ?? "reviewable";
    const linked = calibrated.skillPlacementConfidence !== undefined;
    push({
      localId: s.localId,
      atomType: "skill",
      contentNo: s.canonicalLabelNo,
      evidence,
      action: "suggest_evidence",
      reviewState: s.status === "proposed" ? "ready_for_atom" : s.status,
      rationale:
        calibrated.skillPlacementReason ||
        s.placementReasons.join(", ") ||
        "Kompetanse utledet fra rolle- og resultatbelegg.",
      extra: {
        local_id: s.localId,
        canonical_key: s.canonicalKey,
        display_label: s.displayLabel,
        inferred: s.inferred,
        placement_confidence: linked
          ? calibrated.skillPlacementConfidence
          : s.placementConfidence,
        placement_source: calibrated.skillPlacementSource ?? null,
        placement_reason: calibrated.skillPlacementReason ?? null,
        evidence_conflicts: calibrated.evidenceConflicts ?? [],
        skill_evidence_phase: linked ? "1.0.0" : null,
        skill_tier: tier,
        skill_tier_reasons: calibrated.tierReasons ?? [],
        skill_role_count: calibrated.roleCount ?? null,
        skill_achievement_count: calibrated.achievementCount ?? null,
        skill_breadth: calibrated.breadth ?? null,

        skill_explicit: calibrated.explicit ?? null,
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
      // Verktøy er en kvalifikasjon på linje med språk og sertifisering: den
      // skal kunne bekreftes i trinn 4, ikke bare ligge som evidenshint.
      action: "create_atom",
      reviewState: q.status === "proposed" ? "ready_for_atom" : q.status,
      rationale: "Kvalifikasjon fra kilden.",
      extra: { local_id: q.localId, kind: q.kind, issues: q.issues },
    });
  }

  return { kept, dropped };
}
