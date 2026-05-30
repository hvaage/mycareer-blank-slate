// @ts-nocheck
import type { Json } from "@/integrations/supabase/types";
import type { AtomEnrichmentProposalRow } from "@/lib/queries/atom-enrichment";
import { proposalApprovalWritesAtoms } from "@/lib/queries/atom-enrichment";

function asRecord(payload: Json | null | undefined): Record<string, unknown> {
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) return {};
  return payload as Record<string, unknown>;
}

function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (v != null && typeof v !== "object") return String(v);
  return null;
}

/** Utviklings- eller testinnsatte forslag (skjules fra hovedlisten med mindre bruker ber om det). */
export function isDevSeedProposal(p: AtomEnrichmentProposalRow): boolean {
  return p.source_type === "dev_seed";
}

export function getProposalStatusLabel(status: AtomEnrichmentProposalRow["status"]): string {
  switch (status) {
    case "pending_review":
      return "Avventer vurdering";
    case "needs_more_context":
      return "Trenger mer kontekst";
    case "approved":
      return "Godkjent";
    case "rejected":
      return "Avvist";
    case "merged":
      return "Flettet";
    case "superseded":
      return "Erstattet";
    case "expired":
      return "Utløpt";
    default:
      return "Ukjent status";
  }
}

export function getProposalConfidenceLabel(confidence: number | null | undefined): string | null {
  if (confidence == null || Number.isNaN(Number(confidence))) return null;
  const c = Number(confidence);
  if (c >= 0.85) return "Trygghet: høy — tolkningen er tydelig ut fra profilen.";
  if (c >= 0.7) return "Trygghet: middels — les gjennom før du bestemmer deg.";
  return "Trygghet: lavere — vurder ekstra nøye eller be om mer kontekst.";
}

export function getProposalSourceLabel(p: AtomEnrichmentProposalRow): string {
  if (p.source_type === "dev_seed") return "Testforslag (kun for utvikling)";
  if (p.source_type === "deterministic_module_5_1")
    return "Basert på profilen din (regelbasert forslag)";
  if (p.source_type === "manual_sql") return "Manuelt eksempel";
  if (!p.source_type || p.source_type === "enrichment") return "Basert på lagrede opplysninger";
  return "Basert på lagrede opplysninger";
}

function roleStructureHint(
  sourceField: string | null | undefined,
): "career_roles" | "profile_roles" | "other" {
  const sf = (sourceField ?? "").toLowerCase();
  if (sf.startsWith("desired_role_types:")) return "career_roles";
  if (sf.startsWith("target_roles:") || sf === "target_role") return "profile_roles";
  return "other";
}

function dimensionKind(dimension: string | null | undefined): string {
  switch ((dimension ?? "").toLowerCase()) {
    case "role_type":
      return "ønsket rolle";
    case "industry":
      return "bransje";
    case "company_size":
      return "selskapsstørrelse";
    case "work_style":
      return "arbeidsmåte";
    case "location":
      return "sted";
    case "travel":
      return "reise";
    case "mission":
    case "mission_importance":
      return "misjon";
    case "innovation":
    case "innovation_importance":
      return "innovasjon";
    case "sustainability":
    case "sustainability_importance":
      return "bærekraft";
    case "work_life_balance":
    case "work_life_balance_importance":
      return "livsbalanse";
    case "compensation":
    case "compensation_importance":
      return "kompensasjon";
    case "leadership_scope":
    case "leadership_ambition":
      return "lederambisjon";
    case "stability":
      return "stabilitet og vekst";
    default:
      return dimension?.trim() ? dimension.replace(/_/g, " ") : "karrierepreferanse";
  }
}

export function getProposalActionLabel(p: AtomEnrichmentProposalRow): string {
  switch (p.proposal_action) {
    case "create_atom":
      if (p.target_atom_type === "user_evidence_atom") return "Legg til dokumentert erfaring";
      return "Legg til i karriereprofilen";
    case "update_atom":
      return "Oppdater karriereprofil";
    case "deactivate_atom":
      return "Fjern fra aktiv profil";
    case "flag_conflict":
      return "Avklar motstrid";
    case "suggest_evidence":
      return "Manglende dokumentasjon";
    case "suggest_preference_clarification":
      return "Presiser karrierepreferanser";
    case "suggest_positioning":
      return "Foreslå posisjonering";
    case "suggest_narrative":
      return "Foreslå fortelling";
    case "merge_atoms":
      return "Slå sammen oppføringer";
    default:
      return "Profilforslag";
  }
}

