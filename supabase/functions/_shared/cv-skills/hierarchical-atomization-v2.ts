// cv-atom-language-no v2.1.0 — hierarkisk atomisering.
//
// Fase 1: ett modellkall per ansettelsesgruppe. Hele gruppen behandles samlet,
//         slik at flere utnevnelser hos samme arbeidsgiver kan forstås som
//         etterfølgende og/eller overlappende.
// Fase 2: ett modellkall per rolleblokk (og ett for spennene uten rolle), med
//         begrenset samtidighet.
// Fase 3: deterministisk sammenslåing og kalibrering av kompetanser. Ingen
//         ekstra modellkall for deduplisering.
//
// Ren orkestrering: ingen database. Ingenting skrives til career_atoms.
// Stegene er eksportert enkeltvis slik at en asynkron jobb kan kjøre dem
// én og én med synlig fremdrift.

import { callClaude, type ModelProfile } from "../claude/client.ts";
import {
  APPOINTMENTS_OUTPUT_CONTRACT_NO,
  APPOINTMENTS_SYSTEM_PROMPT_NO,
  BLOCK_CONTENT_OUTPUT_CONTRACT_NO,
  BLOCK_CONTENT_SYSTEM_PROMPT_NO,
  buildAppointmentsUserPrompt,
  buildBlockContentUserPrompt,
} from "./vendor/cv-atom-language-no/v2/prompt.ts";
import type {
  AchievementProposal,
  AtomizationIssue,
  CvAtomizationInput,
  CvAtomizationOutput,
  QualificationProposal,
  RoleAtomProposal,
  RoleBlock,
  SkillProposal,
  SourceSpan,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import { canonicalSkillKey, parseAtomizationOutput } from "./atom-proposal-pipeline-v2.ts";
import {
  consolidateSkills,
  type SkillConsolidationReport,
  type ConsolidatedSkill,
} from "./skill-consolidation-v2.ts";

export const HIERARCHICAL_PIPELINE_VERSION = "1.1.0";

/** Plattformgrense for åpne utgående tilkoblinger tas hensyn til her. */
export const DEFAULT_MAX_CONCURRENCY = 3;

export type PhaseMetric = {
  phase: "appointments" | "block_content";
  /** employmentGroupKey i fase 1, rolleblokk-id (eller "__unassigned__") i fase 2. */
  key: string;
  /** Egen input-signatur for delbatchen — grunnlaget for idempotens. */
  subBatchSignature: string;
  spans: number;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
};

export type SkillMergeReport = {
  /** Antall kompetanseforslag før sammenslåing. */
  before: number;
  after: number;
  /** canonicalKey som forekom i flere rolleblokker. */
  mergedKeys: string[];
  /** Samme nøkkel med motstridende normalisering — settes needs_review. */
  conflictingNormalizations: string[];
  /** Samme begrep under ulike nøkler — settes needs_review. */
  semanticKeyCollisions: string[];
  /** Eksempler på hva som faktisk ble slått sammen. */
  mergeExamples: { canonical_key: string; labels: string[]; roles: number }[];
  /** Kalibrering: hva som er gjennomgåbart og hva som blir lokalt belegg. */
  consolidation: SkillConsolidationReport | null;
};

export type HierarchicalResult = {
  output: CvAtomizationOutput;
  metrics: PhaseMetric[];
  /** Blokker/grupper som feilet. Importen er ikke ferdig før disse er løst. */
  failed: Array<{ phase: PhaseMetric["phase"]; key: string; errorCode: string }>;
  skillMerge: SkillMergeReport;
  modelCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Veggklokketid for hele den hierarkiske kjøringen. */
  wallClockMs: number;
};

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kjører oppgaver med et tak på samtidige kall. Rekkefølgen på svar bevares. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

export function spansFor(input: CvAtomizationInput, ids: Iterable<string>): SourceSpan[] {
  const wanted = new Set(ids);
  return input.sourceSpans.filter((s) => wanted.has(s.id));
}

// ---------------------------------------------------------------------------
// Deterministisk plan: hvilke blokker som skal kjøres, og i hvilken rekkefølge
// ---------------------------------------------------------------------------

export type PlannedAppointmentGroup = {
  phase: "appointments";
  key: string;
  label: string;
  spanIds: string[];
  blocks: RoleBlock[];
};

export type PlannedContentBlock = {
  phase: "block_content";
  key: string;
  label: string;
  spanIds: string[];
};

export type HierarchicalPlan = {
  appointments: PlannedAppointmentGroup[];
  content: PlannedContentBlock[];
};

function groupLabel(key: string, blocks: RoleBlock[]): string {
  const employer = blocks.find((b) => b.employer)?.employer;
  if (employer) return employer;
  const title = blocks.find((b) => b.title)?.title;
  return title ?? key.replace(/^emp:/, "");
}

export function planHierarchicalRun(input: CvAtomizationInput): HierarchicalPlan {
  const groups = new Map<string, RoleBlock[]>();
  for (const block of input.roleBlocks) {
    const key = block.employmentGroupKey ?? `block:${block.id}`;
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }
  const appointments: PlannedAppointmentGroup[] = [...groups.entries()].map(([key, blocks]) => ({
    phase: "appointments",
    key,
    label: groupLabel(key, blocks),
    spanIds: blocks.flatMap((b) => b.sourceSpanIds),
    blocks,
  }));

  const content: PlannedContentBlock[] = input.roleBlocks.map((block) => ({
    phase: "block_content",
    key: block.id,
    label: block.employer ?? block.title ?? block.id,
    spanIds: block.sourceSpanIds,
  }));
  if (input.unassignedSpans.length > 0) {
    content.push({
      phase: "block_content",
      key: "__unassigned__",
      label: "Øvrig innhold uten rolle",
      spanIds: input.unassignedSpans,
    });
  }
  return { appointments, content };
}

// ---------------------------------------------------------------------------
// Fase 1 — ett steg per ansettelsesgruppe
// ---------------------------------------------------------------------------

export type StepContext = {
  input: CvAtomizationInput;
  profile: ModelProfile;
  anthropicApiKey: string;
  correlationId: string;
  timeoutMs: number;
};

export type AppointmentStepResult = {
  metric: PhaseMetric;
  roles: RoleAtomProposal[];
  issues: AtomizationIssue[];
};

export async function runAppointmentGroupStep(
  ctx: StepContext,
  group: PlannedAppointmentGroup,
  index: number,
): Promise<AppointmentStepResult> {
  const { input, profile } = ctx;
  const spans = spansFor(input, group.spanIds);
  const subBatchSignature = await sha256Hex(
    JSON.stringify({
      phase: "appointments",
      pipeline: HIERARCHICAL_PIPELINE_VERSION,
      prompt: profile.promptVersion,
      key: group.key,
      spans: spans.map((s) => [s.id, s.text]),
    }),
  );

  const call = await callClaude({
    profile,
    system: `${APPOINTMENTS_SYSTEM_PROMPT_NO}\n\n${APPOINTMENTS_OUTPUT_CONTRACT_NO}`,
    messages: [
      {
        role: "user",
        content: buildAppointmentsUserPrompt({
          documentLanguage: input.documentLanguage,
          employmentGroupKey: group.key,
          roleBlocks: group.blocks,
          sourceSpans: spans,
        }),
      },
    ],
    correlationId: `${ctx.correlationId}:g${index + 1}`,
    timeoutMs: ctx.timeoutMs,
    maxRetries: 1,
    runtime: { apiKey: ctx.anthropicApiKey },
  });

  const metric: PhaseMetric = {
    phase: "appointments",
    key: group.key,
    subBatchSignature,
    spans: spans.length,
    ok: call.ok,
    errorCode: call.ok ? null : (call.errorCode ?? call.outcome),
    durationMs: call.durationMs,
    inputTokens: call.ok ? (call.usage.inputTokens ?? 0) : 0,
    outputTokens: call.ok ? (call.usage.outputTokens ?? 0) : 0,
  };
  if (!call.ok) return { metric, roles: [], issues: [] };

  const parsed = parseAtomizationOutput(call.text, { allowEmpty: true });
  if (!parsed.ok) {
    return { metric: { ...metric, ok: false, errorCode: "invalid_output" }, roles: [], issues: [] };
  }

  // Lokale id-er gjøres globalt entydige før blokkene slås sammen.
  const prefix = `g${index + 1}`;
  const rename = new Map(parsed.output.roles.map((r) => [r.localId, `${prefix}${r.localId}`]));
  const roles = parsed.output.roles.map((role) => ({
    ...role,
    localId: rename.get(role.localId)!,
    employmentGroupKey: group.key.startsWith("emp:")
      ? group.key
      : (group.blocks[0]?.employmentGroupKey ?? null),
    roleBlockId:
      role.roleBlockId && group.blocks.some((b) => b.id === role.roleBlockId)
        ? role.roleBlockId
        : (group.blocks[0]?.id ?? null),
    predecessorRoleLocalId: role.predecessorRoleLocalId
      ? (rename.get(role.predecessorRoleLocalId) ?? null)
      : null,
    concurrentWithRoleLocalIds: role.concurrentWithRoleLocalIds
      .map((id) => rename.get(id))
      .filter((id): id is string => Boolean(id)),
  }));

  return { metric, roles, issues: parsed.output.issues };
}

// ---------------------------------------------------------------------------
// Fase 2 — ett steg per rolleblokk
// ---------------------------------------------------------------------------

export type BlockContentStepResult = {
  metric: PhaseMetric;
  achievements: AchievementProposal[];
  skills: SkillProposal[];
  qualifications: QualificationProposal[];
  issues: AtomizationIssue[];
};

export async function runBlockContentStep(
  ctx: StepContext,
  block: PlannedContentBlock,
  roles: RoleAtomProposal[],
  index: number,
): Promise<BlockContentStepResult> {
  const { input, profile } = ctx;
  const spans = spansFor(input, block.spanIds);
  const subBatchSignature = await sha256Hex(
    JSON.stringify({
      phase: "block_content",
      pipeline: HIERARCHICAL_PIPELINE_VERSION,
      prompt: profile.promptVersion,
      key: block.key,
      roles: roles.map((r) => [r.localId, r.title, r.startDate, r.endDate]),
      spans: spans.map((s) => [s.id, s.text]),
    }),
  );

  const empty = {
    achievements: [] as AchievementProposal[],
    skills: [] as SkillProposal[],
    qualifications: [] as QualificationProposal[],
    issues: [] as AtomizationIssue[],
  };

  if (spans.length === 0) {
    return {
      metric: {
        phase: "block_content",
        key: block.key,
        subBatchSignature,
        spans: 0,
        ok: true,
        errorCode: null,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
      ...empty,
    };
  }

  const call = await callClaude({
    profile,
    system: `${BLOCK_CONTENT_SYSTEM_PROMPT_NO}\n\n${BLOCK_CONTENT_OUTPUT_CONTRACT_NO}`,
    messages: [
      {
        role: "user",
        content: buildBlockContentUserPrompt({
          documentLanguage: input.documentLanguage,
          roleBlockId: block.key === "__unassigned__" ? null : block.key,
          roles: roles.map((r) => ({
            localId: r.localId,
            title: r.title,
            employer: r.employer,
            startDate: r.startDate,
            endDate: r.endDate,
          })),
          sourceSpans: spans,
        }),
      },
    ],
    correlationId: `${ctx.correlationId}:b${index + 1}`,
    timeoutMs: ctx.timeoutMs,
    maxRetries: 1,
    runtime: { apiKey: ctx.anthropicApiKey },
  });

  const metric: PhaseMetric = {
    phase: "block_content",
    key: block.key,
    subBatchSignature,
    spans: spans.length,
    ok: call.ok,
    errorCode: call.ok ? null : (call.errorCode ?? call.outcome),
    durationMs: call.durationMs,
    inputTokens: call.ok ? (call.usage.inputTokens ?? 0) : 0,
    outputTokens: call.ok ? (call.usage.outputTokens ?? 0) : 0,
  };
  if (!call.ok) return { metric, ...empty };

  const parsed = parseAtomizationOutput(call.text, { allowEmpty: true });
  if (!parsed.ok) {
    return { metric: { ...metric, ok: false, errorCode: "invalid_output" }, ...empty };
  }

  // Entydige id-er per blokk. Roller er allerede globale og beholdes.
  const prefix = `b${index + 1}`;
  const roleIds = new Set(roles.map((r) => r.localId));
  const achRename = new Map(
    parsed.output.achievements.map((a) => [a.localId, `${prefix}${a.localId}`]),
  );
  const achievements = parsed.output.achievements.map((a) => ({
    ...a,
    localId: achRename.get(a.localId)!,
    roleLocalId: a.roleLocalId && roleIds.has(a.roleLocalId) ? a.roleLocalId : null,
  }));
  const skills = parsed.output.skills.map((s) => ({
    ...s,
    localId: `${prefix}${s.localId}`,
    canonicalKey: s.canonicalKey || canonicalSkillKey(s.canonicalLabelNo),
    evidence: s.evidence.map((e) => ({
      ...e,
      roleLocalId: e.roleLocalId && roleIds.has(e.roleLocalId) ? e.roleLocalId : null,
      achievementLocalId: e.achievementLocalId
        ? (achRename.get(e.achievementLocalId) ?? null)
        : null,
    })),
  }));
  const qualifications = parsed.output.qualifications.map((q) => ({
    ...q,
    localId: `${prefix}${q.localId}`,
  }));

  return { metric, achievements, skills, qualifications, issues: parsed.output.issues };
}

// ---------------------------------------------------------------------------
// Samlet kjøring (brukes av synkron måling og evaluering)
// ---------------------------------------------------------------------------

export type HierarchicalInput = {
  input: CvAtomizationInput;
  profile: ModelProfile;
  anthropicApiKey: string;
  correlationId: string;
  timeoutMs: number;
  maxConcurrency?: number;
};

export async function runHierarchicalAtomization(
  args: HierarchicalInput,
): Promise<HierarchicalResult> {
  const { input } = args;
  const ctx: StepContext = {
    input,
    profile: args.profile,
    anthropicApiKey: args.anthropicApiKey,
    correlationId: args.correlationId,
    timeoutMs: args.timeoutMs,
  };
  const concurrency = args.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const startedAt = Date.now();
  const plan = planHierarchicalRun(input);

  const metrics: PhaseMetric[] = [];
  const failed: HierarchicalResult["failed"] = [];
  const issues: AtomizationIssue[] = [];
  const roles: RoleAtomProposal[] = [];

  const groupResults = await mapLimit(plan.appointments, concurrency, (group, index) =>
    runAppointmentGroupStep(ctx, group, index),
  );

  plan.appointments.forEach((group, i) => {
    const r = groupResults[i]!;
    metrics.push(r.metric);
    if (!r.metric.ok) {
      failed.push({
        phase: "appointments",
        key: group.key,
        errorCode: r.metric.errorCode ?? "error",
      });
      issues.push({
        code: "missing_role_structure",
        sourceSpanIds: group.spanIds,
        message: `Rolleforløpet for ${group.label} kunne ikke fastsettes (${r.metric.errorCode}). Ansettelsen må gjennomgås manuelt.`,
      });
      return;
    }
    roles.push(...r.roles);
    issues.push(...r.issues);
  });

  const blockResults = await mapLimit(plan.content, concurrency, (block, index) =>
    runBlockContentStep(
      ctx,
      block,
      roles.filter((r) => r.roleBlockId === block.key),
      index,
    ),
  );

  const achievements: AchievementProposal[] = [];
  const rawSkills: SkillProposal[] = [];
  const qualifications: QualificationProposal[] = [];

  plan.content.forEach((block, i) => {
    const r = blockResults[i]!;
    metrics.push(r.metric);
    if (!r.metric.ok) {
      // Feil i én blokk skal ikke miste godkjente resultater fra andre blokker.
      failed.push({
        phase: "block_content",
        key: block.key,
        errorCode: r.metric.errorCode ?? "error",
      });
      issues.push({
        code: "insufficient_source_evidence",
        sourceSpanIds: block.spanIds,
        message: `Innholdet i blokken ${block.label} ble ikke behandlet (${r.metric.errorCode}). Blokken må gjennomgås manuelt.`,
      });
      return;
    }
    achievements.push(...r.achievements);
    rawSkills.push(...r.skills);
    qualifications.push(...r.qualifications);
    issues.push(...r.issues);
  });

  const merged = finalizeSkills(rawSkills, input);

  // Fase 4 — kompetansebelegg: knytt gjennomgåbare kompetanser til konkrete
  // roller og resultater. Ingen ny CV-parsing, bare tidligere v2.1-utdata.
  const evidenceStep = await runSkillEvidenceStep({
    profile: args.profile,
    anthropicApiKey: args.anthropicApiKey,
    correlationId: args.correlationId,
    timeoutMs: args.timeoutMs,
    request: buildSkillEvidenceRequest({
      skills: merged.skills.filter((s) => s.tier === "reviewable"),
      roles,
      achievements,
      input,
    }),
  });
  metrics.push({
    phase: "block_content",
    key: "__skill_evidence__",
    subBatchSignature: "",
    spans: 0,
    ok: evidenceStep.ok,
    errorCode: evidenceStep.errorCode,
    durationMs: evidenceStep.durationMs,
    inputTokens: evidenceStep.inputTokens,
    outputTokens: evidenceStep.outputTokens,
  });
  const linked = applySkillEvidence({
    skills: merged.skills,
    assignments: evidenceStep.assignments,
    roles,
    achievements,
  });

  return {
    output: { roles, achievements, skills: linked.skills, qualifications, issues },
    metrics,
    failed,
    skillMerge: merged.report,
    skillEvidence: linked.report,
    modelCalls: metrics.filter((m) => m.durationMs > 0 || !m.ok).length,
    totalInputTokens: metrics.reduce((n, m) => n + m.inputTokens, 0),
    totalOutputTokens: metrics.reduce((n, m) => n + m.outputTokens, 0),
    wallClockMs: Date.now() - startedAt,
  };

}

// ---------------------------------------------------------------------------
// Fase 3 — deterministisk fletting + kalibrering
// ---------------------------------------------------------------------------

/**
 * Global konsolideringsfase: flett på canonicalKey, og skill deretter mellom
 * gjennomgåbare kompetanser og lokale evidenssignaler. Ingen modellkall, ingen
 * CV-tekst sendes ut på nytt.
 */
export function finalizeSkills(
  rawSkills: SkillProposal[],
  input: CvAtomizationInput,
): { skills: ConsolidatedSkill[]; report: SkillMergeReport } {
  const { skills, report } = mergeSkills(rawSkills);
  const consolidated = consolidateSkills(skills, input);
  return {
    skills: consolidated.skills,
    report: { ...report, consolidation: consolidated.report },
  };
}

function normalizeLabel(label: string): string {
  return label.normalize("NFKC").toLocaleLowerCase("nb-NO").replace(/\s+/g, " ").trim();
}

/**
 * Slår sammen kompetanser på tvers av rolleblokker deterministisk: samme
 * canonicalKey blir ett forslag med forent kildebelegg. Motstridende
 * normalisering eller semantisk kollisjon mellom nøkler løses ikke med et nytt
 * modellkall — avviket settes til needs_review.
 */
export function mergeSkills(input: SkillProposal[]): {
  skills: SkillProposal[];
  report: SkillMergeReport;
} {
  const byKey = new Map<string, SkillProposal>();
  const labelsByKey = new Map<string, Set<string>>();
  const mergedKeys = new Set<string>();
  const conflictingNormalizations = new Set<string>();

  for (const skill of input) {
    const key = skill.canonicalKey || canonicalSkillKey(skill.canonicalLabelNo);
    labelsByKey.set(key, (labelsByKey.get(key) ?? new Set()).add(skill.canonicalLabelNo));
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...skill, canonicalKey: key, evidence: [...skill.evidence] });
      continue;
    }
    mergedKeys.add(key);

    // Samme nøkkel, ulikt begrep: normaliseringen er motstridende.
    if (normalizeLabel(existing.canonicalLabelNo) !== normalizeLabel(skill.canonicalLabelNo)) {
      conflictingNormalizations.add(key);
      existing.status = "needs_review";
      if (!existing.issues.includes("skill_needs_review")) existing.issues.push("skill_needs_review");
    }

    const seen = new Set(
      existing.evidence.map((e) =>
        JSON.stringify([e.roleLocalId ?? null, e.achievementLocalId ?? null,
          e.sourceEvidence.map((x) => x.sourceSpanId).sort()]),
      ),
    );
    for (const evidence of skill.evidence) {
      const fingerprint = JSON.stringify([
        evidence.roleLocalId ?? null,
        evidence.achievementLocalId ?? null,
        evidence.sourceEvidence.map((x) => x.sourceSpanId).sort(),
      ]);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      existing.evidence.push(evidence);
    }
    if (skill.status === "needs_review") existing.status = "needs_review";
    existing.inferred = existing.inferred && skill.inferred;
  }

  // Samme begrep under ulike nøkler: semantisk kollisjon, ikke automatisk fletting.
  const byLabel = new Map<string, string[]>();
  for (const skill of byKey.values()) {
    const label = normalizeLabel(skill.canonicalLabelNo);
    byLabel.set(label, [...(byLabel.get(label) ?? []), skill.canonicalKey]);
  }
  const semanticKeyCollisions: string[] = [];
  for (const [, keys] of byLabel) {
    if (keys.length < 2) continue;
    semanticKeyCollisions.push(...keys);
    for (const key of keys) {
      const skill = byKey.get(key)!;
      skill.status = "needs_review";
      if (!skill.issues.includes("skill_needs_review")) skill.issues.push("skill_needs_review");
    }
  }

  const mergeExamples = [...mergedKeys].slice(0, 20).map((key) => {
    const skill = byKey.get(key)!;
    return {
      canonical_key: key,
      labels: [...(labelsByKey.get(key) ?? new Set<string>())],
      roles: new Set(skill.evidence.map((e) => e.roleLocalId).filter(Boolean)).size,
    };
  });

  return {
    skills: [...byKey.values()],
    report: {
      before: input.length,
      after: byKey.size,
      mergedKeys: [...mergedKeys],
      conflictingNormalizations: [...conflictingNormalizations],
      semanticKeyCollisions,
      mergeExamples,
      consolidation: null,
    },
  };
}
