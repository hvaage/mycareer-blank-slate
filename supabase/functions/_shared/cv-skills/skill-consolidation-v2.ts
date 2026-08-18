// cv-atom-language-no v2.1.0 — global kompetansekonsolidering.
//
// Formålet er kalibrering, ikke reduksjon for reduksjonens skyld. Evidensen
// kastes aldri: en kompetanse som ikke kvalifiserer til gjennomgang beholdes
// som lokalt evidenssignal på rollen/resultatet den kom fra.
//
// Fasen er deterministisk og bruker bare korte labels, rolle-id-er og
// evidens-id-er. Ingen CV-tekst sendes til modellen på nytt.

import type {
  CvAtomizationInput,
  SkillProposal,
} from "./vendor/cv-atom-language-no/v2/types.ts";
import { canonicalSkillKey } from "./atom-proposal-pipeline-v2.ts";

export type SkillTier = "reviewable" | "local_signal";

export type ConsolidatedSkill = SkillProposal & {
  /** Gjennomgåbart Trinn 3-forslag, eller lokalt belegg på rolle/resultat. */
  tier: SkillTier;
  tierReasons: string[];
  roleCount: number;
  achievementCount: number;
  explicit: boolean;
};

export type SkillConsolidationReport = {
  before: number;
  after: number;
  reviewable: number;
  localSignals: number;
  /** canonicalKey-er som ble slått sammen av kontrollert synonymnormalisering. */
  synonymMerges: { key: string; labels: string[] }[];
  reasons: Record<string, number>;
  reviewableLabels: string[];
};

/**
 * Kontrollert synonymnormalisering. Bevisst kort og konservativ: bare varianter
 * som betyr det samme på norsk arbeidslivsspråk. Ulike kompetanser slås aldri
 * sammen bare for å redusere antall.
 */
const SYNONYMS: Record<string, string> = {
  personalledelse: "ledelse-av-medarbeidere",
  "ledelse-av-medarbeidere": "ledelse-av-medarbeidere",
  "people-management": "ledelse-av-medarbeidere",
  linjeledelse: "ledelse-av-medarbeidere",
  teamledelse: "teamledelse",
  "team-lead": "teamledelse",
  "leder-team": "teamledelse",
  prosjektledelse: "prosjektledelse",
  "project-management": "prosjektledelse",
  prosjektstyring: "prosjektledelse",
  salg: "salg",
  "salgsarbeid": "salg",
  "b2b-salg": "salg",
  kundeoppfolging: "kunderelasjoner",
  kunderelasjoner: "kunderelasjoner",
  "kundehandtering": "kunderelasjoner",
  "teknisk-arkitektur": "losningsarkitektur",
  losningsarkitektur: "losningsarkitektur",
  systemarkitektur: "losningsarkitektur",
  forretningsutvikling: "forretningsutvikling",
  "business-development": "forretningsutvikling",
  endringsledelse: "endringsledelse",
  "change-management": "endringsledelse",
  budsjettansvar: "budsjett-og-okonomistyring",
  okonomistyring: "budsjett-og-okonomistyring",
  "budsjett-og-okonomistyring": "budsjett-og-okonomistyring",
  rekruttering: "rekruttering",
  ansettelse: "rekruttering",
  radgivning: "radgivning",
  konsulentarbeid: "radgivning",
  "strategisk-planlegging": "strategi",
  strategi: "strategi",
  strategiarbeid: "strategi",
};

/**
 * Generelle, selvstendige kompetanser som er reelt gjenbrukbare på tvers av
 * roller. Brukes bare som ett av flere kvalifiseringskriterier, og aldri uten
 * kildebelegg.
 */
const GENERIC_REVIEWABLE = new Set<string>([
  "ledelse-av-medarbeidere",
  "teamledelse",
  "prosjektledelse",
  "salg",
  "kunderelasjoner",
  "losningsarkitektur",
  "forretningsutvikling",
  "endringsledelse",
  "budsjett-og-okonomistyring",
  "rekruttering",
  "radgivning",
  "strategi",
]);

export function consolidatedSkillKey(skill: SkillProposal): string {
  const base = skill.canonicalKey || canonicalSkillKey(skill.canonicalLabelNo);
  return SYNONYMS[base] ?? base;
}

function countReasons(skills: ConsolidatedSkill[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const skill of skills) {
    for (const reason of skill.tierReasons) out[reason] = (out[reason] ?? 0) + 1;
  }
  return out;
}

