// cv-evidence-graph — Converter: gammel CV (PDF eller DOCX) → parsekandidater
// Skjema-versjon: 4.0
//
// Tar parset JSON fra Claude (parse-uploaded-cv) og produserer CandidateDraft-er
// klare for skriving til cv_parse_candidates. Hierarkiet mellom rolle og
// achievement bæres av local_ref/parent_local_ref, ikke av en atomgraf.

import type {
  CandidateDraft,
  RoleStructuredData,
  AchievementStructuredData,
  EducationStructuredData,
  SkillStructuredData,
  LanguageStructuredData,
  CertificationStructuredData,
  ProjectStructuredData,
  ToolStructuredData,
  VolunteerStructuredData,
  SummaryFragmentStructuredData,
  SourceType,
} from "../types.ts";
import { lookupNameSuggestion } from "../name-lexicon.ts";
import { suggestAtomTypeFromCategory } from "../types.ts";

// ---------------------------------------------------------------------------
// Input — utvidet form av basistypen for å matche skjemaet parse-uploaded-cv
// produserer (se supabase/functions/parse-uploaded-cv/schema.ts).
// ---------------------------------------------------------------------------

export interface ParsedOldCvContact {
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  location?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
}

export interface ParsedOldCvExperience {
  company: string;
  title: string;
  location?: string | null;
  start?: string | null;
  end?: string | null;
  is_current?: boolean;
  description?: string | null;
  bullets?: string[];
  role_summary?: string | null;
  employer_note?: string | null;
}

export interface ParsedOldCvEducation {
  institution: string;
  degree: string;
  field?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  thesis?: string | null;
  honors?: string | null;
}

export interface ParsedOldCvLanguage {
  name: string;
  level?: string | null;
}

export interface ParsedOldCvCertification {
  name: string;
  issuer: string;
  issued?: string | null;
  expires?: string | null;
}

export interface ParsedOldCvProject {
  name: string;
  description: string;
  url?: string | null;
  technologies?: string[];
}

export interface ParsedOldCvVolunteer {
  organization: string;
  role: string;
  start?: string | null;
  end?: string | null;
  description?: string | null;
}

