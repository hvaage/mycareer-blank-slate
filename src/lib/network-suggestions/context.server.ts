// Fase 5D — kontekstinnhenting for KI-aktivitetsforslag. Server-only.
//
// Prinsipper:
//   - kun bruker-eide objekter, minimert til felter som trengs for prioritering
//   - modellen får en LUKKET liste med tillatte kildereferanser (evidence);
//     den kan ikke peke på vilkårlige objekt-ID-er
//   - ingen rå LinkedIn-anbefalinger, meldinger, klikkdata eller hemmeligheter
//   - signaturgrunnlaget er deterministisk, slik at samme grunnlag gjenbrukes

export type SuggestionScope = "overview" | "company" | "contact" | "opportunity";

/**
 * Fokus styrer hvor tungt jobbannonser (muligheter) vektes i kildelisten.
 * Nettverksarbeid skal ikke drukne i annonser, så muligheter nedvektes med
 * mindre brukeren eksplisitt ber om søknadsarbeid.
 */
export type SuggestionFocus = "nettverk" | "oppfolging" | "soknad" | "alle";

export type EvidenceRef = {
  ref: string;
  kind: "company" | "contact" | "opportunity" | "activity";
  id: string;
  label: string;
  detail: string | null;
  updatedAt: string | null;
};

export type SuggestionContext = {
  scope: SuggestionScope;
  scopeObjectId: string | null;
  focus: SuggestionFocus;
  evidence: EvidenceRef[];
  signatureBase: string;
};

type Admin = { from: (t: string) => any };

const MAX_PER_KIND = 25;
/** Nedvekting: annonser skal ikke dominere nettverksforslagene. */
const MAX_OPPORTUNITIES_NETWORK = 5;

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function buildSuggestionContext(input: {
  adminClient: Admin;
  userId: string;
  scope: SuggestionScope;
  scopeObjectId: string | null;
  focus?: SuggestionFocus;
}): Promise<SuggestionContext> {
  const { adminClient, userId, scope, scopeObjectId } = input;
  const focus: SuggestionFocus = input.focus ?? "nettverk";
  const evidence: EvidenceRef[] = [];

  // --- selskaper ---------------------------------------------------------
  let companyQuery = adminClient
    .from("user_company_relationships")
    .select("company_id, company_name_user, status, priority, updated_at, companies(name, industry)")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(MAX_PER_KIND);
  if (scope === "company" && scopeObjectId) companyQuery = companyQuery.eq("company_id", scopeObjectId);
  const { data: companies } = await companyQuery;

  for (const row of (companies ?? []) as any[]) {
    if (!row?.company_id) continue;
    evidence.push({
      ref: `company:${row.company_id}`,
      kind: "company",
      id: row.company_id,
      label: text(row.companies?.name) ?? text(row.company_name_user) ?? "Selskap",
      detail: [text(row.status, 40), text(row.priority, 40), text(row.companies?.industry, 60)]
        .filter(Boolean)
        .join(" · ") || null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  // --- kontakter ---------------------------------------------------------
  let contactQuery = adminClient
    .from("network_contacts")
    .select("id, display_name, manual_display_name, headline, manual_headline, company, updated_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(MAX_PER_KIND);
  if (scope === "contact" && scopeObjectId) contactQuery = contactQuery.eq("id", scopeObjectId);
  const { data: contacts } = await contactQuery;

  for (const row of (contacts ?? []) as any[]) {
    if (!row?.id) continue;
    evidence.push({
      ref: `contact:${row.id}`,
      kind: "contact",
      id: row.id,
      label: text(row.manual_display_name) ?? text(row.display_name) ?? "Kontakt",
      detail: [text(row.manual_headline) ?? text(row.headline), text(row.company, 120)]
        .filter(Boolean)
        .join(" · ") || null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  // --- muligheter --------------------------------------------------------
  // Nedvektet med mindre brukeren ber om søknadsarbeid eller står på en
  // mulighet: ellers overdøver annonsemengden nettverksarbeidet.
  const opportunityLimit =
    scope === "opportunity" || focus === "soknad" || focus === "alle"
      ? MAX_PER_KIND
      : MAX_OPPORTUNITIES_NETWORK;
  let opportunityQuery = adminClient
    .from("user_opportunities")
    .select("id, card_title, card_company, status, screening_status, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(opportunityLimit);
  if (scope === "opportunity" && scopeObjectId) opportunityQuery = opportunityQuery.eq("id", scopeObjectId);
  const { data: opportunities } = await opportunityQuery;

  for (const row of (opportunities ?? []) as any[]) {
    if (!row?.id) continue;
    evidence.push({
      ref: `opportunity:${row.id}`,
      kind: "opportunity",
      id: row.id,
      label: text(row.card_title) ?? "Mulighet",
      detail: [text(row.card_company, 120), text(row.status, 40)].filter(Boolean).join(" · ") || null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  // --- åpne aktiviteter (unngår duplikate forslag) -----------------------
  let activityQuery = adminClient
    .from("next_steps")
    .select("id, title, activity_type, status, due_date, company_id, contact_id, opportunity_id, updated_at")
    .eq("user_id", userId)
    .eq("completed", false)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(MAX_PER_KIND);
  if (scope === "company" && scopeObjectId) activityQuery = activityQuery.eq("company_id", scopeObjectId);
  if (scope === "contact" && scopeObjectId) activityQuery = activityQuery.eq("contact_id", scopeObjectId);
  if (scope === "opportunity" && scopeObjectId) activityQuery = activityQuery.eq("opportunity_id", scopeObjectId);
  const { data: activities } = await activityQuery;

  for (const row of (activities ?? []) as any[]) {
    if (!row?.id) continue;
    evidence.push({
      ref: `activity:${row.id}`,
      kind: "activity",
      id: row.id,
      label: text(row.title) ?? "Aktivitet",
      detail: [text(row.activity_type, 40), text(row.status, 40), text(row.due_date, 20)]
        .filter(Boolean)
        .join(" · ") || null,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    });
  }

  const signatureBase = JSON.stringify({
    scope,
    scopeObjectId,
    focus,
    refs: evidence
      .map((e) => `${e.ref}@${e.updatedAt ?? ""}`)
      .sort(),
  });

  return { scope, scopeObjectId, focus, evidence, signatureBase };
}