export function getProposalTitle(p: AtomEnrichmentProposalRow): string {
  if (isDevSeedProposal(p)) {
    const pay = asRecord(p.proposal_payload);
    const label = str(pay, "label");
    return label ? `Testforslag: «${label}»` : "Testforslag (kun utvikling)";
  }
  const pay = asRecord(p.proposal_payload);
  const dim = str(pay, "dimension");
  const label = str(pay, "label");
  const cat = str(pay, "category");
  const sourceField = str(pay, "source_field");

  if (
    p.proposal_action === "create_atom" &&
    p.target_atom_type === "user_preference_atom" &&
    label
  ) {
    if (dim === "role_type") {
      const hint = roleStructureHint(sourceField);
      if (hint === "career_roles" || hint === "profile_roles") {
        return `Strukturer «${label}» som ønsket rolle`;
      }
      return `Legg til «${label}» som ønsket rolle`;
    }
    return `Legg til ${dimensionKind(dim)}: ${label}`;
  }

  if (p.proposal_action === "create_atom" && p.target_atom_type === "user_evidence_atom" && label) {
    const prefix = cat ? `${cat}: ` : "";
    return `Dokumentert erfaring — ${prefix}${label}`;
  }

  if (p.proposal_action === "suggest_evidence") {
    const gap = str(pay, "gap");
    if (gap === "leadership") return "Dokumenter ledererfaring tydeligere";
    return "Manglende dokumentasjon";
  }

  if (p.proposal_action === "flag_conflict") {
    return "Avklar lederambisjon og ledernivå";
  }

  if (p.proposal_action === "suggest_preference_clarification") {
    const topic = str(pay, "topic");
    if (topic === "experience_vs_target_roles") return "Presiser erfaring i forhold til målroller";
    if (topic === "compensation_vs_balance") return "Prioriter mellom lønn og livsbalanse";
    return "Presiser karrierepreferanser";
  }

  if (p.proposal_action === "update_atom" && label) return `Oppdater: ${label}`;
  if (p.proposal_action === "deactivate_atom") return "Fjern fra aktiv profil";

  return getProposalActionLabel(p);
}

export function getProposalSummary(p: AtomEnrichmentProposalRow): string {
  if (isDevSeedProposal(p)) {
    return "Dette er et kunstig eksempel for utviklere. Det brukes for å verifisere skjema og tilganger — ikke ekte brukerdata.";
  }
  const pay = asRecord(p.proposal_payload);
  const dim = str(pay, "dimension");
  const label = str(pay, "label");
  const value = str(pay, "value");
  const sourceField = str(pay, "source_field");
  const desc = str(pay, "description");
  const rec = str(pay, "recommendation");

  if (p.proposal_action === "create_atom" && p.target_atom_type === "user_preference_atom") {
    if (dim === "role_type" && label) {
      const hint = roleStructureHint(sourceField);
      if (hint === "career_roles") {
        return `«${label}» står allerede blant målroller i karriereprofilen din. Forslaget lagrer rollen som en tydelig karrierepreferanse slik at matching og vurderinger kan bruke den strukturert — uten å endre det du har skrevet fritekst.`;
      }
      if (hint === "profile_roles") {
        return `«${label}» er registrert som målrolle i profilen din. Forslaget gjør rollen om til en strukturert karrierepreferanse slik at sammenligning med stillinger og veiledning blir enklere.`;
      }
      return `Profilen din peker mot «${label}» som ønsket rolle. Godkjenn for å lagre det som en tydelig karrierepreferanse.`;
    }
    if (label) {
      const v = value && value !== label ? ` (${value})` : "";
      return `Vi foreslår å legge inn «${label}»${v} som ${dimensionKind(dim)} i karriereprofilen.`;
    }
  }

  if (p.proposal_action === "create_atom" && p.target_atom_type === "user_evidence_atom" && label) {
    const src = str(pay, "source");
    const et = str(pay, "evidence_type");
    if (src === "linkedin") {
      return "Profilen din er koblet til et eksternt nettverk. Vi foreslår en enkel referanse i dokumentert erfaring — ikke en automatisk full karrierehistorikk.";
    }
    if (et === "søknadsbrev" || (label && label.toLowerCase().includes("søknadsbrev"))) {
      return "Systemet har registrert søknadsbrev som kan brukes som erfarings- og posisjoneringsgrunnlag i karriereprofilen din.";
    }
    if (desc && desc.toLowerCase().includes("år")) {
      return `Karriereprofilen din inneholder allerede relevante erfaringsopplysninger. ${desc} Dette brukes som strukturert grunnlag for matching og vurderinger når du godkjenner.`;
    }
    return desc
      ? `${label}: ${desc}`
      : `Kilden din støtter at vi legger inn «${label}» som dokumentert erfaring i karriereprofilen.`;
  }

  if (p.proposal_action === "suggest_evidence" && rec) {
    return `${rec} Dette er veiledning — ingen ny dokumentert erfaring opprettes ved godkjenning.`;
  }

  if (p.proposal_action === "flag_conflict") {
    return (
      str(pay, "detail") ??
      "Profilen signalerer noe som kan oppleves som motstridende. Les gjennom og avklar hva som gjelder for deg."
    );
  }

  if (p.proposal_action === "suggest_preference_clarification" && rec) {
    return rec;
  }

  if (p.rationale && !p.rationale.toLowerCase().includes("atom")) {
    return p.rationale;
  }

  return p.explanation?.trim() || "Les gjennom forslaget og velg om det passer for deg.";
}

