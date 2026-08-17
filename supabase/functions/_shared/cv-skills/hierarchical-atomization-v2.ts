// cv-atom-language-no v2.1.0 — hierarkisk atomisering.
//
// Fase 1: ett modellkall per ansettelsesgruppe. Hele gruppen behandles samlet,
//         slik at flere utnevnelser hos samme arbeidsgiver kan forstås som
//         etterfølgende og/eller overlappende.
// Fase 2: ett modellkall per rolleblokk (og ett for spennene uten rolle), med
//         begrenset samtidighet.
// Fase 3: deterministisk sammenslåing av kompetanser på canonicalKey og
//         kildebelegg. Ingen ekstra modellkall for deduplisering.
//
// Ren orkestrering: ingen database. Ingenting skrives til career_atoms.

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
  AtomizationIssue,
  CvAtomizationInput,
  CvAtomizationOutput,
  RoleAtomProposal,
  SkillProposal,
  SourceSpan,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import { canonicalSkillKey, parseAtomizationOutput } from "./atom-proposal-pipeline-v2.ts";

export const HIERARCHICAL_PIPELINE_VERSION = "1.0.0";

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

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Kjører oppgaver med et tak på samtidige kall. Rekkefølgen på svar bevares. */
async function mapLimit<T, R>(
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

function spansFor(input: CvAtomizationInput, ids: Iterable<string>): SourceSpan[] {
  const wanted = new Set(ids);
  return input.sourceSpans.filter((s) => wanted.has(s.id));
}

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
  const { input, profile, correlationId, timeoutMs } = args;
  const concurrency = args.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  const startedAt = Date.now();

  const metrics: PhaseMetric[] = [];
  const failed: HierarchicalResult["failed"] = [];
  const issues: AtomizationIssue[] = [];

  // ------------------------------------------------- fase 1: ansettelsesforløp
  const groups = new Map<string, typeof input.roleBlocks>();
  for (const block of input.roleBlocks) {
    const key = block.employmentGroupKey ?? `block:${block.id}`;
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }

  const groupEntries = [...groups.entries()];
  const roles: RoleAtomProposal[] = [];

  const groupResults = await mapLimit(groupEntries, concurrency, async ([key, blocks], index) => {
    const spanIds = blocks.flatMap((b) => b.sourceSpanIds);
    const spans = spansFor(input, spanIds);
    const signature = await sha256Hex(
      JSON.stringify({
        phase: "appointments",
        pipeline: HIERARCHICAL_PIPELINE_VERSION,
        prompt: profile.promptVersion,
        key,
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
            employmentGroupKey: key,
            roleBlocks: blocks,
            sourceSpans: spans,
          }),
        },
      ],
      correlationId: `${correlationId}:g${index + 1}`,
      timeoutMs,
      maxRetries: 1,
      runtime: { apiKey: args.anthropicApiKey },
    });

    const metric: PhaseMetric = {
      phase: "appointments",
      key,
      subBatchSignature: signature,
      spans: spans.length,
      ok: call.ok,
      errorCode: call.ok ? null : (call.errorCode ?? call.outcome),
      durationMs: call.durationMs,
      inputTokens: call.ok ? (call.usage.inputTokens ?? 0) : 0,
      outputTokens: call.ok ? (call.usage.outputTokens ?? 0) : 0,
    };

    if (!call.ok) {
      return {
        metric,
        key,
        blocks,
        roles: [] as RoleAtomProposal[],
        issues: [] as AtomizationIssue[],
      };
    }

    const parsed = parseAtomizationOutput(call.text, { allowEmpty: true });
    if (!parsed.ok) {
      return {
        metric: { ...metric, ok: false, errorCode: "invalid_output" },
        key,
        blocks,
        roles: [] as RoleAtomProposal[],
        issues: [] as AtomizationIssue[],
      };
    }

    // Lokale id-er gjøres globalt entydige før blokkene slås sammen.
    const prefix = `g${index + 1}`;
    const rename = new Map(parsed.output.roles.map((r) => [r.localId, `${prefix}${r.localId}`]));
    const groupRoles = parsed.output.roles.map((role) => ({
      ...role,
      localId: rename.get(role.localId)!,
      employmentGroupKey: key.startsWith("emp:") ? key : (blocks[0]?.employmentGroupKey ?? null),
      roleBlockId:
        role.roleBlockId && blocks.some((b) => b.id === role.roleBlockId)
          ? role.roleBlockId
          : (blocks[0]?.id ?? null),
      predecessorRoleLocalId: role.predecessorRoleLocalId
        ? (rename.get(role.predecessorRoleLocalId) ?? null)
        : null,
      concurrentWithRoleLocalIds: role.concurrentWithRoleLocalIds
        .map((id) => rename.get(id))
        .filter((id): id is string => Boolean(id)),
    }));
    return { metric, key, blocks, roles: groupRoles, issues: parsed.output.issues };
  });

  for (const r of groupResults) {
    metrics.push(r.metric);
    if (!r.metric.ok) {
      failed.push({ phase: "appointments", key: r.key, errorCode: r.metric.errorCode ?? "error" });
      // Ansettelsesgruppen mangler rolleforløp: si det, ikke gjett.
      issues.push({
        code: "missing_role_structure",
        sourceSpanIds: r.blocks.flatMap((b) => b.sourceSpanIds),
        message: `Rolleforløpet for ${r.key} kunne ikke fastsettes (${r.metric.errorCode}). Ansettelsen må gjennomgås manuelt.`,
      });
      continue;
    }
    roles.push(...r.roles);
    for (const issue of r.issues ?? []) issues.push(issue);
  }

  // ------------------------------------- fase 2: innhold per rolleblokk
  type BlockTask = { key: string; spanIds: string[]; roles: RoleAtomProposal[] };
  const tasks: BlockTask[] = input.roleBlocks.map((block) => ({
    key: block.id,
    spanIds: block.sourceSpanIds,
    roles: roles.filter((r) => r.roleBlockId === block.id),
  }));
  if (input.unassignedSpans.length > 0) {
    tasks.push({ key: "__unassigned__", spanIds: input.unassignedSpans, roles: [] });
  }

  const blockResults = await mapLimit(tasks, concurrency, async (task, index) => {
    const spans = spansFor(input, task.spanIds);
    const signature = await sha256Hex(
      JSON.stringify({
        phase: "block_content",
        pipeline: HIERARCHICAL_PIPELINE_VERSION,
        prompt: profile.promptVersion,
        key: task.key,
        roles: task.roles.map((r) => [r.localId, r.title, r.startDate, r.endDate]),
        spans: spans.map((s) => [s.id, s.text]),
      }),
    );
    if (spans.length === 0) {
      return {
        metric: {
          phase: "block_content" as const,
          key: task.key,
          subBatchSignature: signature,
          spans: 0,
          ok: true,
          errorCode: null,
          durationMs: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
        task,
        output: null,
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
            roleBlockId: task.key === "__unassigned__" ? null : task.key,
            roles: task.roles.map((r) => ({
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
      correlationId: `${correlationId}:b${index + 1}`,
      timeoutMs,
      maxRetries: 1,
      runtime: { apiKey: args.anthropicApiKey },
    });

    const metric: PhaseMetric = {
      phase: "block_content",
      key: task.key,
      subBatchSignature: signature,
      spans: spans.length,
      ok: call.ok,
      errorCode: call.ok ? null : (call.errorCode ?? call.outcome),
      durationMs: call.durationMs,
      inputTokens: call.ok ? (call.usage.inputTokens ?? 0) : 0,
      outputTokens: call.ok ? (call.usage.outputTokens ?? 0) : 0,
    };
    if (!call.ok) return { metric, task, output: null };

    const parsed = parseAtomizationOutput(call.text, { allowEmpty: true });
    if (!parsed.ok) {
      return { metric: { ...metric, ok: false, errorCode: "invalid_output" }, task, output: null };
    }

    // Entydige id-er per blokk. Roller er allerede globale og beholdes.
    const prefix = `b${index + 1}`;
    const roleIds = new Set(task.roles.map((r) => r.localId));
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

    return {
      metric,
      task,
      output: { achievements, skills, qualifications, issues: parsed.output.issues },
    };
  });

  const achievements: CvAtomizationOutput["achievements"] = [];
  const rawSkills: SkillProposal[] = [];
  const qualifications: CvAtomizationOutput["qualifications"] = [];

  for (const r of blockResults) {
    metrics.push(r.metric);
    if (!r.metric.ok) {
      // Feil i én blokk skal ikke miste godkjente resultater fra andre blokker.
      failed.push({ phase: "block_content", key: r.task.key, errorCode: r.metric.errorCode ?? "error" });
      issues.push({
        code: "insufficient_source_evidence",
        sourceSpanIds: r.task.spanIds,
        message: `Innholdet i blokken ${r.task.key} ble ikke behandlet (${r.metric.errorCode}). Blokken må gjennomgås manuelt.`,
      });
      continue;
    }
    if (!r.output) continue;
    achievements.push(...r.output.achievements);
    rawSkills.push(...r.output.skills);
    qualifications.push(...r.output.qualifications);
    issues.push(...r.output.issues);
  }

  // ------------------------------- fase 3: deterministisk kompetanseflette
  const { skills, report: skillMerge } = mergeSkills(rawSkills);

  return {
    output: { roles, achievements, skills, qualifications, issues },
    metrics,
    failed,
    skillMerge,
    modelCalls: metrics.filter((m) => m.durationMs > 0 || !m.ok).length,
    totalInputTokens: metrics.reduce((n, m) => n + m.inputTokens, 0),
    totalOutputTokens: metrics.reduce((n, m) => n + m.outputTokens, 0),
    wallClockMs: Date.now() - startedAt,
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
  const mergedKeys = new Set<string>();
  const conflictingNormalizations = new Set<string>();

  for (const skill of input) {
    const key = skill.canonicalKey || canonicalSkillKey(skill.canonicalLabelNo);
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

  return {
    skills: [...byKey.values()],
    report: {
      before: input.length,
      after: byKey.size,
      mergedKeys: [...mergedKeys],
      conflictingNormalizations: [...conflictingNormalizations],
      semanticKeyCollisions,
    },
  };
}
