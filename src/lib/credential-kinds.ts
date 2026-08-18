/**
 * Kvalifikasjoner som kan dokumenteres: språk, førerkort, sertifiseringer,
 * vitnemål og verktøy.
 *
 * Disse er ikke «erfaringer» i samme forstand som roller og resultater. De er
 * konkrete forhold som normalt kan dokumenteres med en fil (vitnemål,
 * sertifikat, språktest) — eller graderes (språknivå, førerkortklasse).
 * Klassifiseringen her er deterministisk og skal skje automatisk, slik at
 * brukeren bare bekrefter eller korrigerer.
 */

export type CredentialKind =
  | "sprak"
  | "forerkort"
  | "sertifisering"
  | "vitnemal"
  | "verktoy";

export const CREDENTIAL_KIND_ORDER: CredentialKind[] = [
  "sprak",
  "forerkort",
  "sertifisering",
  "vitnemal",
  "verktoy",
];

export const CREDENTIAL_KIND_LABEL: Record<CredentialKind, string> = {
  sprak: "Språk",
  forerkort: "Førerkort",
  sertifisering: "Sertifiseringer",
  vitnemal: "Vitnemål",
  verktoy: "Verktøy",
};

export const CREDENTIAL_KIND_SINGULAR: Record<CredentialKind, string> = {
  sprak: "Språk",
  forerkort: "Førerkort",
  sertifisering: "Sertifisering",
  vitnemal: "Vitnemål",
  verktoy: "Verktøy",
};

/** Seksjons-id-er brukt i den horisontale menyen på Erfaring og kompetanse. */
export const CREDENTIAL_SECTION_ID: Record<CredentialKind, string> = {
  sprak: "sek-sprak",
  forerkort: "sek-forerkort",
  sertifisering: "sek-sertifiseringer",
  vitnemal: "sek-vitnemal",
  verktoy: "sek-verktoy",
};

/** Kan normalt dokumenteres med en fil. Verktøy kan det sjelden. */
export const CREDENTIAL_DOCUMENTABLE: Record<CredentialKind, boolean> = {
  sprak: true,
  forerkort: true,
  sertifisering: true,
  vitnemal: true,
  verktoy: false,
};

export const CREDENTIAL_DOC_HINT: Record<CredentialKind, string> = {
  sprak: "Språktest eller vitnemål som viser nivået.",
  forerkort: "Bilde eller skann av førerkortet.",
  sertifisering: "Sertifikat eller kursbevis.",
  vitnemal: "Vitnemål eller karakterutskrift.",
  verktoy: "Normalt ingen dokumentasjon — det belegges av bruk i en rolle.",
};

/** Atomtypen kvalifikasjonen lagres som i `career_atoms`. */
export const CREDENTIAL_ATOM_TYPE: Record<CredentialKind, string> = {
  sprak: "language",
  forerkort: "certification",
  sertifisering: "certification",
  vitnemal: "education",
  verktoy: "tool",
};

// ---------------------------------------------------------------------------
// Språknivå
// ---------------------------------------------------------------------------

export type LanguageLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2" | "morsmal";

export const LANGUAGE_LEVELS: { value: LanguageLevel; label: string }[] = [
  { value: "A1", label: "A1 — Noen ord og faste uttrykk" },
  { value: "A2", label: "A2 — Enkle samtaler om kjente tema" },
  { value: "B1", label: "B1 — Klarer meg i de fleste dagligsituasjoner" },
  { value: "B2", label: "B2 — Arbeidsspråk, også faglige samtaler" },
  { value: "C1", label: "C1 — Flytende, også komplekse tema" },
  { value: "C2", label: "C2 — Tilnærmet som morsmål" },
  { value: "morsmal", label: "Morsmål" },
];

export const LANGUAGE_LEVEL_SHORT: Record<LanguageLevel, string> = {
  A1: "A1 — nybegynner",
  A2: "A2 — enkel",
  B1: "B1 — dagligtale",
  B2: "B2 — arbeidsspråk",
  C1: "C1 — flytende",
  C2: "C2 — tilnærmet morsmål",
  morsmal: "Morsmål",
};

/** Leser et nivå ut av fritekst når CV-en oppgir det. Ellers null. */
export function inferLanguageLevel(text: string | null | undefined): LanguageLevel | null {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  if (/\bmorsm[åa]l|native\b/.test(t)) return "morsmal";
  const cefr = t.match(/\b(a1|a2|b1|b2|c1|c2)\b/);
  if (cefr) return cefr[1].toUpperCase() as LanguageLevel;
  if (/flytende|fluent/.test(t)) return "C1";
  if (/forretningsniv|arbeidsspr|profesjonell|business/.test(t)) return "B2";
  if (/god(t)? (muntlig|skriftlig|kjennskap)|middels/.test(t)) return "B1";
  if (/grunnleggende|basic|noe kjennskap|begrenset/.test(t)) return "A2";
  return null;
}