export function getProposalImpactText(p: AtomEnrichmentProposalRow): string {
  const pay = asRecord(p.proposal_payload);
  const label = str(pay, "label");
  const dim = str(pay, "dimension");
  const sourceField = str(pay, "source_field");

  if (!proposalApprovalWritesAtoms(p)) {
    if (p.proposal_action === "suggest_evidence") {
      return "Hvis du godkjenner, bekrefter du bare at du har sett forslaget. Ingen ny dokumentert erfaring legges inn automatisk — du må legge inn begrunnede opplysninger selv der det trengs.";
    }
    return "Hvis du godkjenner, oppdateres status på forslaget. Karriereprofilen din endres ikke automatisk for denne typen forslag.";
  }

  if (
    p.proposal_action === "create_atom" &&
    p.target_atom_type === "user_preference_atom" &&
    label
  ) {
    if (dim === "role_type") {
      const hint = roleStructureHint(sourceField);
      if (hint === "career_roles" || hint === "profile_roles") {
        return `Hvis du godkjenner, legges «${label}» inn som en ønsket rolle i karriereprofilen din, slik at matching og vurderinger kan bruke den strukturert.`;
      }
      return `Hvis du godkjenner, legges «${label}» til som ønsket rolle i karriereprofilen.`;
    }
    return `Hvis du godkjenner, legges preferansen inn i karriereprofilen din.`;
  }

  if (p.proposal_action === "create_atom" && p.target_atom_type === "user_evidence_atom" && label) {
    return `Hvis du godkjenner, legges dokumentert erfaring («${label}») inn i karriereprofilen, med sporbarhet til kilden.`;
  }

  if (p.proposal_action === "update_atom") {
    return "Hvis du godkjenner, oppdateres den valgte oppføringen i karriereprofilen (manuelle oppføringer kan ikke endres på denne måten).";
  }

  if (p.proposal_action === "deactivate_atom") {
    return "Hvis du godkjenner, fjernes oppføringen fra den aktive profilen (manuelle oppføringer kan ikke endres på denne måten).";
  }

  return "Hvis du godkjenner, oppdateres karriereprofilen i tråd med forslaget.";
}

export function getProposalWhySuggested(p: AtomEnrichmentProposalRow): string {
  const summary = getProposalSummary(p);
  const rationale = p.rationale?.trim();
  if (
    rationale &&
    !rationale.toLowerCase().includes("atom") &&
    !rationale.toLowerCase().includes("json") &&
    rationale !== summary
  ) {
    return rationale;
  }
  return "Forslaget er laget ut fra opplysninger du allerede har lagret, for å gjøre profilen mer presis og nyttig i matching.";
}

/** Kun for «Tekniske detaljer» i utviklingsmodus — viser rå nyttelast uten å blande inn i hovedkort. */
export function getProposalTechnicalPayloadJson(p: AtomEnrichmentProposalRow): string {
  try {
    const s = JSON.stringify(p.proposal_payload, null, 2);
    return s.length > 4000 ? `${s.slice(0, 4000)}\n…` : s;
  } catch {
    return String(p.proposal_payload);
  }
}

export function getProposalTechnicalMetaLines(p: AtomEnrichmentProposalRow): string[] {
  const lines: string[] = [];
  lines.push(`intern status: ${p.status}`);
  lines.push(`proposal_action: ${p.proposal_action}`);
  lines.push(`target_atom_type: ${p.target_atom_type}`);
  if (p.source_type) lines.push(`source_type: ${p.source_type}`);
  if (p.source_hash) lines.push(`source_hash: ${p.source_hash}`);
  if (p.source_table) lines.push(`source_table: ${p.source_table}`);
  if (p.source_record_id) lines.push(`source_record_id: ${p.source_record_id}`);
  if (p.target_atom_id) lines.push(`target_atom_id: ${p.target_atom_id}`);
  if (p.inferred != null) lines.push(`inferred: ${p.inferred}`);
  return lines;
}