export interface ParsedOldCv {
  language_detected?: "no" | "en";
  name?: string | null;
  headline?: string | null;
  summary?: string | null;
  contact?: ParsedOldCvContact | null;
  experience?: ParsedOldCvExperience[];
  education?: ParsedOldCvEducation[];
  skills?: string[];
  languages?: ParsedOldCvLanguage[];
  certifications?: ParsedOldCvCertification[];
  projects?: ParsedOldCvProject[];
  volunteer?: ParsedOldCvVolunteer[];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface ConvertOldCvResult {
  /** Flat liste. Hierarkiet ligger i parent_local_ref. */
  candidates: CandidateDraft[];
  skipped: { reason: string; context: string }[];
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

const YEAR_MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function nonEmpty(s: string | null | undefined): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

function normalizeYearMonth(s: string | null | undefined): string | null {
  if (!nonEmpty(s)) return null;
  const trimmed = s.trim();
  if (YEAR_MONTH_RE.test(trimmed)) return trimmed;
  // Tolerer "YYYY" → "YYYY-01"
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01`;
  // Tolerer "YYYY-M" → "YYYY-0M"
  const m = trimmed.match(/^(\d{4})-(\d)$/);
  if (m) return `${m[1]}-0${m[2]}`;
  return null;
}

function langLevel(
  raw: string | null | undefined,
): LanguageStructuredData["level"] {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return "professional";
  if (/(native|morsmål|morsmal)/.test(s)) return "native";
  if (/(fluent|flytende|c2)/.test(s)) return "fluent";
  if (/(professional|profesjonell|c1|advanced|avansert)/.test(s)) return "professional";
  if (/(conversational|samtale|b1|b2|intermediate)/.test(s)) return "conversational";
  if (/(basic|grunnleggende|a1|a2|beginner|begynner)/.test(s)) return "basic";
  return "professional";
}

// ---------------------------------------------------------------------------
// Heuristikker for å skille selskaps-kontekst fra personlige bullets
// ---------------------------------------------------------------------------

const COMPANY_EVENT_PATTERNS = [
  /\bmerged\s+with\b/i,
  /\bmerger\s+with\b/i,
  /\bacquired\s+by\b/i,
  /\bacquisition\s+of\b/i,
  /\bspun\s+off\b/i,
  /\bsubsidiary\s+of\b/i,
  /\brenamed\s+to\b/i,
  /\bformerly\s+known\s+as\b/i,
  /\bpart\s+of\s+the\s+\w+\s+group\b/i,
  /\bslått\s+sammen\s+med\b/i,
  /\bfusjonerte?\s+med\b/i,
  /\bkjøpt\s+opp\s+av\b/i,
  /\boppkjøpt\s+av\b/i,
  /\btidligere\s+kjent\s+som\b/i,
  /\bskiftet\s+navn\s+til\b/i,
  /\bdatterselskap\s+av\b/i,
];

const PERSONAL_ACTION_PATTERNS = [
  /\b(i|we|my)\b/i,
  /\b(jeg|vi|min|mitt|mine)\b/i,
  /\b(led|built|delivered|designed|launched|managed|created|developed|implemented|drove|owned|shipped|grew|reduced|increased|improved|migrated|architected|coached|mentored)\b/i,
  /\b(ledet|bygde|leverte|designet|lanserte|forvaltet|skapte|utviklet|implementerte|drev|eide|sendte|vokste|reduserte|økte|forbedret|migrerte|coachet|veiledet|hadde\s+ansvar)\b/i,
];

/** True hvis teksten ser ut som en selskapshendelse (M&A/navnebytte/eierskap) og IKKE en personlig handling. */
function looksLikeCompanyEvent(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.length === 0 || t.length > 160) return false;
  const matchesEvent = COMPANY_EVENT_PATTERNS.some((re) => re.test(t));
  if (!matchesEvent) return false;
  const hasPersonalAction = PERSONAL_ACTION_PATTERNS.some((re) => re.test(t));
  return !hasPersonalAction;
}

/** Normalisering brukt for å sjekke om to tekster er "samme" (ignorer punktum/whitespace/case). */
function normalizeForCompare(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[.,;:!?"'`()\[\]{}\-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isDuplicateOfAny(candidate: string, others: string[]): boolean {
  const c = normalizeForCompare(candidate);
  if (!c) return false;
  return others.some((o) => normalizeForCompare(o) === c);
}

export function convertOldCv(
  parsed: ParsedOldCv,
  context: {
    user_id: string;
    import_id: string;
    source_format: "pdf" | "docx";
  },
): ConvertOldCvResult {
  const sourceType: SourceType =
    context.source_format === "pdf" ? "old_cv_pdf" : "old_cv_docx";

  const baseFields = {
    source_type: sourceType,
    source_ref: context.import_id,
    parent_local_ref: null,
    suggested_from_category: null,
    dedupe_key: null,
    parse_confidence: 0.9,
  };

  const candidates: CandidateDraft[] = [];
  const skipped: { reason: string; context: string }[] = [];
  let seq = 0;
  const ref = (prefix: string) => `${prefix}-${seq++}`;

  // -----------------------------------------------------------------------
  // Summary fragments — headline + summary
  // -----------------------------------------------------------------------
  if (nonEmpty(parsed.headline) && parsed.headline.trim().length >= 10) {
    const sd: SummaryFragmentStructuredData = {
      fragment_type: "value_proposition",
      weight: 9,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("summary"),
      suggested_atom_type: "summary_fragment",
      content_no: parsed.headline.trim(),
      content_en: null,
      structured_data: sd,
      source_quote: parsed.headline.trim(),
    });
  }

  if (nonEmpty(parsed.summary) && parsed.summary.trim().length >= 30) {
    const sd: SummaryFragmentStructuredData = {
      fragment_type: "experience_summary",
      weight: 7,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("summary"),
      suggested_atom_type: "summary_fragment",
      content_no: parsed.summary.trim(),
      content_en: null,
      structured_data: sd,
      source_quote: parsed.summary.trim(),
    });
  }

  // -----------------------------------------------------------------------
  // Education
  // -----------------------------------------------------------------------
  for (const e of parsed.education ?? []) {
    if (!nonEmpty(e?.institution) || !nonEmpty(e?.degree)) {
      skipped.push({
        reason: "education mangler institution eller degree",
        context: JSON.stringify(e).slice(0, 200),
      });
      continue;
    }
    const startYearMissing = typeof e.start_year !== "number";
    const sd: EducationStructuredData = {
      institution: e.institution.trim(),
      institution_normalized: e.institution.toLowerCase().trim(),
      degree: e.degree.trim(),
      field: nonEmpty(e.field) ? e.field.trim() : null,
      start_year: typeof e.start_year === "number" ? e.start_year : 0,
      end_year: typeof e.end_year === "number" ? e.end_year : null,
      thesis_title: nonEmpty(e.thesis) ? e.thesis.trim() : null,
      honors: nonEmpty(e.honors) ? e.honors.trim() : null,
      grade: null,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("education"),
      suggested_atom_type: "education",
      content_no: `${sd.degree}${sd.field ? `, ${sd.field}` : ""}`,
      content_en: null,
      structured_data: sd,
      source_quote: null,
      parse_confidence: startYearMissing ? 0.6 : 0.9,
    });
  }

