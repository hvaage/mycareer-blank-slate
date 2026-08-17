// Regnskap for kildeinnhold som ikke ender som rolleplassert resultat.
//
// Prinsipp: ingen kildeinformasjon forsvinner stille. Hvert kildespenn som
// pre-parseren mente kunne være et resultat får en eksplisitt klassifisering,
// en begrunnelse og et sted brukeren eller intern gjennomgang finner det igjen.
//
// Rent deterministisk: ingen database, ingen nettverk, ingen modellkall.

import type { PreparserCandidate } from "./role-block-preparser.ts";
import type {
  CvAtomizationInput,
  CvAtomizationOutput,
} from "./vendor/cv-atom-language-no/v2/types.ts";

export const RESULT_LEDGER_VERSION = "1.0.0";

/** Kandidattyper pre-parseren regner som mulige resultater. */
const RESULT_CANDIDATE_TYPES = new Set(["achievement", "metric", "project", "result"]);

export type ResultDisposition =
  | "role_placed_result"
  | "unassigned_result"
  | "needs_review_result"
  | "local_signal"
  | "skill_evidence"
  | "profile_summary"
  | "qualification"
  | "role_description"
  | "dropped_no_verbatim_source"
  | "unclassified";

export type ResultLedgerEntry = {
  sourceSpanId: string;
  excerpt: string;
  previousClassification: string;
  newClassification: ResultDisposition;
  placementConfidence: string | null;
  placementSource: string | null;
  reason: string;
  visibleIn: string;
};

export type ResultLedger = {
  version: string;
  /** Antall kildespenn pre-parseren klassifiserte som mulig resultat. */
  resultCandidateSpans: number;
  /** Antall resultatforslag som faktisk står igjen etter kvalitetsportene. */
  achievementProposals: number;
  distribution: {
    rolePlaced: number;
    high: number;
    low: number;
    needsReview: number;
    unassigned: number;
    nonResult: number;
  };
  /** Kun spenn som ikke endte som rolleplassert resultat. */
  nonResultEntries: ResultLedgerEntry[];
};

const DISPOSITION_TEXT: Record<
  ResultDisposition,
  { reason: string; visibleIn: string }
> = {
  role_placed_result: {
    reason: "Resultatet har strukturelt belegg i rolleblokken.",
    visibleIn: "Trinn 2: Resultater per rolle",
  },
  unassigned_result: {
    reason:
      "Innholdet er et resultat, men kilden viser ingen strukturell tilhørighet til en rolle. Tekstlikhet alene teller ikke som plassering.",
    visibleIn: "Trinn 2: gruppen «Resultater uten kjent rolle»",
  },
  needs_review_result: {
    reason: "Innholdet er tvetydig og må avklares av deg før det kan brukes.",
    visibleIn: "Trinn 2: markert «Må avklares»",
  },
  local_signal: {
    reason:
      "Linjen gir et lokalt kompetansesignal, ikke et selvstendig resultat. Signalet er beholdt som belegg for en kompetanse.",
    visibleIn: "Trinn 3: kompetansebelegg (ikke egen gjennomgangsoppgave)",
  },
  skill_evidence: {
    reason: "Linjen er brukt som belegg for en kompetanse, ikke som eget resultat.",
    visibleIn: "Trinn 3: Kompetanser",
  },
  profile_summary: {
    reason:
      "Linjen er profil- eller sammendragstekst. Den beskriver personen generelt og er ikke et rolleplassert resultat.",
    visibleIn: "Grunnlagsoversikten: profiltekst fra importen",
  },
  qualification: {
    reason: "Linjen ble klassifisert som kvalifikasjon, ikke som resultat.",
    visibleIn: "Trinn 4: Kvalifikasjoner og språk",
  },
  role_description: {
    reason: "Linjen beskriver selve rollen eller ansettelsen, ikke et enkeltresultat.",
    visibleIn: "Trinn 1: Karrieretidslinjen",
  },
  dropped_no_verbatim_source: {
    reason:
      "Forslaget manglet ordrett belegg i kildeteksten og ble forkastet. Kilden ligger uendret i importen.",
    visibleIn: "Intern gjennomgang: forkastede forslag i analysens logg",
  },
  unclassified: {
    reason:
      "Ingen del av analysen tok linjen i bruk. Den er markert for intern gjennomgang slik at den ikke forsvinner stille.",
    visibleIn: "Intern gjennomgang: uklassifisert kildeinnhold",
  },
};

