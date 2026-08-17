// cv-atom-language-no v2.1 — fase 4: kompetansebelegg.
//
// Fasen kjøres ETTER at rolleutnevnelser, resultater og den deterministiske
// kompetansekonsolideringen er ferdige. Formålet er å knytte hver gjennomgåbar
// kompetanse til de konkrete rollene og resultatene som faktisk demonstrerer
// den — ikke å normalisere navn på nytt.
//
// Prinsipper:
//   - Modellen ser bare frosset CV-input (kildespenn) og tidligere v2.1-utdata.
//   - Modellen returnerer BARE lokale referanse-id-er. Serveren hydrerer tekst,
//     side, offset og provenance fra det frosne inputtet.
//   - En kobling uten minst én konkret rolle eller ett konkret resultat blir
//     aldri stående: da er placementConfidence = none.
//   - `semantic_evidence_match` er et forslag, aldri godkjenning.
//   - Lokale evidenssignaler og kvalifikasjoner (sertifiseringer) berøres ikke.

import { callClaude, type ModelProfile } from "../claude/client.ts";
import type {
  AchievementProposal,
  CvAtomizationInput,
  RoleAtomProposal,
  SkillEvidenceRef,
  SourceEvidence,
  SourceSpan,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import type { ConsolidatedSkill } from "./skill-consolidation-v2.ts";

export const SKILL_EVIDENCE_PHASE_VERSION = "1.0.0";
export const SKILL_EVIDENCE_PROMPT_VERSION = "1.0.0";

export type SkillPlacementConfidence = "high" | "medium" | "low" | "none";

export type SkillPlacementSource =
  | "explicit_role_block"
  | "explicit_result"
  | "semantic_evidence_match"
  | "none";

export type SkillEvidenceAssignment = {
  canonicalKey: string;
  evidenceRoleLocalIds: string[];
  evidenceResultLocalIds: string[];
  placementConfidence: SkillPlacementConfidence;
  placementSource: SkillPlacementSource;
  placementReason: string;
  conflicts: string[];
};

export type SkillEvidenceReport = {
  version: string;
  promptVersion: string;
  considered: number;
  linked: number;
  byConfidence: Record<SkillPlacementConfidence, number>;
  bySource: Record<SkillPlacementSource, number>;
  droppedReferences: { canonical_key: string; local_id: string }[];
  downgraded: { canonical_key: string; reason: string }[];
};

const CONFIDENCES: SkillPlacementConfidence[] = ["high", "medium", "low", "none"];
const SOURCES: SkillPlacementSource[] = [
  "explicit_role_block",
  "explicit_result",
  "semantic_evidence_match",
  "none",
];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const SKILL_EVIDENCE_SYSTEM_PROMPT_NO = `Du kobler kompetanser til det konkrete belegget i en allerede strukturert CV.

Du får:
- gjennomgåbare kompetanser med canonical key, navn og kildespenn
- roller med lokal id, tittel, arbeidsgiver og periode
- resultater/leveranser med lokal id, tekst og hvilken rolle de hører til

Oppgaven er å avgjøre hvilke roller og hvilke resultater som faktisk
demonstrerer hver kompetanse.

Regler:
- Bruk bare lokale id-er som finnes i inputtet. Ikke finn på id-er.
- En kobling krever konkret støtte i rolleteksten eller resultatteksten.
  Ren ordlikhet i et kompetansenavn er ikke støtte.
- Er kompetansen bare nevnt i en generell kompetanseliste, og ingen rolle
  eller resultat beskriver den, skal placementConfidence være none med tomme
  lister. Det er et helt akseptabelt svar.
- explicit_role_block: rollen selv beskriver kompetansen (ansvar, mandat,
  stillingens innhold).
- explicit_result: ett eller flere resultater beskriver kompetansen direkte.
- semantic_evidence_match: innholdet beskriver kompetansen med andre ord, men
  peker på minst én konkret rolle eller ett konkret resultat.
- high: eksplisitt og entydig belegg i minst ett resultat eller én rolle.
  medium: tydelig belegg, men noe tolkning.
  low: mulig belegg som brukeren bør vurdere.
  none: ingen konkret støtte.
- placementReason skal være én kort norsk setning som viser hva belegget er.
- Motstrid eller usikkerhet føres i conflicts.
- Ikke omtolk sertifiseringer, utdanning eller språk som kompetansebelegg.
- Returner bare JSON.`;

export const SKILL_EVIDENCE_OUTPUT_CONTRACT_NO = `Svar med ett JSON-objekt, uten markdown og uten tekst utenfor JSON:
{
  "skills": [
    {
      "canonicalKey": "<key fra input>",
      "evidenceRoleLocalIds": ["<rolle-id fra input>"],
      "evidenceResultLocalIds": ["<resultat-id fra input>"],
      "placementConfidence": "high|medium|low|none",
      "placementSource": "explicit_role_block|explicit_result|semantic_evidence_match|none",
      "placementReason": "<kort begrunnelse>",
      "conflicts": []
    }
  ]
}`;

export type SkillEvidenceRequest = {
  skills: { canonicalKey: string; label: string; sourceSpans: { id: string; text: string }[] }[];
  roles: {
    localId: string;
    title: string | null;
    employer: string | null;
    startDate: string | null;
    endDate: string | null;
    text: string;
  }[];
  results: { localId: string; roleLocalId: string | null; text: string }[];
};

function spanText(input: CvAtomizationInput, id: string): string {
  return input.sourceSpans.find((s: SourceSpan) => s.id === id)?.text ?? "";
}

export function buildSkillEvidenceRequest(args: {
  skills: ConsolidatedSkill[];
  roles: RoleAtomProposal[];
  achievements: AchievementProposal[];
  input: CvAtomizationInput;
}): SkillEvidenceRequest {
  return {
    skills: args.skills.map((s) => ({
      canonicalKey: s.canonicalKey,
      label: s.canonicalLabelNo,
      sourceSpans: [
        ...new Set(s.evidence.flatMap((e) => e.sourceEvidence.map((x) => x.sourceSpanId))),
      ].map((id) => ({ id, text: spanText(args.input, id).slice(0, 400) })),
    })),
    roles: args.roles.map((r) => ({
      localId: r.localId,
      title: r.title,
      employer: r.employer,
      startDate: r.startDate,
      endDate: r.endDate,
      text: r.sourceEvidence
        .map((e) => spanText(args.input, e.sourceSpanId))
        .join(" ")
        .slice(0, 1200),
    })),
    results: args.achievements.map((a) => ({
      localId: a.localId,
      roleLocalId: a.roleLocalId,
      text: a.normalizedText.slice(0, 600),
    })),
  };
}

export function buildSkillEvidenceUserPrompt(request: SkillEvidenceRequest): string {
  return JSON.stringify({ task: "link_skill_evidence", ...request });
}

// ---------------------------------------------------------------------------
// Modellsteg
// ---------------------------------------------------------------------------

export type SkillEvidenceStepResult = {
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  assignments: SkillEvidenceAssignment[];
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function strList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => str(v)).filter((v): v is string => Boolean(v)) : [];
}

