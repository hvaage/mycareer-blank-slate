// Types and lightweight validator for parsed CV output from the AI parse step.

export interface ParsedContact {
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  linkedin_url: string | null;
  website_url: string | null;
}

export interface ParsedExperience {
  company: string;
  title: string;
  location: string | null;
  start: string | null;
  end: string | null;
  is_current: boolean;
  /** @deprecated bruk role_summary. Beholdt for bakoverkompat. */
  description: string | null;
  bullets: string[];
  /** Kort beskrivelse (1–2 setninger) av rollen — IKKE en bullet-gjentakelse. */
  role_summary?: string | null;
  /** Kontekst om selskapet (oppkjøp, fusjon, størrelse, bransje). IKKE personlige prestasjoner. */
  employer_note?: string | null;
}

export interface ParsedEducation {
  institution: string;
  degree: string;
  field: string | null;
  start_year: number | null;
  end_year: number | null;
  thesis: string | null;
  honors: string | null;
}

export interface ParsedLanguage {
  name: string;
  level: string | null;
}

export interface ParsedCertification {
  name: string;
  issuer: string;
  issued: string | null;
  expires: string | null;
}

export interface ParsedProject {
  name: string;
  description: string;
  url: string | null;
  technologies: string[];
}

export interface ParsedVolunteer {
  organization: string;
  role: string;
  start: string | null;
  end: string | null;
  description: string | null;
}

export interface ParsedTool {
  name: string;
  category: string | null;
  context: string | null;
}

export interface ParsedCv {
  language_detected: "no" | "en";
  name: string | null;
  headline: string | null;
  summary: string | null;
  contact: ParsedContact | null;
  experience: ParsedExperience[];
  education: ParsedEducation[];
  skills: string[];
  /** Navngitte verktøy, systemer og programvare. Valgfritt av bakoverkompatibilitet. */
  tools?: ParsedTool[];
  languages: ParsedLanguage[];
  certifications: ParsedCertification[];
  projects: ParsedProject[];
  volunteer: ParsedVolunteer[];
}

/**
 * Lightweight validator. Throws Error with descriptive message on failure.
 * Detailed per-field validation is deferred to the review step (Sprint 4).
 */
export function validateParsedCv(raw: unknown): ParsedCv {
  if (!raw || typeof raw !== "object") {
    throw new Error("Output er ikke et objekt");
  }
  const obj = raw as Record<string, unknown>;

  const lang = obj.language_detected;
  if (lang !== "no" && lang !== "en") {
    throw new Error(`language_detected må være "no" eller "en", fikk: ${String(lang)}`);
  }

  for (const key of [
    "experience",
    "education",
    "skills",
    "languages",
    "certifications",
    "projects",
    "volunteer",
  ]) {
    if (!Array.isArray(obj[key])) {
      throw new Error(`${key} må være et array`);
    }
  }

  return obj as unknown as ParsedCv;
}
