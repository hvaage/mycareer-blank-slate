// @ts-nocheck
/**
 * Module 4 — deterministic preference/evidence atom generation from existing user data.
 * Pure helpers + plan builder; no DB I/O, no AI.
 */

import type { Tables } from "@/integrations/supabase/types";

export const ATOM_REFRESH_SOURCES = [
  "career_profile",
  "profile",
  "document",
  "cv_import",
  "linkedin",
  "user_rating",
] as const;
export type AtomRefreshSource = (typeof ATOM_REFRESH_SOURCES)[number];

export function isSystemRefreshSource(source: string | null | undefined): source is AtomRefreshSource {
  return !!source && (ATOM_REFRESH_SOURCES as readonly string[]).includes(source);
}

export type UserCareerProfileRow = Tables<"user_career_profiles">;
export type UserProfileRow = Tables<"profiles">;
export type DocumentRow = Pick<Tables<"documents">, "id" | "title" | "document_type" | "deleted_at">;
export type CvImportRow = Pick<Tables<"cv_imports">, "id" | "status" | "source_filename">;
export type UserCompanyRatingRow = Pick<Tables<"user_company_ratings">, "id" | "overall_score" | "user_notes">;

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Deterministic short hash for idempotency (FNV-1a 32-bit). */
export function stableAtomHash(parts: string[]): string {
  const s = parts.map((p) => norm(p)).join("|");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export type PlannedPreferenceAtom = {
  logicalKey: string;
  source_hash: string;
  dimension: string;
  label: string;
  value: string | null;
  importance_score: number | null;
  confidence_score: number | null;
  source: AtomRefreshSource;
  source_field: string;
  reasoning: string;
  career_profile_id: string | null;
  existingId?: string;
};

export type PlannedEvidenceAtom = {
  logicalKey: string;
  source_hash: string;
  category: string;
  label: string;
  description: string | null;
  strength_score: number | null;
  confidence_score: number | null;
  source: AtomRefreshSource;
  source_field: string;
  source_document_id: string | null;
  source_profile_field: string | null;
  evidence_type: string | null;
  reasoning: string;
  existingId?: string;
};

export type AtomDeactivateTarget = {
  kind: "preference" | "evidence";
  id: string;
  reason: string;
};

export type UserAtomRefreshPlan = {
  preferenceAtomsToUpsert: PlannedPreferenceAtom[];
  evidenceAtomsToUpsert: PlannedEvidenceAtom[];
  systemAtomsToDeactivate: AtomDeactivateTarget[];
  warnings: string[];
  summary: string;
};

/**
 * Karriereontologi v4 — logisk nøkkel.
 * Første ledd er alltid `atom_kind`, slik at ulike kinds aldri kolliderer.
 * Et ønske og en evidens om samme emne er derfor ikke duplikat.
 */
export const CAREER_ATOM_LOGICAL_KEY_PREFIX = "v4";

/** Ønske/verdi/begrensning: dimensjon + etikett. Kilden inngår ikke. */
function prefKey(
  _source: string,
  _sourceField: string,
  dimension: string,
  label: string,
  _value: string | null,
): string {
  return `${CAREER_ATOM_LOGICAL_KEY_PREFIX}|onske|${norm(dimension)}|${norm(label)}`;
}

/**
 * Evidens: type + påstandens innhold. `source_ref` inngår IKKE — samme CV lastet
 * opp to ganger med ulikt filnavn skal ikke gi to atomer. To ulike dokumenter som
 * hevder nøyaktig det samme er også én påstand; belegget ligger i evidence_atom_ids.
 */
function evKey(_source: string, _sourceField: string, category: string, label: string): string {
  return `${CAREER_ATOM_LOGICAL_KEY_PREFIX}|evidens|${norm(category)}|${norm(label)}`;
}

type CareerAtomKeyInput = {
  atom_kind: string;
  atom_type?: string | null;
  content_no?: string | null;
  structured_data?: unknown;
  target_requirement_id?: string | null;
};

function structuredField(structured: unknown, key: string): string | null {
  if (structured == null || typeof structured !== "object" || Array.isArray(structured)) return null;
  const v = (structured as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/** Én nøkkelstrategi for alle seks kinds. */
export function careerAtomLogicalKey(atom: CareerAtomKeyInput): string {
  const p = CAREER_ATOM_LOGICAL_KEY_PREFIX;
  const kind = norm(atom.atom_kind);
  const content = norm(atom.content_no);
  switch (kind) {
    case "onske":
    case "verdi":
    case "begrensning": {
      const dim = norm(
        structuredField(atom.structured_data, "dimensjon") ??
          structuredField(atom.structured_data, "dimension") ??
          "",
      );
      const label = norm(structuredField(atom.structured_data, "etikett") ?? "") || content;
      return `${p}|${kind}|${dim}|${label}`;
    }
    case "evidens": {
      const kategori = norm(
        atom.atom_type ?? structuredField(atom.structured_data, "kategori") ?? "",
      );
      const label = norm(structuredField(atom.structured_data, "etikett") ?? "") || content;
      return `${p}|evidens|${kategori}|${label}`;
    }
    case "mangel":
      return `${p}|mangel|${atom.target_requirement_id ?? content}`;
    default:
      return `${p}|${kind}|${content}`;
  }
}

/** Nøkkelen som ble lagret ved innsetting, med utledet nøkkel som fallback. */
export function storedOrDerivedLogicalKey(atom: CareerAtomKeyInput): string {
  return structuredField(atom.structured_data, "logical_key") ?? careerAtomLogicalKey(atom);
}

// ---------------------------------------------------------------------------
// Ferskhet
// ---------------------------------------------------------------------------

export type CareerAtomKindName =
  | "evidens"
  | "onske"
  | "verdi"
  | "maal"
  | "begrensning"
  | "mangel";

const MONTH_MS = 30 * 864e5;

/**
 * Hvor lenge et atom er ferskt, per kind. `null` betyr at atomet aldri forfaller.
 * Evidens forfaller aldri: et resultat fra 2019 er gammelt, ikke utdatert.
 */
export const STALE_HORIZON_MS: Record<CareerAtomKindName, number | null> = {
  evidens: null,
  onske: 12 * MONTH_MS,
  verdi: 24 * MONTH_MS,
  maal: 6 * MONTH_MS,
  begrensning: 12 * MONTH_MS,
  mangel: 3 * MONTH_MS,
};

/**
 * Regner ut `stale_at` for et atom.
 * - `maal` bruker `due_at` når den finnes.
 * - `begrensning` bruker `valid_to`, og får alltid en dato: settes den ikke,
 *   legges den ett år frem, slik at brukeren blir spurt årlig om den fortsatt gjelder.
 */
export function computeStaleAt(
  kind: string,
  opts: { refreshedAt?: string | Date | null; dueAt?: string | null; validTo?: string | null } = {},
): string | null {
  const k = kind as CareerAtomKindName;
  const base = opts.refreshedAt ? new Date(opts.refreshedAt) : new Date();
  const horizon = STALE_HORIZON_MS[k];
  if (k === "evidens") return null;
  if (k === "maal" && opts.dueAt) return new Date(opts.dueAt).toISOString();
  if (k === "begrensning") {
    if (opts.validTo) return new Date(opts.validTo).toISOString();
    return new Date(base.getTime() + (horizon ?? 12 * MONTH_MS)).toISOString();
  }
  if (horizon == null) return null;
  return new Date(base.getTime() + horizon).toISOString();
}

/** Begrensninger får alltid en sluttdato — ellers utløses aldri den årlige påminnelsen. */
export function defaultValidToForBegrensning(from: Date = new Date()): string {
  const d = new Date(from.getTime());
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Ferskhetstilstanden lagres ikke. Den avledes av `stale_at` og `now()`.
 * `state` forblir måltilstanden alene (planlagt/i_arbeid/oppnadd/forkastet).
 */
export type FreshnessStatus = "fersk" | "uten_forfall" | "passert";

export type FreshnessView = {
  status: FreshnessStatus;
  /** Hva som skal skje når fristen er passert. Ingen av dem er automatisk, unntatt begrensning. */
  action: "ingen" | "bekreft" | "revurder_maal" | "deaktiver" | "reevaluer_mangel";
  autoDeactivate: boolean;
  promptNo: string | null;
};

export function freshnessFor(
  atom: { atom_kind: string; stale_at?: string | null; user_locked?: boolean | null },
  now: Date = new Date(),
): FreshnessView {
  const kind = atom.atom_kind as CareerAtomKindName;
  if (kind === "evidens" || !atom.stale_at) {
    return { status: "uten_forfall", action: "ingen", autoDeactivate: false, promptNo: null };
  }
  if (new Date(atom.stale_at).getTime() > now.getTime()) {
    return { status: "fersk", action: "ingen", autoDeactivate: false, promptNo: null };
  }
  if (atom.user_locked) {
    return { status: "passert", action: "ingen", autoDeactivate: false, promptNo: null };
  }
  switch (kind) {
    case "onske":
      return {
        status: "passert",
        action: "bekreft",
        autoDeactivate: false,
        promptNo: "Gjelder dette ønsket fortsatt?",
      };
    case "verdi":
      return {
        status: "passert",
        action: "bekreft",
        autoDeactivate: false,
        promptNo: "Står denne verdien seg fortsatt?",
      };
    case "maal":
      return {
        status: "passert",
        action: "revurder_maal",
        autoDeactivate: false,
        promptNo: "Ble målet nådd, skal det utsettes, eller er det forlatt?",
      };
    case "begrensning":
      return {
        status: "passert",
        action: "deaktiver",
        autoDeactivate: true,
        promptNo: "Begrensningen har utløpt. Forleng den hvis den fortsatt gjelder.",
      };
    case "mangel":
      return {
        status: "passert",
        action: "reevaluer_mangel",
        autoDeactivate: false,
        promptNo: null,
      };
    default:
      return { status: "passert", action: "ingen", autoDeactivate: false, promptNo: null };
  }
}

/**
 * Alder på evidens, til visning. Påvirker verken `is_active` eller `stale_at`.
 * Et resultat fra 2019 er gammelt — ikke utdatert.
 */
export function evidenceAgeYears(
  atom: { valid_to?: string | null; valid_from?: string | null; created_at?: string | null },
  now: Date = new Date(),
): number | null {
  const ref = atom.valid_to ?? atom.valid_from ?? atom.created_at;
  if (!ref) return null;
  const ms = now.getTime() - new Date(ref).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / (365.25 * 864e5));
}


export function generatePreferenceAtomsFromCareerProfile(profile: UserCareerProfileRow | null): PlannedPreferenceAtom[] {
  if (!profile) return [];
  const src: AtomRefreshSource = "career_profile";
  const cid = profile.id;
  const out: PlannedPreferenceAtom[] = [];

  const push = (
    dimension: string,
    label: string,
    value: string | null,
    importance: number | null,
    sourceField: string,
    reasoning: string,
  ) => {
    const logicalKey = prefKey(src, sourceField, dimension, label, value);
    const source_hash = stableAtomHash([src, sourceField, dimension, label, value ?? ""]);
    out.push({
      logicalKey,
      source_hash,
      dimension,
      label,
      value,
      importance_score: clampImportance(importance),
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      reasoning,
      career_profile_id: cid,
    });
  };

  for (const ind of profile.desired_industries ?? []) {
    const t = ind.trim();
    if (!t) continue;
    push("industry", t, t, 4, `desired_industries:${norm(t)}`, "Hentet fra karriereprofil: ønskede bransjer");
  }
  for (const rt of profile.desired_role_types ?? []) {
    const t = rt.trim();
    if (!t) continue;
    push("role_type", t, t, 4, `desired_role_types:${norm(t)}`, "Hentet fra karriereprofil: ønskede rolletyper");
  }
  for (const sz of profile.preferred_company_sizes ?? []) {
    const t = sz.trim();
    if (!t) continue;
    push("company_size", t, t, 4, `preferred_company_sizes:${norm(t)}`, "Hentet fra karriereprofil: foretrukket selskapsstørrelse");
  }
  for (const ws of profile.preferred_work_styles ?? []) {
    const t = ws.trim();
    if (!t) continue;
    push("work_style", t, t, 4, `preferred_work_styles:${norm(t)}`, "Hentet fra karriereprofil: arbeidsmåte");
  }
  for (const loc of profile.preferred_locations ?? []) {
    const t = loc.trim();
    if (!t) continue;
    push("location", t, t, 4, `preferred_locations:${norm(t)}`, "Hentet fra karriereprofil: foretrukket sted");
  }
  if (profile.remote_preference?.trim()) {
    const t = profile.remote_preference.trim();
    push("work_style", `Remote: ${t}`, t, 4, `remote_preference`, "Hentet fra karriereprofil: remote-preferanse");
  }
  if (profile.travel_preference?.trim()) {
    const t = profile.travel_preference.trim();
    push("travel", `Reise: ${t}`, t, 4, `travel_preference`, "Hentet fra karriereprofil: reisepreferanse");
  }

  const slider = (field: string, dimension: string, nbLabel: string, v: number | null) => {
    if (v == null || Number.isNaN(v)) return;
    push(dimension, nbLabel, String(v), clampImportance(v), field, `Hentet fra karriereprofil: ${field}`);
  };
  slider("mission_importance", "mission", "Misjon (prioritet)", profile.mission_importance);
  slider("innovation_importance", "innovation", "Innovasjon (prioritet)", profile.innovation_importance);
  slider("sustainability_importance", "sustainability", "Bærekraft (prioritet)", profile.sustainability_importance);
  slider("work_life_balance_importance", "work_life_balance", "Livsbalanse (prioritet)", profile.work_life_balance_importance);
  slider("compensation_importance", "compensation", "Kompensasjon (prioritet)", profile.compensation_importance);
  slider("leadership_ambition", "leadership_scope", "Lederambisjon", profile.leadership_ambition);
  if (profile.stability_vs_growth != null && !Number.isNaN(profile.stability_vs_growth)) {
    push(
      "stability",
      "Stabilitet vs vekst (skala 1–6)",
      String(profile.stability_vs_growth),
      clampImportance(profile.stability_vs_growth),
      "stability_vs_growth",
      "Hentet fra karriereprofil: stabilitet vs vekst",
    );
  }

  return out;
}

export function generatePreferenceAtomsFromProfile(profile: UserProfileRow | null): PlannedPreferenceAtom[] {
  if (!profile) return [];
  const src: AtomRefreshSource = "profile";
  const out: PlannedPreferenceAtom[] = [];
  const push = (
    dimension: string,
    label: string,
    value: string | null,
    importance: number | null,
    sourceField: string,
    reasoning: string,
  ) => {
    const logicalKey = prefKey(src, sourceField, dimension, label, value);
    const source_hash = stableAtomHash([src, sourceField, dimension, label, value ?? ""]);
    out.push({
      logicalKey,
      source_hash,
      dimension,
      label,
      value,
      importance_score: clampImportance(importance),
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      reasoning,
      career_profile_id: null,
    });
  };

  for (const tr of profile.target_roles ?? []) {
    const t = tr.trim();
    if (!t) continue;
    push("role_type", t, t, 4, `target_roles:${norm(t)}`, "Hentet fra Sokrates-profil: målroller");
  }
  if (profile.target_role?.trim()) {
    const t = profile.target_role.trim();
    push("role_type", t, t, 4, "target_role", "Hentet fra Sokrates-profil: målrolle");
  }
  for (const ti of profile.target_industries ?? []) {
    const t = ti.trim();
    if (!t) continue;
    push("industry", t, t, 4, `target_industries:${norm(t)}`, "Hentet fra Sokrates-profil: målbransjer");
  }
  for (const pl of profile.preferred_locations ?? []) {
    const t = pl.trim();
    if (!t) continue;
    push("location", t, t, 4, `preferred_locations:${norm(t)}`, "Hentet fra Sokrates-profil: foretrukne steder");
  }
  for (const wt of profile.work_types ?? []) {
    const t = wt.trim();
    if (!t) continue;
    push("work_style", t, t, 4, `work_types:${norm(t)}`, "Hentet fra Sokrates-profil: arbeidstype");
  }
  return out;
}

export function generateEvidenceAtomsFromProfile(profile: UserProfileRow | null): PlannedEvidenceAtom[] {
  if (!profile) return [];
  const src: AtomRefreshSource = "profile";
  const out: PlannedEvidenceAtom[] = [];
  const push = (
    category: string,
    label: string,
    description: string | null,
    strength: number | null,
    sourceField: string,
    reasoning: string,
    evidence_type: string | null = null,
  ) => {
    const logicalKey = evKey(src, sourceField, category, label);
    const source_hash = stableAtomHash([src, sourceField, category, label]);
    out.push({
      logicalKey,
      source_hash,
      category,
      label,
      description,
      strength_score: clampImportance(strength),
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: null,
      source_profile_field: sourceField,
      evidence_type,
      reasoning,
    });
  };

  for (const ind of profile.industries ?? []) {
    const t = ind.trim();
    if (!t) continue;
    push("industry", `Bransjeerfaring: ${t}`, "Registrert under «bransjer» på profilen.", 3, `industries:${norm(t)}`, "Profilfelt: industries (typisk erfaring, ikke mål)");
  }
  for (const sk of profile.skills ?? []) {
    const t = sk.trim();
    if (!t) continue;
    push("technology", `Ferdighet: ${t}`, "Fra profilens ferdighetsliste.", 3, `skills:${norm(t)}`, "Profilfelt: skills");
  }
  for (const lang of profile.languages ?? []) {
    const t = lang.trim();
    if (!t) continue;
    push("language", `Språk: ${t}`, "Fra profilens språkliste.", 4, `languages:${norm(t)}`, "Profilfelt: languages");
  }
  if (profile.current_role_title?.trim()) {
    const t = profile.current_role_title.trim();
    push("leadership", `Nåværende rolle: ${t}`, "Fra profil.", 3, "current_role_title", "Profilfelt: current_role_title", "role_title");
  }
  if (profile.current_employer?.trim()) {
    const t = profile.current_employer.trim();
    push("commercial", `Nåværende arbeidsgiver: ${t}`, "Fra profil.", 3, "current_employer", "Profilfelt: current_employer", "employer");
  }
  if (profile.linkedin_headline?.trim()) {
    const t = profile.linkedin_headline.trim();
    push("communication", "LinkedIn-overskrift", t, 3, "linkedin_headline", "Profilfelt: linkedin_headline", "linkedin");
  }
  if (profile.years_experience != null && profile.years_experience >= 0) {
    push(
      "result",
      "Års erfaring (profil)",
      `${profile.years_experience} år registrert på profilen.`,
      3,
      "years_experience",
      "Profilfelt: years_experience",
      "tenure",
    );
  }
  const hasCvPath = !!(profile.cv_no_pdf_path?.trim() || profile.cv_en_pdf_path?.trim());
  if (hasCvPath) {
    push(
      "project",
      "CV-fil knyttet til profilen",
      "Minst én generert CV (NO/EN) finnes på profilen.",
      3,
      "cv_paths",
      "Profilfelt: cv_no_pdf_path / cv_en_pdf_path",
      "cv",
    );
  }
  return out;
}

const DOC_TYPE_LABELS: Record<string, { label: string; category: string }> = {
  cv: { label: "CV-dokument", category: "project" },
  søknadsbrev: { label: "Søknadsbrev", category: "communication" },
  case_dokument: { label: "Case-dokument", category: "project" },
  referanseliste: { label: "Referanseliste", category: "people" },
};

export function generateEvidenceAtomsFromDocuments(documents: DocumentRow[]): PlannedEvidenceAtom[] {
  const src: AtomRefreshSource = "document";
  const out: PlannedEvidenceAtom[] = [];
  for (const d of documents) {
    if (d.deleted_at) continue;
    const meta = DOC_TYPE_LABELS[d.document_type];
    if (!meta) continue;
    const title = (d.title ?? "").trim() || meta.label;
    const label = `${meta.label}: ${title}`;
    const sourceField = `document:${d.id}:${d.document_type}`;
    const logicalKey = evKey(src, sourceField, meta.category, label);
    const source_hash = stableAtomHash([src, sourceField, meta.category, label]);
    out.push({
      logicalKey,
      source_hash,
      category: meta.category,
      label,
      description: `Dokumenttype «${d.document_type}» i biblioteket.`,
      strength_score: 4,
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: d.id,
      source_profile_field: null,
      evidence_type: d.document_type,
      reasoning: "Oppdaget aktivt dokument i dokumenttabellen.",
    });
  }
  return out;
}

const CV_IMPORT_ACTIVE = new Set(["parsed", "reviewed", "committed"]);

export function generateEvidenceAtomsFromCvImports(imports: CvImportRow[]): PlannedEvidenceAtom[] {
  const src: AtomRefreshSource = "cv_import";
  const active = imports.filter((i) => CV_IMPORT_ACTIVE.has(i.status));
  if (active.length === 0) return [];
  const out: PlannedEvidenceAtom[] = [];
  for (const imp of active) {
    const fn = imp.source_filename?.trim() || "CV-fil";
    const label = `CV-import (${imp.status}): ${fn}`;
    const sourceField = `cv_import:${imp.id}`;
    const logicalKey = evKey(src, sourceField, "project", label);
    const source_hash = stableAtomHash([src, sourceField, "project", label]);
    out.push({
      logicalKey,
      source_hash,
      category: "project",
      label,
      description: "Strukturert CV-import finnes (høyde-nivå; detaljer ligger i cv_evidence_atoms når tilgjengelig).",
      strength_score: 4,
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: null,
      source_profile_field: null,
      evidence_type: "cv_import",
      reasoning: "Basert på cv_imports-rad med status parsed/reviewed/committed.",
    });
  }
  return out;
}

export function generateEvidenceAtomsFromCvEvidenceAtoms(cvEvidenceAtomCount: number): PlannedEvidenceAtom[] {
  if (cvEvidenceAtomCount <= 0) return [];
  const src: AtomRefreshSource = "cv_import";
  const sourceField = "cv_evidence_atoms:summary";
  const label = `Strukturert CV-evidens (${cvEvidenceAtomCount} rader)`;
  const logicalKey = evKey(src, sourceField, "result", label);
  const source_hash = stableAtomHash([src, sourceField, "result", label]);
  return [
    {
      logicalKey,
      source_hash,
      category: "result",
      label,
      description: "Granulære rader finnes allerede i cv_evidence_atoms — dette er et sammendrag for bruker_evidence_atoms.",
      strength_score: 4,
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: null,
      source_profile_field: null,
      evidence_type: "cv_evidence_summary",
      reasoning: "Antall aktive strukturerte evidens-rader fra CV-modulen.",
    },
  ];
}

export function generateEvidenceAtomsFromLinkedInProfile(profile: UserProfileRow | null): PlannedEvidenceAtom[] {
  if (!profile) return [];
  const linked =
    !!(profile.linkedin_id?.trim() || profile.linkedin_vanity_url?.trim() || profile.linkedin_picture_url?.trim());
  if (!linked) return [];
  const src: AtomRefreshSource = "linkedin";
  const sourceField = "linkedin:connected";
  const label = "LinkedIn-profil knyttet";
  const logicalKey = evKey(src, sourceField, "network", label);
  const source_hash = stableAtomHash([src, sourceField, "network", label]);
  return [
    {
      logicalKey,
      source_hash,
      category: "network",
      label,
      description: "LinkedIn-identifikator eller URL/bilde er satt på profilen.",
      strength_score: 3,
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: null,
      source_profile_field: "linkedin_id|linkedin_vanity_url|linkedin_picture_url",
      evidence_type: "linkedin",
      reasoning: "Indikerer at LinkedIn-data finnes i Sokrates (ingen scraping).",
    },
  ];
}

export function generateEvidenceAtomsFromUserCompanyRatings(ratings: UserCompanyRatingRow[]): PlannedEvidenceAtom[] {
  if (ratings.length === 0) return [];
  const src: AtomRefreshSource = "user_rating";
  const sourceField = "user_company_ratings:summary";
  const label = `Arbeidsgivervurderinger (${ratings.length} registreringer)`;
  const logicalKey = evKey(src, sourceField, "governance", label);
  const source_hash = stableAtomHash([src, sourceField, "governance", label]);
  const withNotes = ratings.filter((r) => (r.user_notes ?? "").trim().length > 0).length;
  return [
    {
      logicalKey,
      source_hash,
      category: "governance",
      label,
      description:
        withNotes > 0
          ? `${ratings.length} vurdering(er); ${withNotes} med egne notater.`
          : `${ratings.length} vurdering(er) registrert (ingen preferanser inferert).`,
      strength_score: ratings.length >= 3 ? 4 : 3,
      confidence_score: 1,
      source: src,
      source_field: sourceField,
      source_document_id: null,
      source_profile_field: null,
      evidence_type: "employer_ratings",
      reasoning: "Høyde-nivå signal om erfaring med å vurdere arbeidsgivere i appen.",
    },
  ];
}

export type BuildUserAtomRefreshPlanInput = {
  careerProfile: UserCareerProfileRow | null;
  profile: UserProfileRow | null;
  documents: DocumentRow[];
  cvImports: CvImportRow[];
  cvEvidenceAtomCount: number;
  userCompanyRatings: UserCompanyRatingRow[];
  existingPreferenceAtoms: Tables<"user_preference_atoms">[];
  existingEvidenceAtoms: Tables<"user_evidence_atoms">[];
};

function dedupePreferences(rows: PlannedPreferenceAtom[]): PlannedPreferenceAtom[] {
  const m = new Map<string, PlannedPreferenceAtom>();
  for (const r of rows) {
    m.set(r.logicalKey, r);
  }
  return [...m.values()];
}

function dedupeEvidence(rows: PlannedEvidenceAtom[]): PlannedEvidenceAtom[] {
  const m = new Map<string, PlannedEvidenceAtom>();
  for (const r of rows) {
    m.set(r.logicalKey, r);
  }
  return [...m.values()];
}

export function buildUserAtomRefreshPlan(input: BuildUserAtomRefreshPlanInput): UserAtomRefreshPlan {
  const warnings: string[] = [];

  const generatedPrefs = dedupePreferences([
    ...generatePreferenceAtomsFromCareerProfile(input.careerProfile),
    ...generatePreferenceAtomsFromProfile(input.profile),
  ]);

  const generatedEv = dedupeEvidence([
    ...generateEvidenceAtomsFromProfile(input.profile),
    ...generateEvidenceAtomsFromDocuments(input.documents),
    ...generateEvidenceAtomsFromCvImports(input.cvImports),
    ...generateEvidenceAtomsFromCvEvidenceAtoms(input.cvEvidenceAtomCount),
    ...generateEvidenceAtomsFromLinkedInProfile(input.profile),
    ...generateEvidenceAtomsFromUserCompanyRatings(input.userCompanyRatings),
  ]);

  if (!input.careerProfile && !input.profile) {
    warnings.push("Mangler både karriereprofil og Sokrates-profil — begrenset datagrunnlag.");
  }

  const prefByHash = new Map<string, Tables<"user_preference_atoms">>();
  const prefByKey = new Map<string, Tables<"user_preference_atoms">>();
  for (const row of input.existingPreferenceAtoms) {
    if (row.source_hash) prefByHash.set(row.source_hash, row);
    prefByKey.set(preferenceLogicalKeyFromRow(row), row);
  }
  for (const p of generatedPrefs) {
    const hit = prefByHash.get(p.source_hash) ?? prefByKey.get(p.logicalKey);
    if (hit && isSystemRefreshSource(hit.source)) {
      p.existingId = hit.id;
    }
  }

  const evByHash = new Map<string, Tables<"user_evidence_atoms">>();
  const evByKey = new Map<string, Tables<"user_evidence_atoms">>();
  for (const row of input.existingEvidenceAtoms) {
    if (row.source_hash) evByHash.set(row.source_hash, row);
    evByKey.set(evidenceLogicalKeyFromRow(row), row);
  }
  for (const e of generatedEv) {
    const hit = evByHash.get(e.source_hash) ?? evByKey.get(e.logicalKey);
    if (hit && isSystemRefreshSource(hit.source)) {
      e.existingId = hit.id;
    }
  }

  const newPrefKeys = new Set(generatedPrefs.map((p) => p.logicalKey));
  const newEvKeys = new Set(generatedEv.map((e) => e.logicalKey));

  const systemAtomsToDeactivate: AtomDeactivateTarget[] = [];

  for (const row of input.existingPreferenceAtoms) {
    if (!row.is_active) continue;
    if (row.source === "manual") continue;
    if (!isSystemRefreshSource(row.source)) continue;
    const key = preferenceLogicalKeyFromRow(row);
    if (!newPrefKeys.has(key)) {
      systemAtomsToDeactivate.push({
        kind: "preference",
        id: row.id,
        reason: "Finnes ikke lenger i deterministisk uttrekk fra kildedata",
      });
    }
  }

  for (const row of input.existingEvidenceAtoms) {
    if (!row.is_active) continue;
    if (row.source === "manual") continue;
    if (!isSystemRefreshSource(row.source)) continue;
    const key = evidenceLogicalKeyFromRow(row);
    if (!newEvKeys.has(key)) {
      systemAtomsToDeactivate.push({
        kind: "evidence",
        id: row.id,
        reason: "Finnes ikke lenger i deterministisk uttrekk fra kildedata",
      });
    }
  }

  const summary = [
    `${generatedPrefs.length} preferanse-atom(er) i plan`,
    `${generatedEv.length} evidens-atom(er) i plan`,
    `${systemAtomsToDeactivate.length} system-atom(er) merket for deaktivering`,
  ].join(" · ");

  return {
    preferenceAtomsToUpsert: generatedPrefs,
    evidenceAtomsToUpsert: generatedEv,
    systemAtomsToDeactivate,
    warnings,
    summary,
  };
}