/** Renser bort nivåbeskrivelsen fra navnet, slik at «Engelsk (flytende)» blir «Engelsk». */
export function languageNameFromText(text: string | null | undefined): string {
  const raw = (text ?? "").trim();
  if (!raw) return "";
  return (
    raw
      .replace(/^spr[åa]k\s*[:–-]\s*/i, "")
      .replace(/\s*[（(\[][^)\]）]*[)\]）]\s*$/, "")
      .replace(/\s*[:–-]\s*(morsm[åa]l|flytende|fluent|native|god(t)?[^,]*|grunnleggende[^,]*|[abc][12])\s*$/i, "")
      .trim() || raw
  );
}

// ---------------------------------------------------------------------------
// Førerkort
// ---------------------------------------------------------------------------

export const DRIVING_LICENSE_CLASSES: { value: string; label: string }[] = [
  { value: "AM", label: "AM — moped" },
  { value: "A1", label: "A1 — lett motorsykkel" },
  { value: "A2", label: "A2 — mellomtung motorsykkel" },
  { value: "A", label: "A — tung motorsykkel" },
  { value: "B", label: "B — personbil" },
  { value: "BE", label: "BE — personbil med tilhenger" },
  { value: "C1", label: "C1 — lett lastebil" },
  { value: "C", label: "C — lastebil" },
  { value: "CE", label: "CE — vogntog" },
  { value: "D1", label: "D1 — minibuss" },
  { value: "D", label: "D — buss" },
  { value: "T", label: "T — traktor" },
];

export function inferLicenseClasses(text: string | null | undefined): string[] {
  const t = (text ?? "").toUpperCase();
  if (!t) return [];
  const found = new Set<string>();
  for (const { value } of DRIVING_LICENSE_CLASSES) {
    const re = new RegExp(`(?:KLASSE|KL\\.?|KL|,|\\s|^)${value}(?![A-Z0-9])`);
    if (re.test(t)) found.add(value);
  }
  // «Førerkort» uten klasse betyr i praksis klasse B i norsk kontekst,
  // men vi gjetter ikke — brukeren velger selv.
  return [...found];
}

// ---------------------------------------------------------------------------
// Klassifisering
// ---------------------------------------------------------------------------

const LANGUAGE_WORDS =
  /\b(norsk|bokm[åa]l|nynorsk|engelsk|svensk|dansk|finsk|tysk|fransk|spansk|italiensk|portugisisk|nederlandsk|russisk|polsk|litauisk|arabisk|persisk|tyrkisk|urdu|hindi|kinesisk|mandarin|japansk|koreansk|somali|tigrinja|ukrainsk)\b/i;

const LICENSE_WORDS =
  /(f[øo]rerkort|driving licen|driver'?s licen|sertifikat for personbil|yrkessj[åa]f[øo]r)/i;

const CERT_WORDS =
  /(sertifi|certified|certificate|kursbevis|autorisasj|godkjenning|akkredit|ccna|ccnp|ccie|prince2|pmp|itil|scrum master|safe|iso ?\d|hms-kurs|truckf[øo]rer)/i;

const DIPLOMA_WORDS =
  /(vitnem[åa]l|karakterutskrift|bachelor|master|siviløkonom|sivilingeni[øo]r|ingeni[øo]r|cand\.?|ph\.?d|doktorgrad|universitet|h[øo]gskole|videreg[åa]ende|fagbrev|studium|studier|utdanning)/i;

export type ClassifiableItem = {
  atomType?: string | null;
  text?: string | null;
  structured?: Record<string, unknown> | null;
};

/**
 * Deterministisk klassifisering. Eksplisitt lagret art vinner alltid over
 * gjetting, slik at brukerens korreksjon aldri overstyres av heuristikk.
 */
export function classifyCredential(item: ClassifiableItem): CredentialKind | null {
  const stored = item.structured?.["credential_kind"];
  if (typeof stored === "string" && CREDENTIAL_KIND_ORDER.includes(stored as CredentialKind)) {
    return stored as CredentialKind;
  }

  const text = (item.text ?? "").trim();
  const type = (item.atomType ?? "").trim();

  // Førerkort først: det kommer ofte inn som «sertifisering» eller «verktøy».
  if (LICENSE_WORDS.test(text)) return "forerkort";
  if (type === "language") return "sprak";
  if (LANGUAGE_WORDS.test(text) && (type === "" || type === "skill" || type === "certification")) {
    if (inferLanguageLevel(text) || /spr[åa]k/i.test(text)) return "sprak";
  }
  if (type === "certification") return "sertifisering";
  if (type === "education") return "vitnemal";
  if (type === "tool") return "verktoy";
  if (CERT_WORDS.test(text)) return "sertifisering";
  if (DIPLOMA_WORDS.test(text)) return "vitnemal";
  return null;
}

/** Vist tittel: språk uten nivåtekst, ellers teksten som den er. */
export function credentialTitle(kind: CredentialKind | null, text: string): string {
  return kind === "sprak" ? languageNameFromText(text) : text.trim();
}

export type CredentialDocument = {
  document_id?: string | null;
  path: string;
  name: string;
  uploaded_at: string;
};

/** Opplastet dokumentasjon slik den ligger på atomet. */
export function credentialDocuments(structured: unknown): CredentialDocument[] {
  if (!structured || typeof structured !== "object" || Array.isArray(structured)) return [];
  const raw = (structured as Record<string, unknown>)["dokumentasjon"];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is CredentialDocument =>
      !!d && typeof d === "object" && typeof (d as CredentialDocument).path === "string",
  );
}
