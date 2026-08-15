// cv-evidence-graph — Converter: profiles-felter → parsekandidater
// Skjema-versjon: 4.0
//
// Brukes for å seede gjennomgangen fra eksisterende profildata
// (about-me-felter, LinkedIn OAuth-headline, onboarding-svar).
// Resultatet er kandidater, ikke evidens: ingenting herfra er belagt før
// brukeren har bekreftet det.

import type {
  CandidateDraft,
  RoleStructuredData,
  SkillStructuredData,
  LanguageStructuredData,
  SummaryFragmentStructuredData,
  ParserSkillCategory,
} from "../types.ts";
import {
  createRoleDraft,
  createSkillDraft,
  createToolDraft,
  createLanguageDraft,
  createSummaryFragmentDraft,
  suggestAtomTypeFromCategory,
} from "../types.ts";

// ---------------------------------------------------------------------------
// Profile-skjema vi forventer (subset av profiles-tabellen)
// ---------------------------------------------------------------------------

export interface ProfileFields {
  id: string;
  full_name: string | null;
  display_name: string | null;
  headline: string | null;
  bio: string | null;

  current_employer: string | null;
  current_role_title: string | null;

  achievements: string | null;
  motivation: string | null;
  strengths: string | null;
  weaknesses: string | null;

  languages: string[] | null;
  skills: string[] | null;
  industries: string[] | null;

  linkedin_headline: string | null;
  years_experience: number | null;
}

// ---------------------------------------------------------------------------
// Top-level conversion
// ---------------------------------------------------------------------------

export interface ProfileToCandidatesResult {
  candidates: CandidateDraft[];
  notes: string[];
}

/**
 * Konverter profiles-felter til parsekandidater.
 *
 * VIKTIG begrensning: profildata alene er IKKE nok til en god CV.
 * Det mangler arbeidshistorikk og utdanning. Kandidatene må kombineres med en
 * CV-import (LinkedIn ZIP/PDF eller gammel CV) eller intervjuflyt.
 *
 * Det vi får ut:
 * - Én rolle-kandidat for nåværende stilling (hvis begge feltene finnes)
 * - Kompetanse-kandidater fra skills[]
 * - Språk-kandidater fra languages[]
 * - Summary fragments fra bio + headline
 *
 * Det vi IKKE får (må komme fra annen kilde):
 * - Tidligere roller, achievements per rolle, utdanning, sertifiseringer, måltall
 */
export function profileToCandidates(
  profile: ProfileFields,
): ProfileToCandidatesResult {
  const candidates: CandidateDraft[] = [];
  const notes: string[] = [];
  let seq = 0;
  const ref = (prefix: string) => `${prefix}-${seq++}`;

  // 1. Nåværende rolle
  if (profile.current_employer && profile.current_role_title) {
    const data: RoleStructuredData = {
      employer: profile.current_employer,
      employer_normalized: profile.current_employer.toLowerCase().trim(),
      title: profile.current_role_title,
      start_date: estimateStartDate(),
      end_date: null,
      location: null,
      employment_type: "fulltime",
      industry: null,
      employer_size: null,
      employer_description: null,
      is_current: true,
      direct_reports: null,
    };
    candidates.push(
      createRoleDraft({
        local_ref: ref("role"),
        source_type: "about_me_profile",
        structured_data: data,
        content_no: profile.current_role_title,
        content_en: profile.current_role_title,
        source_quote: profile.bio ?? null,
        // Startdatoen er gjettet — det skal synes.
        parse_confidence: 0.4,
      }),
    );
    notes.push(
      "Opprettet 1 rolle-kandidat for nåværende stilling. Startdato er estimert og må bekreftes. Tidligere stillinger må importeres separat.",
    );
  } else {
    notes.push("Ingen nåværende stilling i profilen — hopper over rolle-kandidat.");
  }

  // 2. Skills — kategorien avgjør hvilken kandidattype forslaget får.
  if (profile.skills && profile.skills.length > 0) {
    let added = 0;
    let unresolved = 0;
    for (const name of profile.skills) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const category = inferSkillCategory(trimmed);
      const suggested = suggestAtomTypeFromCategory(category);
      const base = {
        local_ref: ref("skill"),
        source_type: "about_me_profile" as const,
        content_no: trimmed,
        content_en: trimmed,
        suggested_from_category: category,
        parse_confidence: suggested === null ? 0.3 : 0.6,
      };

      if (suggested === "tool") {
        candidates.push(
          createToolDraft({
            ...base,
            structured_data: {
              name: trimmed,
              tool_kind: "other",
              proficiency: null,
              years_used: null,
            },
          }),
        );
      } else {
        // Både `skill` og uavklart (`other`) bæres som kompetanse-kandidat.
        // Uavklarte blir et spørsmål til brukeren i gjennomgangen.
        const data: SkillStructuredData = {
          name: trimmed,
          name_normalized: trimmed.toLowerCase(),
          source_category: category,
          proficiency: null,
          years_used: null,
        };
        candidates.push(createSkillDraft({ ...base, structured_data: data }));
        if (suggested === null) unresolved++;
      }
      added++;
    }
    notes.push(
      `Opprettet ${added} kompetanse-kandidater fra profile.skills[]` +
        (unresolved > 0
          ? `, hvorav ${unresolved} uten typeforslag — brukeren må avklare disse.`
          : "."),
    );
  }

  // 3. Languages
  if (profile.languages && profile.languages.length > 0) {
    let added = 0;
    for (const langString of profile.languages) {
      const lang = parseLanguageString(langString);
      if (!lang) continue;
      candidates.push(
        createLanguageDraft({
          local_ref: ref("language"),
          source_type: "about_me_profile",
          structured_data: lang,
          content_no: lang.language,
          content_en: lang.language,
          suggested_from_category: "language",
          parse_confidence: 0.7,
        }),
      );
      added++;
    }
    notes.push(`Opprettet ${added} språk-kandidater fra profile.languages[].`);
  }

  // 4. Bio som summary fragment
  if (profile.bio && profile.bio.trim().length > 30) {
    const bio = profile.bio.trim();
    const data: SummaryFragmentStructuredData = {
      fragment_type: "experience_summary",
      weight: 8,
    };
    candidates.push(
      createSummaryFragmentDraft({
        local_ref: ref("summary"),
        source_type: "about_me_profile",
        structured_data: data,
        content_no: bio,
        content_en: null,
        source_quote: bio,
        parse_confidence: 0.8,
      }),
    );
    notes.push("Opprettet 1 summary_fragment-kandidat fra profile.bio.");
  }

  // 5. Headline / linkedin_headline
  const headline = (profile.headline ?? profile.linkedin_headline)?.trim();
  if (headline) {
    const data: SummaryFragmentStructuredData = {
      fragment_type: "value_proposition",
      weight: 9,
    };
    candidates.push(
      createSummaryFragmentDraft({
        local_ref: ref("summary"),
        source_type: "about_me_profile",
        structured_data: data,
        content_no: headline,
        content_en: headline,
        source_quote: headline,
        parse_confidence: 0.8,
      }),
    );
    notes.push("Opprettet 1 summary_fragment-kandidat fra headline.");
  }

  // 6. Generell advarsel
  notes.push(
    "MERK: Disse kandidatene gir ikke nok data til full CV, og de er ikke evidens før brukeren har bekreftet dem i gjennomgangen.",
  );

  return { candidates, notes };
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner
// ---------------------------------------------------------------------------