function excerptOf(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 237)}…` : clean;
}

export function buildResultLedger(args: {
  input: CvAtomizationInput;
  output: CvAtomizationOutput;
  candidates: PreparserCandidate[];
  /** local_id-er som ble forkastet i forslagsbyggingen. */
  droppedLocalIds: string[];
}): ResultLedger {
  const { input, output } = args;
  const spanById = new Map(input.sourceSpans.map((s) => [s.id, s]));
  const candidateByRef = new Map(args.candidates.map((c) => [c.local_ref, c]));
  const dropped = new Set(args.droppedLocalIds);

  const spanUse = new Map<
    string,
    {
      achievement?: (typeof output.achievements)[number];
      skillTier?: "reviewable" | "local_signal";
      qualification?: boolean;
      role?: boolean;
    }
  >();
  const touch = (id: string) => {
    const existing = spanUse.get(id) ?? {};
    spanUse.set(id, existing);
    return existing;
  };

  for (const role of output.roles) {
    for (const e of role.sourceEvidence) touch(e.sourceSpanId).role = true;
  }
  for (const a of output.achievements) {
    for (const e of a.sourceEvidence) {
      const use = touch(e.sourceSpanId);
      if (!use.achievement) use.achievement = a;
    }
  }
  for (const s of output.skills) {
    const tier =
      ((s as { tier?: "reviewable" | "local_signal" }).tier ?? "reviewable") === "local_signal"
        ? "local_signal"
        : "reviewable";
    for (const ev of s.evidence) {
      for (const e of ev.sourceEvidence) {
        const use = touch(e.sourceSpanId);
        if (use.skillTier !== "reviewable") use.skillTier = tier;
      }
    }
  }
  for (const q of output.qualifications) {
    for (const e of q.sourceEvidence) touch(e.sourceSpanId).qualification = true;
  }

  const entries: ResultLedgerEntry[] = [];
  let resultCandidateSpans = 0;
  const accountedAchievementSpans = new Set<string>();

  // 1) Hvert resultatforslag som ikke ble et rolleplassert resultat får en
  //    egen linje, uansett hvilket kildespenn det kom fra.
  for (const achievement of output.achievements) {
    const spanIds = (achievement.sourceEvidence ?? [])
      .map((e) => e.sourceSpanId)
      .filter((id): id is string => Boolean(id));
    for (const id of spanIds) accountedAchievementSpans.add(id);
    const primarySpanId = spanIds[0] ?? null;
    const candidate = primarySpanId
      ? candidateByRef.get(spanById.get(primarySpanId)?.localRef ?? primarySpanId)
      : undefined;

    let disposition: ResultDisposition;
    if (dropped.has(achievement.localId)) {
      disposition = "dropped_no_verbatim_source";
    } else if (achievement.status === "proposed" && achievement.roleLocalId) {
      continue; // teller fortsatt som resultat
    } else if (achievement.status === "unassigned" || !achievement.roleLocalId) {
      disposition = "unassigned_result";
    } else {
      disposition = "needs_review_result";
    }

    const t = DISPOSITION_TEXT[disposition];
    entries.push({
      sourceSpanId: primarySpanId ?? achievement.localId,
      excerpt: excerptOf(
        (primarySpanId ? spanById.get(primarySpanId)?.text : "") ||
          achievement.normalizedText || "",
      ),

      previousClassification: candidate?.suggested_atom_type ?? "achievement",
      newClassification: disposition,
      placementConfidence: achievement.placementConfidence ?? null,
      placementSource: achievement.placementSource ?? null,
      reason: t.reason,
      visibleIn: t.visibleIn,
    });
  }

  // 2) Kildespenn som kunne vært resultater, men som ingen resultatforslag brukte.
  for (const span of input.sourceSpans) {
    const candidate = candidateByRef.get(span.localRef ?? span.id);
    const previous = candidate?.suggested_atom_type ?? span.sectionHint ?? "ukjent";
    const isResultCandidate = RESULT_CANDIDATE_TYPES.has(previous);
    if (isResultCandidate) resultCandidateSpans += 1;
    if (accountedAchievementSpans.has(span.id)) continue;

    const use = spanUse.get(span.id) ?? {};
    const achievement = use.achievement;


    let disposition: ResultDisposition;
    if (achievement && dropped.has(achievement.localId)) {
      disposition = "dropped_no_verbatim_source";
    } else if (achievement && achievement.status === "proposed" && achievement.roleLocalId) {
      disposition = "role_placed_result";
    } else if (achievement && achievement.status === "unassigned") {
      disposition = "unassigned_result";
    } else if (achievement) {
      disposition = "needs_review_result";
    } else if (use.qualification) {
      disposition = "qualification";
    } else if (use.skillTier === "local_signal") {
      disposition = "local_signal";
    } else if (use.skillTier === "reviewable") {
      disposition = "skill_evidence";
    } else if (span.sectionHint === "summary" || previous === "summary_fragment") {
      disposition = "profile_summary";
    } else if (use.role) {
      disposition = "role_description";
    } else {
      disposition = "unclassified";
    }

    if (disposition === "role_placed_result") continue;
    // Kun spenn som kunne vært resultater, eller som ingen del av analysen brukte.
    if (!isResultCandidate && disposition !== "unclassified") continue;

    const text = DISPOSITION_TEXT[disposition];
    entries.push({
      sourceSpanId: span.id,
      excerpt: excerptOf(spanById.get(span.id)?.text ?? ""),
      previousClassification: previous,
      newClassification: disposition,
      placementConfidence: achievement?.placementConfidence ?? null,
      placementSource: achievement?.placementSource ?? null,
      reason: text.reason,
      visibleIn: text.visibleIn,
    });
  }

  const achievements = output.achievements.filter((a) => !dropped.has(a.localId));
  return {
    version: RESULT_LEDGER_VERSION,
    resultCandidateSpans,
    achievementProposals: achievements.length,
    distribution: {
      high: achievements.filter((a) => a.placementConfidence === "high").length,
      low: achievements.filter((a) => a.placementConfidence === "low").length,
      needsReview: achievements.filter((a) => a.status === "needs_review").length,
      unassigned: achievements.filter((a) => a.status === "unassigned").length,
      nonResult: entries.filter(
        (e) =>
          e.newClassification !== "unassigned_result" &&
          e.newClassification !== "needs_review_result",
      ).length,
    },
    nonResultEntries: entries,
  };
}
