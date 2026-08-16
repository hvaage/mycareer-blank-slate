// cv-evidence-graph — Converter: profiles-felter → atoms
// Brukes for å seede evidens-grafen fra eksisterende profile-data
// (about-me-felter, LinkedIn OAuth-headline, onboarding-svar).

import type {
  AtomInsert,
  RoleStructuredData,
  SkillStructuredData,
  LanguageStructuredData,
  SummaryFragmentStructuredData,
} from "../types.ts";
import {
  createRoleAtom,
  createSkillAtom,
  createLanguageAtom,
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

export interface ProfileToAtomsResult {
  atoms: AtomInsert[];
  notes: string[];
}

/**
 * Konverter profiles-felter til atoms.
 *
 * VIKTIG begrensning: profiles-data alene er IKKE nok til en god CV.
 * Det mangler arbeidshistorikk og utdanning. Resultatet markeres derfor som
 * `imported`-confidence og må kombineres med en CV-import (LinkedIn ZIP/PDF
 * eller gammel CV) eller intervju-flyt før master-CV genereres.
 *
 * Det vi får ut:
 * - Én role-atom for nåværende stilling (hvis current_employer + current_role_title finnes)
 * - Skill-atoms fra skills[]
 * - Language-atoms fra languages[]
 * - Summary fragments fra bio + headline
 *
 * Det vi IKKE får (må komme fra annen kilde):
 * - Tidligere roller
 * - Achievements per rolle (achievements-feltet er én lang fritekst, ikke strukturert)
 * - Utdanning
 * - Sertifiseringer
 * - Strukturerte måltall
 */
export function profileToAtoms(profile: ProfileFields): ProfileToAtomsResult {
  const atoms: AtomInsert[] = [];
  const notes: string[] = [];
  const userId = profile.id;

  // 1. Nåværende rolle
  if (profile.current_employer && profile.current_role_title) {
    atoms.push(
      currentRoleToAtom(profile, userId),
    );
    notes.push(
      "Opprettet 1 role-atom for nåværende stilling. Tidligere stillinger må importeres separat.",
    );
  } else {
    notes.push(
      "Ingen nåværende stilling i profilen — hopper over role-atom.",
    );
  }

  // 2. Skills
  if (profile.skills && profile.skills.length > 0) {
    for (const name of profile.skills) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      atoms.push(skillToAtom(trimmed, userId));
    }
    notes.push(
      `Opprettet ${profile.skills.length} skill-atoms fra profile.skills[].`,
    );
  }

  // 3. Languages
  if (profile.languages && profile.languages.length > 0) {
    for (const langString of profile.languages) {
      const lang = parseLanguageString(langString);
      if (lang) {
        atoms.push(
          createLanguageAtom({
            user_id: userId,
            source_type: "about_me_profile",
            structured_data: lang,
            content_no: lang.language,
            content_en: lang.language,
            confidence: "imported",
            user_confirmed: false,
          }),
        );
      }
    }
    notes.push(
      `Opprettet ${profile.languages.length} language-atoms fra profile.languages[].`,
    );
  }

  // 4. Bio som summary fragment
  if (profile.bio && profile.bio.trim().length > 30) {
    atoms.push(bioToSummaryFragment(profile.bio.trim(), userId));
    notes.push("Opprettet 1 summary_fragment-atom fra profile.bio.");
  }

  // 5. Headline / linkedin_headline
  const headline = profile.headline ?? profile.linkedin_headline;
  if (headline && headline.trim().length > 0) {
    atoms.push(headlineToSummaryFragment(headline.trim(), userId));
    notes.push("Opprettet 1 summary_fragment-atom fra headline.");
  }

  // 6. Generell advarsel
  notes.push(
    "MERK: Disse atoms gir ikke nok data til full CV. Brukeren må importere LinkedIn-data eller gammel CV, eller fullføre intervju, før master-CV kan genereres.",
  );

  return { atoms, notes };
}

// ---------------------------------------------------------------------------
// Per-felt-konvertering
// ---------------------------------------------------------------------------

function currentRoleToAtom(profile: ProfileFields, userId: string): AtomInsert {
  const data: RoleStructuredData = {
    employer: profile.current_employer!,
    title: profile.current_role_title!,
    start_date: estimateStartDate(profile.years_experience),
    end_date: null,
    location: null,
    employment_type: "fulltime",
    industry: null,
    employer_size: null,
    employer_description: null,
    is_current: true,
  };

  return createRoleAtom({
    user_id: userId,
    source_type: "about_me_profile",
    structured_data: data,
    content_no: profile.current_role_title!,
    content_en: profile.current_role_title!,
    confidence: "imported",
    user_confirmed: false,
    source_quote: profile.bio ?? undefined,
  });
}

function skillToAtom(name: string, userId: string): AtomInsert {
  const data: SkillStructuredData = {
    name,
    name_normalized: name.toLowerCase().trim(),
    category: inferSkillCategory(name),
    proficiency: null,
    years_used: null,
    evidence_atom_ids: [],
  };

  return createSkillAtom({
    user_id: userId,
    source_type: "about_me_profile",
    structured_data: data,
    content_no: name,
    content_en: name,
    confidence: "imported",
    user_confirmed: false,
  });
}

function bioToSummaryFragment(bio: string, userId: string): AtomInsert {
  const data: SummaryFragmentStructuredData = {
    fragment_type: "experience_summary",
    weight: 8,
  };

  return {
    atom_type: "summary_fragment",
    user_id: userId,
    parent_atom_id: null,
    content_no: bio,
    content_en: null, // krever oversettelse
    structured_data: data,
    source_type: "about_me_profile",
    source_ref: null,
    source_quote: bio,
    confidence: "imported",
    user_confirmed: false,
  };
}

function headlineToSummaryFragment(headline: string, userId: string): AtomInsert {
  const data: SummaryFragmentStructuredData = {
    fragment_type: "value_proposition",
    weight: 9,
  };

  return {
    atom_type: "summary_fragment",
    user_id: userId,
    parent_atom_id: null,
    content_no: headline,
    content_en: headline,
    structured_data: data,
    source_type: "about_me_profile",
    source_ref: null,
    source_quote: headline,
    confidence: "imported",
    user_confirmed: false,
  };
}

// ---------------------------------------------------------------------------
// Hjelpefunksjoner
// ---------------------------------------------------------------------------

/**
 * Estimer startdato for nåværende stilling basert på years_experience.
 * Ikke perfekt — antar at all years_experience er i nåværende rolle hvis
 * vi ikke har bedre data. Markerer som inferred.
 */
function estimateStartDate(yearsExperience: number | null): string {
  const now = new Date();
  // Konservativ default: 1 år tilbake. Brukeren må selv korrigere.
  const yearsBack = 1;
  const startYear = now.getFullYear() - yearsBack;
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
 * Grov kategorisering av skill basert på navn.
 * Brukerens valg overstyrer dette — funksjonen er bare for å gi en startverdi.
 */
function inferSkillCategory(name: string): SkillStructuredData["category"] {
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