/**
 * Estimer startdato for nåværende stilling. Konservativ default: 1 år tilbake.
 * Brukeren må selv korrigere — derfor lav parse_confidence på rolle-kandidaten.
 */
function estimateStartDate(): string {
  const now = new Date();
  const startYear = now.getFullYear() - 1;
  return `${startYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Forsøk å parse en språk-streng. Støtter formater som:
 * "Norwegian", "Norsk (native)", "English (fluent)", "Tysk - Conversational"
 */
function parseLanguageString(s: string): LanguageStructuredData | null {
  const cleaned = s.trim();
  if (cleaned.length === 0) return null;

  const match = cleaned.match(/^([^(\-]+?)\s*[\(\-]\s*(\w+)/i);
  let language: string;
  let levelRaw: string;

  if (match) {
    language = match[1].trim();
    levelRaw = match[2].trim().toLowerCase();
  } else {
    language = cleaned;
    levelRaw = "professional"; // default
  }

  const levelMap: Record<string, LanguageStructuredData["level"]> = {
    native: "native",
    morsmål: "native",
    fluent: "fluent",
    flytende: "fluent",
    professional: "professional",
    profesjonell: "professional",
    arbeid: "professional",
    conversational: "conversational",
    samtale: "conversational",
    basic: "basic",
    grunnleggende: "basic",
  };

  return {
    language,
    level: levelMap[levelRaw] ?? "professional",
    cefr: null,
  };
}

/**
 * Grov kategorisering av kompetanse basert på navn.
 * Dette er kun et FORSLAGSGRUNNLAG. Brukerens valg overstyrer, og
 * korrigeringsraten per kategori er det som avgjør om kartet skal endres.
 */
export function inferSkillCategory(name: string): ParserSkillCategory {
  const lower = name.toLowerCase();

  const technical = [
    "python", "javascript", "typescript", "react", "sql", "aws", "azure",
    "docker", "kubernetes", "git", "linux", "node", "java", "c#", "c++",
    "html", "css", "api", "rest", "graphql",
  ];
  if (technical.some((t) => lower.includes(t))) return "technical";

  const leadership = [
    "ledelse", "leadership", "team building", "p&l", "strategi", "strategy",
    "change management", "executive", "ceo", "coo", "cco", "cro", "cto",
  ];
  if (leadership.some((t) => lower.includes(t))) return "leadership";

  const methodology = [
    "meddpicc", "agile", "scrum", "kanban", "lean", "six sigma", "okr",
    "spin", "challenger", "lifecycle selling",
  ];
  if (methodology.some((t) => lower.includes(t))) return "methodology";

  const tool = [
    "salesforce", "hubspot", "jira", "slack", "notion", "asana",
    "linkedin", "powerpoint", "excel", "word",
  ];
  if (tool.some((t) => lower.includes(t))) return "tool";

  return "other";
}