export function parseSkillEvidenceOutput(text: string): SkillEvidenceAssignment[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return [];
  }
  const items = Array.isArray(raw["skills"]) ? (raw["skills"] as Record<string, unknown>[]) : [];
  const out: SkillEvidenceAssignment[] = [];
  for (const item of items) {
    const key = str(item["canonicalKey"]);
    if (!key) continue;
    const confidence = str(item["placementConfidence"]) as SkillPlacementConfidence | null;
    const source = str(item["placementSource"]) as SkillPlacementSource | null;
    out.push({
      canonicalKey: key,
      evidenceRoleLocalIds: strList(item["evidenceRoleLocalIds"]),
      evidenceResultLocalIds: strList(item["evidenceResultLocalIds"]),
      placementConfidence: confidence && CONFIDENCES.includes(confidence) ? confidence : "none",
      placementSource: source && SOURCES.includes(source) ? source : "none",
      placementReason: str(item["placementReason"]) ?? "",
      conflicts: strList(item["conflicts"]),
    });
  }
  return out;
}

export async function runSkillEvidenceStep(args: {
  profile: ModelProfile;
  anthropicApiKey: string;
  correlationId: string;
  timeoutMs: number;
  request: SkillEvidenceRequest;
}): Promise<SkillEvidenceStepResult> {
  if (args.request.skills.length === 0) {
    return {
      ok: true,
      errorCode: null,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      assignments: [],
    };
  }
  const call = await callClaude({
    profile: args.profile,
    system: `${SKILL_EVIDENCE_SYSTEM_PROMPT_NO}\n\n${SKILL_EVIDENCE_OUTPUT_CONTRACT_NO}`,
    messages: [{ role: "user", content: buildSkillEvidenceUserPrompt(args.request) }],
    correlationId: `${args.correlationId}:skillev`,
    timeoutMs: args.timeoutMs,
    maxRetries: 1,
    runtime: { apiKey: args.anthropicApiKey },
  });

  if (!call.ok) {
    return {
      ok: false,
      errorCode: call.errorCode ?? call.outcome,
      durationMs: call.durationMs,
      inputTokens: 0,
      outputTokens: 0,
      assignments: [],
    };
  }
  const assignments = parseSkillEvidenceOutput(call.text);
  return {
    ok: true,
    errorCode: null,
    durationMs: call.durationMs,
    inputTokens: call.usage.inputTokens ?? 0,
    outputTokens: call.usage.outputTokens ?? 0,
    assignments,
  };
}