  // -----------------------------------------------------------------------
  // Skills
  // -----------------------------------------------------------------------
  for (const skillName of parsed.skills ?? []) {
    if (!nonEmpty(skillName)) continue;
    const name = skillName.trim();
    // Fritekst-CV gir ingen sikker kategori. "other" betyr eksplisitt ukjent
    // akse. Navneleksikonet kan likevel gi et trygt forhåndsvalg for de mest
    // kjente navnene — forslaget bæres av suggested_atom_type, valget av
    // resolved_atom_type i gjennomgangen.
    const known = lookupNameSuggestion(name);
    const skillCategory = known?.category ?? ("other" as const);

    if (known?.atom_type === "tool") {
      candidates.push({
        ...baseFields,
        local_ref: ref("skill"),
        suggested_atom_type: "tool",
        suggested_from_category: skillCategory,
        content_no: known.canonical,
        content_en: known.canonical,
        structured_data: {
          name: known.canonical,
          tool_kind: "other",
          proficiency: null,
          years_used: null,
          suggested_from_name_lexicon: true,
        } as ToolStructuredData,
        source_quote: null,
        parse_confidence: known.parse_confidence,
      });
      continue;
    }

    if (known?.atom_type === "language") {
      candidates.push({
        ...baseFields,
        local_ref: ref("skill"),
        suggested_atom_type: "language",
        suggested_from_category: skillCategory,
        content_no: known.canonical,
        content_en: known.canonical,
        structured_data: {
          language: known.canonical,
          level: null,
          cefr: null,
          suggested_from_name_lexicon: true,
        } as LanguageStructuredData,
        source_quote: null,
        parse_confidence: known.parse_confidence,
      });
      continue;
    }

    const sd: SkillStructuredData = {
      name,
      name_normalized: name.toLowerCase(),
      source_category: skillCategory,
      proficiency: null,
      years_used: null,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("skill"),
      suggested_atom_type: suggestAtomTypeFromCategory(skillCategory) ?? "skill",
      suggested_from_category: skillCategory,
      content_no: name,
      content_en: name,
      structured_data: sd,
      source_quote: null,
    });
  }


  // -----------------------------------------------------------------------
  // Languages
  // -----------------------------------------------------------------------
  for (const lang of parsed.languages ?? []) {
    if (!nonEmpty(lang?.name)) continue;
    const sd: LanguageStructuredData = {
      language: lang.name.trim(),
      level: langLevel(lang.level),
      cefr: null,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("language"),
      suggested_atom_type: "language",
      content_no: lang.name.trim(),
      content_en: lang.name.trim(),
      structured_data: sd,
      source_quote: null,
    });
  }

  // -----------------------------------------------------------------------
  // Certifications
  // -----------------------------------------------------------------------
  for (const c of parsed.certifications ?? []) {
    if (!nonEmpty(c?.name) || !nonEmpty(c?.issuer)) {
      skipped.push({
        reason: "certification mangler name eller issuer",
        context: JSON.stringify(c).slice(0, 200),
      });
      continue;
    }
    const sd: CertificationStructuredData = {
      name: c.name.trim(),
      issuer: c.issuer.trim(),
      issued_date: normalizeYearMonth(c.issued),
      expires_date: normalizeYearMonth(c.expires),
      credential_id: null,
      credential_url: null,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("certification"),
      suggested_atom_type: "certification",
      content_no: `${sd.name} (${sd.issuer})`,
      content_en: null,
      structured_data: sd,
      source_quote: null,
    });
  }

  // -----------------------------------------------------------------------
  // Projects
  // -----------------------------------------------------------------------
  for (const p of parsed.projects ?? []) {
    if (!nonEmpty(p?.name) || !nonEmpty(p?.description)) {
      skipped.push({
        reason: "project mangler name eller description",
        context: JSON.stringify(p).slice(0, 200),
      });
      continue;
    }
    const sd: ProjectStructuredData = {
      name: p.name.trim(),
      description: p.description.trim(),
      role_in_project: null,
      start_date: null,
      end_date: null,
      url: nonEmpty(p.url) ? p.url.trim() : null,
      technologies: Array.isArray(p.technologies)
        ? p.technologies.filter(nonEmpty).map((t) => t.trim())
        : [],
      outcomes: [],
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("project"),
      suggested_atom_type: "project",
      content_no: sd.description,
      content_en: null,
      structured_data: sd,
      source_quote: null,
    });
  }

  // -----------------------------------------------------------------------
  // Volunteer
  // -----------------------------------------------------------------------
  for (const v of parsed.volunteer ?? []) {
    if (!nonEmpty(v?.organization) || !nonEmpty(v?.role)) {
      skipped.push({
        reason: "volunteer mangler organization eller role",
        context: JSON.stringify(v).slice(0, 200),
      });
      continue;
    }
    const startDate = normalizeYearMonth(v.start);
    if (!startDate) {
      skipped.push({
        reason: "volunteer mangler gyldig start_date",
        context: `${v.organization} / ${v.role}`,
      });
      continue;
    }
    const sd: VolunteerStructuredData = {
      organization: v.organization.trim(),
      role: v.role.trim(),
      start_date: startDate,
      end_date: normalizeYearMonth(v.end),
      cause: null,
    };
    candidates.push({
      ...baseFields,
      local_ref: ref("volunteer"),
      suggested_atom_type: "volunteer",
      content_no: nonEmpty(v.description)
        ? v.description.trim()
        : `${sd.role} hos ${sd.organization}`,
      content_en: null,
      structured_data: sd,
      source_quote: null,
    });
  }

  // -----------------------------------------------------------------------
  // Experience → role-trees
  // -----------------------------------------------------------------------
  for (const exp of parsed.experience ?? []) {
    if (!nonEmpty(exp?.company) || !nonEmpty(exp?.title)) {
      skipped.push({
        reason: "experience mangler company eller title",
        context: JSON.stringify(exp).slice(0, 200),
      });
      continue;
    }

    // C.4 — filtrer hele rader hvor title ser ut som en selskapshendelse og bullets er tomme
    const bulletsArr = Array.isArray(exp.bullets) ? exp.bullets.filter(nonEmpty) : [];
    if (
      looksLikeCompanyEvent(exp.title) &&
      bulletsArr.length === 0 &&
      !nonEmpty(exp.role_summary) &&
      !nonEmpty(exp.description)
    ) {
      skipped.push({
        reason: "experience-rad så ut som ren selskapshendelse — droppet",
        context: `${exp.company} / ${exp.title}`,
      });
      continue;
    }

    const normalizedStart = normalizeYearMonth(exp.start);
    const startMissing = normalizedStart == null;
    const startDate = normalizedStart ?? "1900-01";
    const endDate = normalizeYearMonth(exp.end);
    const isCurrent =
      typeof exp.is_current === "boolean" ? exp.is_current : endDate == null;

    // C.3 — filtrer bullets som ser ut som selskaps-kontekst
    const realBullets: string[] = [];
    const employerNotesFromBullets: string[] = [];
    for (const b of bulletsArr) {
      const t = b.trim();
      if (looksLikeCompanyEvent(t)) {
        employerNotesFromBullets.push(t);
        skipped.push({
          reason: "bullet så ut som selskaps-kontekst — flyttet til employer_description",
          context: t.slice(0, 200),
        });
      } else {
        realBullets.push(t);
      }
    }

    // C.1 — bygg employer_description fra employer_note + filtrerte bullets
    const employerDescParts: string[] = [];
    if (nonEmpty(exp.employer_note)) employerDescParts.push(exp.employer_note.trim());
    for (const n of employerNotesFromBullets) employerDescParts.push(n);
    const employerDescription = employerDescParts.length > 0
      ? employerDescParts.join("; ")
      : null;

    const roleSd: RoleStructuredData = {
      employer: exp.company.trim(),
      employer_normalized: exp.company.toLowerCase().trim(),
      title: exp.title.trim(),
      start_date: startDate,
      end_date: isCurrent ? null : endDate,
      location: nonEmpty(exp.location) ? exp.location.trim() : null,
      employment_type: null,
      industry: null,
      employer_size: null,
      employer_description: employerDescription,
      is_current: isCurrent,
      direct_reports: null,
    };

    // C.2 — velg content_no smartere: role_summary > description > fallback.
    // Avvis kandidater som (a) duplikerer en bullet, eller (b) selv er en selskaps-frase.
    const fallbackContent = `${roleSd.title} hos ${roleSd.employer}`;
    const acceptable = (s: string) =>
      !isDuplicateOfAny(s, realBullets) && !looksLikeCompanyEvent(s);
    let roleContent: string = fallbackContent;
    if (nonEmpty(exp.role_summary) && acceptable(exp.role_summary)) {
      roleContent = exp.role_summary.trim();
    } else if (nonEmpty(exp.description) && acceptable(exp.description)) {
      roleContent = exp.description.trim();
    }
    // Hvis description var en selskaps-frase, flytt den til employer_description (én gang)
    if (
      nonEmpty(exp.description) &&
      looksLikeCompanyEvent(exp.description) &&
      !(employerDescription ?? "").includes(exp.description.trim())
    ) {
      const merged = [employerDescription, exp.description.trim()]
        .filter(Boolean)
        .join("; ");
      roleSd.employer_description = merged;
      skipped.push({
        reason: "description så ut som selskaps-kontekst — flyttet til employer_description",
        context: exp.description.trim().slice(0, 200),
      });
    }

    const roleRef = ref("role");
    const role: CandidateDraft = {
      ...baseFields,
      local_ref: roleRef,
      suggested_atom_type: "role",
      content_no: roleContent,
      content_en: null,
      structured_data: roleSd,
      source_quote: null,
      parse_confidence: startMissing ? 0.6 : 0.9,
    };
    candidates.push(role);

    let achSeq = 0;
    for (const text of realBullets) {
      const sd: AchievementStructuredData = {
        what: text,
        how_measured: null,
        how_done: null,
        challenge: null,
        action: null,
        result: null,
        category: null,
        scope_team_size: null,
        scope_budget_text: null,
        date_period: null,
        is_team_achievement: false,
      };
      candidates.push({
        ...baseFields,
        local_ref: `${roleRef}-ach-${achSeq++}`,
        parent_local_ref: roleRef,
        suggested_atom_type: "achievement",
        content_no: text,
        content_en: null,
        structured_data: sd,
        source_quote: text,
      });
    }
  }

  return {
    candidates,
    skipped,
  };
}