/**
 * Slår sammen synonymer og klassifiserer hver kompetanse som gjennomgåbar
 * eller lokalt evidenssignal.
 *
 * Modellregel: bredde er ikke opptaksterskel. En kompetanse er gjennomgåbar
 * når den er eksplisitt oppgitt i CV-en, eller når den har konkret belegg i
 * minst én rolle eller ett resultat. Bredde (én rolle, ett resultat, flere
 * roller) rapporteres som informasjon, ikke som filter.
 *
 * Lokalt evidenssignal er forbeholdt utledede kompetanser uten konkret
 * rolle- eller resultatbelegg.
 */

export function consolidateSkills(
  skills: SkillProposal[],
  input: CvAtomizationInput,
): { skills: ConsolidatedSkill[]; report: SkillConsolidationReport } {
  const explicitSpanIds = new Set(
    input.sourceSpans.filter((s) => s.sectionHint === "skills").map((s) => s.id),
  );

  const byKey = new Map<string, SkillProposal>();
  const labelsByKey = new Map<string, Set<string>>();
  const synonymMerges: { key: string; labels: string[] }[] = [];

  for (const skill of skills) {
    const key = consolidatedSkillKey(skill);
    labelsByKey.set(key, (labelsByKey.get(key) ?? new Set()).add(skill.canonicalLabelNo));
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...skill, canonicalKey: key, evidence: [...skill.evidence] });
      continue;
    }
    const seen = new Set(
      existing.evidence.map((e) =>
        JSON.stringify([
          e.roleLocalId ?? null,
          e.achievementLocalId ?? null,
          e.sourceEvidence.map((x) => x.sourceSpanId).sort(),
        ]),
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

  for (const [key, labels] of labelsByKey) {
    if (labels.size > 1) synonymMerges.push({ key, labels: [...labels] });
  }

  const consolidated: ConsolidatedSkill[] = [...byKey.values()].map((skill) => {
    const roleIds = new Set(
      skill.evidence.map((e) => e.roleLocalId).filter((id): id is string => Boolean(id)),
    );
    const achievementIds = new Set(
      skill.evidence.map((e) => e.achievementLocalId).filter((id): id is string => Boolean(id)),
    );
    const spanIds = skill.evidence.flatMap((e) => e.sourceEvidence.map((x) => x.sourceSpanId));
    const explicit = spanIds.some((id) => explicitSpanIds.has(id));
    const hasEvidence = spanIds.length > 0;

    const reasons: string[] = [];
    if (explicit) reasons.push("oppgitt_som_kompetanse");
    if (achievementIds.size >= 2) reasons.push("belegg_fra_flere_resultater");
    if (roleIds.size >= 2) reasons.push("belegg_fra_flere_roller");
    if (achievementIds.size === 1) reasons.push("belegg_fra_ett_resultat");
    if (roleIds.size === 1) reasons.push("belegg_fra_en_rolle");
    if (hasEvidence && GENERIC_REVIEWABLE.has(skill.canonicalKey)) {
      reasons.push("generell_kompetanse_med_belegg");
    }

    const hasConcreteEvidence = roleIds.size > 0 || achievementIds.size > 0;
    const breadth: SkillBreadth =
      roleIds.size >= 2
        ? "multiple_roles"
        : roleIds.size === 1
          ? "single_role"
          : achievementIds.size >= 1
            ? "single_result"
            : "none";

    // Bredde skjuler aldri en kompetanse: eksplisitt oppgitt eller konkret
    // belagt er nok for gjennomgang i Trinn 3.
    const tier: SkillTier =
      (explicit && hasEvidence) || hasConcreteEvidence ? "reviewable" : "local_signal";
    if (tier === "local_signal") {
      reasons.push(hasEvidence ? "lokalt_signal" : "mangler_kildebelegg");
    }

    return {
      ...skill,
      tier,
      tierReasons: reasons,
      roleCount: roleIds.size,
      achievementCount: achievementIds.size,
      breadth,
      explicit,
    };

  });

  const reviewable = consolidated.filter((s) => s.tier === "reviewable");
  return {
    skills: consolidated,
    report: {
      before: skills.length,
      after: consolidated.length,
      reviewable: reviewable.length,
      localSignals: consolidated.length - reviewable.length,
      synonymMerges,
      reasons: countReasons(consolidated),
      reviewableLabels: reviewable.map((s) => s.canonicalLabelNo).slice(0, 40),
    },
  };
}