// ---------------------------------------------------------------------------
// Deterministisk anvendelse — serveren hydrerer og håndhever reglene
// ---------------------------------------------------------------------------

export type SkillWithEvidence = ConsolidatedSkill & {
  skillPlacementConfidence: SkillPlacementConfidence;
  skillPlacementSource: SkillPlacementSource;
  skillPlacementReason: string;
  evidenceConflicts: string[];
};

function emptyCounts<T extends string>(keys: T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
}

export function applySkillEvidence(args: {
  skills: ConsolidatedSkill[];
  assignments: SkillEvidenceAssignment[];
  roles: RoleAtomProposal[];
  achievements: AchievementProposal[];
}): { skills: SkillWithEvidence[]; report: SkillEvidenceReport } {
  const roleById = new Map(args.roles.map((r) => [r.localId, r] as const));
  const achById = new Map(args.achievements.map((a) => [a.localId, a] as const));
  const byKey = new Map(args.assignments.map((a) => [a.canonicalKey, a] as const));

  const report: SkillEvidenceReport = {
    version: SKILL_EVIDENCE_PHASE_VERSION,
    promptVersion: SKILL_EVIDENCE_PROMPT_VERSION,
    considered: 0,
    linked: 0,
    byConfidence: emptyCounts(CONFIDENCES),
    bySource: emptyCounts(SOURCES),
    droppedReferences: [],
    downgraded: [],
  };

  const skills = args.skills.map((skill): SkillWithEvidence => {
    const base: SkillWithEvidence = {
      ...skill,
      skillPlacementConfidence: "none",
      skillPlacementSource: "none",
      skillPlacementReason: "",
      evidenceConflicts: [],
    };
    // Lokale signaler er ikke gjennomgåbare kompetansekort og berøres ikke.
    if (skill.tier !== "reviewable") return base;
    report.considered += 1;

    const assignment = byKey.get(skill.canonicalKey);
    if (!assignment) {
      report.byConfidence.none += 1;
      report.bySource.none += 1;
      return base;
    }

    const roleIds: string[] = [];
    for (const id of assignment.evidenceRoleLocalIds) {
      if (roleById.has(id)) roleIds.push(id);
      else report.droppedReferences.push({ canonical_key: skill.canonicalKey, local_id: id });
    }
    const resultIds: string[] = [];
    for (const id of assignment.evidenceResultLocalIds) {
      if (achById.has(id)) resultIds.push(id);
      else report.droppedReferences.push({ canonical_key: skill.canonicalKey, local_id: id });
    }

    let confidence = assignment.placementConfidence;
    let source = assignment.placementSource;

    // Ingen konkret rolle eller resultat: koblingen kan ikke stå.
    if (roleIds.length === 0 && resultIds.length === 0) {
      if (confidence !== "none") {
        report.downgraded.push({
          canonical_key: skill.canonicalKey,
          reason: "ingen konkret rolle eller resultat å peke på",
        });
      }
      confidence = "none";
      source = "none";
    } else {
      if (confidence === "none") confidence = "low";
      if (source === "none") source = "semantic_evidence_match";
    }

    // Referanser hydreres fra frosset input via rollens/resultatets eget belegg.
    const refs: SkillEvidenceRef[] = [];
    const seen = new Set<string>();
    for (const id of resultIds) {
      const achievement = achById.get(id)!;
      const fingerprint = `a:${id}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      refs.push({
        roleLocalId: achievement.roleLocalId ?? null,
        achievementLocalId: id,
        sourceEvidence: achievement.sourceEvidence as SourceEvidence[],
      });
    }
    for (const id of roleIds) {
      const role = roleById.get(id)!;
      const fingerprint = `r:${id}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      refs.push({
        roleLocalId: id,
        achievementLocalId: null,
        sourceEvidence: role.sourceEvidence as SourceEvidence[],
      });
    }

    // Kompetansens egne kildespenn beholdes som provenance, aldri som kobling.
    const ownSpans = skill.evidence.filter((e) => !e.roleLocalId && !e.achievementLocalId);

    report.byConfidence[confidence] += 1;
    report.bySource[source] += 1;
    if (refs.length > 0) report.linked += 1;

    return {
      ...base,
      evidence: refs.length > 0 ? [...refs, ...ownSpans] : skill.evidence,
      roleCount: new Set(refs.map((r) => r.roleLocalId).filter(Boolean)).size,
      achievementCount: new Set(refs.map((r) => r.achievementLocalId).filter(Boolean)).size,
      skillPlacementConfidence: confidence,
      skillPlacementSource: source,
      skillPlacementReason:
        assignment.placementReason ||
        (confidence === "none" ? "Ingen rolle eller resultat i CV-en belegger kompetansen." : ""),
      evidenceConflicts: assignment.conflicts,
    };
  });

  return { skills, report };
}
