// @ts-nocheck
// ============================================================
// Nettverk og muligheter — leselag (Fase 5A).
//
// Alle spørringer er bruker-scopet gjennom RLS på produkttabellene.
// Ingen staging-tabeller leses her, med unntak av nettverksbatchen som
// vises som import-/gjennomgangsstatus (aldri som register).
// ============================================================
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isJunkCompanyName, sanitizeCompanyName } from "@/lib/network/company-name";

export type CompanyKey = string;

/** Selskaper uten rad i selskapsregisteret identifiseres på normalisert navn. */
export function companyKeyFor(companyId: string | null, name: string): CompanyKey {
  if (companyId) return companyId;
  return `navn-${encodeURIComponent(name.trim().toLowerCase())}`;
}

export function isCompanyIdKey(key: CompanyKey): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key);
}

export function nameFromCompanyKey(key: CompanyKey): string | null {
  if (isCompanyIdKey(key)) return null;
  if (!key.startsWith("navn-")) return null;
  return decodeURIComponent(key.slice("navn-".length));
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const NETWORK_QUERY_PAGE_SIZE = 500;

/**
 * PostgREST caps a single response at the project max-rows setting (currently
 * 1,000). The network register must therefore page every graph collection
 * instead of silently treating the first response as the complete register.
 */
async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += NETWORK_QUERY_PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + NETWORK_QUERY_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    rows.push(...page);
    if (page.length < NETWORK_QUERY_PAGE_SIZE) return rows;
  }
}

export type NetworkCompanyItem = {
  key: CompanyKey;
  companyId: string | null;
  name: string;
  industry: string | null;
  location: string | null;
  status: string | null;
  priority: string | null;
  contactCount: number;
  openOpportunityCount: number;
  nextActivity: { id: string; title: string; due_date: string | null } | null;
  lastActivityAt: string | null;
  sources: string[];
};

export type NetworkContactItem = {
  id: string;
  display_name: string;
  headline: string | null;
  company: string | null;
  companyId: string | null;
  /** Kilde for aktiv verdi: brukerens egen registrering eller LinkedIn-observasjon. */
  nameSource: "user_input" | "linkedin_observed";
  headlineSource: "user_input" | "linkedin_observed";
  companySource: "user_input" | "linkedin_observed";
  linkedinDisplayName: string | null;
  linkedinHeadline: string | null;
  linkedinCompany: string | null;
  linkedinProfileUrl: string | null;
  linkedinObservedAt: string | null;
  connected_on: string | null;
  source_system: string | null;
  last_observed_at: string | null;
  nextActivity: { id: string; title: string; due_date: string | null } | null;
  lastContactAt: string | null;
};

async function loadNetworkGraph(userId: string) {
  const [contacts, relations, identities, userCompanies, opportunities, steps] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from("network_contacts")
        .select(
          "id, display_name, headline, company, connected_on, source_system, last_observed_at, is_active, manual_display_name, manual_headline, manual_updated_at, manual_email, manual_phone, manual_notes, manual_relation_status",
        )
        .eq("user_id", userId)
        .eq("is_active", true)
        .order("display_name")
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("network_contact_company_relations")
        .select(
          "id, network_contact_id, company_id, company_name_observed, company_name_canonical, relation_kind, relation_status, source_class, is_active, valid_from, valid_to, observed_at",
        )
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
    // Kun kanonisk LinkedIn-profil-URL. Hasher og interne previews leses aldri.
    fetchAllPages((from, to) =>
      supabase
        .from("network_contact_identities")
        .select("network_contact_id, identity_key, last_observed_at")
        .eq("user_id", userId)
        .eq("identity_kind", "linkedin_profile_url")
        .order("network_contact_id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("user_company_relationships")
        .select("id, company_id, company_name_user, relationship_kind, status, priority, notes, updated_at, companies(id, name, industry, country, organisasjonsnummer)")
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("user_opportunities")
        .select("id, canonical_opportunity_id, card_title, card_company, card_location, card_display_url, card_raw_url, card_published_at, card_source, status, screening_status, relevance_score, match_score_version, match_scored_model, screening_evaluated_at, ai_match_highlights, ai_concerns, updated_at, created_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("next_steps")
        .select(
          "id, title, description, due_date, priority, completed, completed_at, status, activity_type, activity_scope, result_note, company_id, contact_id, opportunity_id, application_id, created_at",
        )
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
  ]);

  const [hiddenCompanies, interviews, applications] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from("network_hidden_companies")
        .select("company_key, company_id, company_name, reason, created_at")
        .eq("user_id", userId)
        .order("company_key")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("interviews")
        .select("id, application_id, interview_type, scheduled_at, outcome")
        .eq("user_id", userId)
        .order("scheduled_at", { ascending: true, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("applications")
        .select("id, role_title, company_name, status")
        .eq("user_id", userId)
        .order("id")
        .range(from, to),
    ),
  ]);

  const [documents, postingContacts] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from("documents")
        .select("id, title, document_type, opportunity_id, application_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("network_posting_contacts")
        .select(
          "id, opportunity_id, network_contact_id, source_contact_ref, contact_name, contact_role, contact_email, contact_phone, source_class, observed_at",
        )
        .eq("user_id", userId)
        .order("observed_at", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
    // Kun mottatte anbefalinger er relevante for kontaktdetaljen.
    fetchAllPages((from, to) =>
      supabase
        .from("career_recommendations")
        .select(
          "id, author_name, author_title, author_company, relationship_text, recommendation_text, recommended_on, source_system, direction, network_contact_id, is_active, archived_at",
        )
        .eq("user_id", userId)
        .eq("direction", "received")
        .order("recommended_on", { ascending: false, nullsFirst: false })
        .order("id")
        .range(from, to),
    ),
  ]);


  return {
    contacts,
    relations,
    hiddenCompanies,
    identities,
    userCompanies,
    opportunities,
    steps,
    interviews,
    applications,
    documents,
    postingContacts,
  };
}



export type NetworkGraph = Awaited<ReturnType<typeof loadNetworkGraph>>;

export function networkGraphQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["network", "graph", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: () => loadNetworkGraph(userId!),
  });
}

/** Aggregerer selskaper fra selskapsforhold, muligheter og kontaktenes arbeidsgivere. */
export function buildCompanies(graph: NetworkGraph): NetworkCompanyItem[] {
  const byKey = new Map<CompanyKey, NetworkCompanyItem>();
  const nameToKey = new Map<string, CompanyKey>();

  const hiddenKeys = new Set<string>((graph.hiddenCompanies ?? []).map((h) => h.company_key));
  const hiddenNames = new Set<string>(
    (graph.hiddenCompanies ?? []).map((h) => norm(h.company_name)).filter(Boolean),
  );

  const ensure = (companyId: string | null, rawName: string, source: string) => {
    const name = sanitizeCompanyName(rawName);
    const clean = (name ?? "").trim();
    if (!clean && !companyId) return null;
    // Ugjenkjennelige navn (symboler, hashtag-kampanjer, reklame) er ikke selskaper.
    if (!companyId && isJunkCompanyName(clean)) return null;
    if (hiddenNames.has(norm(clean))) return null;
    if (companyId && hiddenKeys.has(companyId)) return null;
    if (hiddenKeys.has(companyKeyFor(companyId, clean))) return null;
    const existingByName = nameToKey.get(norm(clean));
    const key = companyId ?? existingByName ?? companyKeyFor(null, clean);
    let item = byKey.get(key);
    if (!item) {
      item = {
        key,
        companyId,
        name: clean || "Ukjent selskap",
        industry: null,
        location: null,
        status: null,
        priority: null,
        contactCount: 0,
        openOpportunityCount: 0,
        nextActivity: null,
        lastActivityAt: null,
        sources: [],
      };
      byKey.set(key, item);
    }
    if (companyId && !item.companyId) item.companyId = companyId;
    if (clean) nameToKey.set(norm(clean), key);
    if (!item.sources.includes(source)) item.sources.push(source);
    return item;
  };

  for (const rel of graph.userCompanies) {
    const company = rel.companies ?? null;
    const item = ensure(rel.company_id ?? null, company?.name ?? rel.company_name_user ?? "", "relasjon");
    if (!item) continue;
    item.status = rel.status ?? null;
    item.priority = rel.priority ?? null;
    item.industry = company?.industry ?? item.industry;
    item.location = company?.country ?? item.location;
  }

  const contactCompany = new Map<string, string[]>();
  for (const rel of graph.relations) {
    const item = ensure(rel.company_id ?? null, rel.company_name_observed ?? rel.company_name_canonical ?? "", "kontakt");
    if (!item) continue;
    item.contactCount += 1;
    const list = contactCompany.get(rel.network_contact_id) ?? [];
    list.push(item.key);
    contactCompany.set(rel.network_contact_id, list);
  }

  for (const contact of graph.contacts) {
    if (contactCompany.has(contact.id)) continue;
    if (!contact.company) continue;
    const item = ensure(null, contact.company, "kontakt");
    if (item) item.contactCount += 1;
  }

  const openStatuses = new Set(["ny", "vurderer", "aktiv", "open", "interested", "applied", "screening"]);
  for (const opp of graph.opportunities) {
    if (!opp.card_company) continue;
    const item = ensure(null, opp.card_company, "mulighet");
    if (!item) continue;
    if (!opp.status || openStatuses.has(String(opp.status))) item.openOpportunityCount += 1;
    if (!item.location && opp.card_location) item.location = opp.card_location;
  }

  for (const step of graph.steps) {
    if (!step.company_id) continue;
    const item = byKey.get(step.company_id);
    if (!item) continue;
    if (!step.completed && !item.nextActivity) {
      item.nextActivity = { id: step.id, title: step.title, due_date: step.due_date ?? null };
    }
    if (step.completed_at && (!item.lastActivityAt || step.completed_at > item.lastActivityAt)) {
      item.lastActivityAt = step.completed_at;
    }
  }

  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "nb"));
}

export function buildContacts(graph: NetworkGraph): NetworkContactItem[] {
  // Aktiv (brukerregistrert) relasjon vinner; ellers siste LinkedIn-observasjon.
  const activeRel = new Map<string, (typeof graph.relations)[number]>();
  const observedRel = new Map<string, (typeof graph.relations)[number]>();
  for (const rel of graph.relations) {
    if (rel.is_active) {
      activeRel.set(rel.network_contact_id, rel);
    } else if (!observedRel.has(rel.network_contact_id)) {
      observedRel.set(rel.network_contact_id, rel);
    }
  }

  const identityByContact = new Map<string, { url: string; observedAt: string | null }>();
  for (const ident of graph.identities ?? []) {
    if (!ident.identity_key) continue;
    const current = identityByContact.get(ident.network_contact_id);
    if (!current || (ident.last_observed_at ?? "") > (current.observedAt ?? "")) {
      identityByContact.set(ident.network_contact_id, {
        url: ident.identity_key,
        observedAt: ident.last_observed_at ?? null,
      });
    }
  }

  return graph.contacts.map((c) => {
    const active = activeRel.get(c.id) ?? null;
    const observed = observedRel.get(c.id) ?? null;
    const identity = identityByContact.get(c.id) ?? null;
    const steps = graph.steps.filter((s) => s.contact_id === c.id);
    const next = steps.find((s) => !s.completed) ?? null;
    const done = steps.filter((s) => s.completed_at).map((s) => s.completed_at).sort();

    const linkedinCompany = observed?.company_name_observed ?? c.company ?? null;
    const manualCompany = active?.company_name_observed ?? null;
    const manualName = c.manual_display_name ?? null;
    const manualHeadline = c.manual_headline ?? null;

    return {
      id: c.id,
      display_name: manualName ?? c.display_name,
      headline: manualHeadline ?? c.headline ?? null,
      company: manualCompany ?? linkedinCompany,
      companyId: active?.company_id ?? observed?.company_id ?? null,
      nameSource: manualName ? "user_input" : "linkedin_observed",
      headlineSource: manualHeadline ? "user_input" : "linkedin_observed",
      companySource: manualCompany ? "user_input" : "linkedin_observed",
      linkedinDisplayName: c.display_name ?? null,
      linkedinHeadline: c.headline ?? null,
      linkedinCompany,
      linkedinProfileUrl: identity?.url ?? null,
      linkedinObservedAt: identity?.observedAt ?? c.last_observed_at ?? null,
      connected_on: c.connected_on ?? null,
      source_system: c.source_system ?? null,
      last_observed_at: c.last_observed_at ?? null,
      nextActivity: next ? { id: next.id, title: next.title, due_date: next.due_date ?? null } : null,
      lastContactAt: done.length ? done[done.length - 1] : null,
    };
  });
}


export type NetworkSearchResults = {
  contacts: NetworkContactItem[];
  companies: NetworkCompanyItem[];
  opportunities: Array<{ id: string; title: string; company: string | null }>;
};

export function searchNetwork(graph: NetworkGraph, term: string): NetworkSearchResults {
  const q = norm(term);
  if (q.length < 2) return { contacts: [], companies: [], opportunities: [] };
  const contacts = buildContacts(graph).filter(
    (c) => norm(c.display_name).includes(q) || norm(c.company).includes(q) || norm(c.headline).includes(q),
  );
  const companies = buildCompanies(graph).filter((c) => norm(c.name).includes(q));
  const opportunities = graph.opportunities
    .filter((o) => norm(o.card_title).includes(q) || norm(o.card_company).includes(q))
    .map((o) => ({ id: o.id, title: o.card_title ?? "Uten tittel", company: o.card_company ?? null }));
  return {
    contacts: contacts.slice(0, 8),
    companies: companies.slice(0, 8),
    opportunities: opportunities.slice(0, 8),
  };
}

export type NetworkBatchState =
  | "importable"
  | "consumed"
  | "superseded"
  | "none";

/** Nettverksbatch fra LinkedIn-import. Kun lesing — aldri register. */
export function networkBatchQuery(userId: string | undefined) {
  return queryOptions({
    queryKey: ["network", "batch", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const select =
        "id, status, total_count, new_contact_count, exact_identity_match_count, possible_duplicate_count, without_stable_identity_count, observed_profile_change_count, excluded_count, prepared_at, created_at, consumed_at, superseded_at, linkedin_import_id";

      // Nyeste gyldige (ready, ukonsumert) batch er importvinduet.
      const { data: readyBatch, error: readyError } = await supabase
        .from("linkedin_network_reconciliation_batches")
        .select(select)
        .eq("user_id", userId!)
        .eq("status", "ready")
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (readyError) throw readyError;

      // Uten importvindu: vis tilstanden til siste batch uansett status.
      const { data: lastBatch, error: lastError } = readyBatch
        ? { data: null, error: null }
        : await supabase
            .from("linkedin_network_reconciliation_batches")
            .select(select)
            .eq("user_id", userId!)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
      if (lastError) throw lastError;

      const batch = readyBatch ?? lastBatch ?? null;
      if (!batch) {
        return {
          state: "none" as NetworkBatchState,
          batch: null,
          objectKindCounts: {} as Record<string, number>,
          pendingPersonItemIds: [] as string[],
          latestReadyBatchId: null as string | null,
        };
      }

      const state: NetworkBatchState = readyBatch
        ? "importable"
        : batch.consumed_at || batch.status === "consumed"
          ? "consumed"
          : batch.superseded_at || batch.status === "superseded"
            ? "superseded"
            : "none";

      // PostgREST returnerer maks 1000 rader per kall — les batchen sidevis
      // slik at tellingene per objektklasse blir fullstendige.
      const items: Array<{ id: string; category: string; status: string; reason_codes: string[] }> = [];
      const pageSize = 1000;
      for (let offset = 0; offset < 20000; offset += pageSize) {
        const { data: page, error: itemsError } = await supabase
          .from("linkedin_network_reconciliation_batch_items")
          .select("id, category, status, reason_codes")
          .eq("batch_id", batch.id)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (itemsError) throw itemsError;
        items.push(...((page ?? []) as never));
        if (!page || page.length < pageSize) break;
      }

      const objectKindCounts: Record<string, number> = {};
      const pendingPersonItemIds: string[] = [];
      for (const item of items) {
        const kindCode = (item.reason_codes ?? []).find((c: string) => c.startsWith("object_kind:"));
        const kind = kindCode ? kindCode.slice("object_kind:".length) : "ukjent";
        objectKindCounts[kind] = (objectKindCounts[kind] ?? 0) + 1;
        if (kind === "person_contact" && item.category === "new_contact" && item.status === "pending") {
          pendingPersonItemIds.push(item.id);
        }
      }

      return {
        state,
        batch,
        objectKindCounts,
        // Kun en importerbar batch kan gi handlingsbare elementer.
        pendingPersonItemIds: state === "importable" ? pendingPersonItemIds : [],
        latestReadyBatchId: readyBatch?.id ?? null,
      };
    },

  });
}

// ============================================================
// Fase 5B — delt utledningslag for aktiviteter, muligheter og
// oversiktstall. Både statuskortenes tall og de filtrerte listene
// bruker nøyaktig disse funksjonene, slik at de aldri kan divergere.
// ============================================================

export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  oppfolging: "Oppfølging",
  moete: "Møte",
  samtale: "Samtale",
  e_post: "E-post",
  soknad: "Søknad",
  intervju: "Intervju",
  annet: "Annet",
};

export const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  planlagt: "Planlagt",
  pagaar: "Pågår",
  utfort: "Utført",
  avlyst: "Avlyst",
};

/** Kontaktnær aktivitet som gjør en kontakt «varm». Søknadsoppgaver teller ikke. */
const WARM_ACTIVITY_TYPES = new Set(["moete", "samtale", "e_post"]);
const WARM_WINDOW_DAYS = 90;

export type NetworkActivity = {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  priority: string | null;
  status: string;
  activity_type: string;
  activity_scope: string;
  result_note: string | null;
  completed_at: string | null;
  contactId: string | null;
  contactName: string | null;
  companyKey: CompanyKey | null;
  companyName: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  applicationId: string | null;
  applicationTitle: string | null;
  isOpen: boolean;
  isOverdue: boolean;
};

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildActivities(graph: NetworkGraph): NetworkActivity[] {
  const contactById = new Map(graph.contacts.map((c) => [c.id, c]));
  const oppById = new Map(graph.opportunities.map((o) => [o.id, o]));
  const appById = new Map((graph.applications ?? []).map((a) => [a.id, a]));
  const companyNameById = new Map<string, string>();
  for (const rel of graph.userCompanies) {
    if (rel.company_id) companyNameById.set(rel.company_id, rel.companies?.name ?? rel.company_name_user ?? "");
  }
  for (const rel of graph.relations) {
    if (rel.company_id && !companyNameById.get(rel.company_id)) {
      companyNameById.set(rel.company_id, rel.company_name_observed ?? rel.company_name_canonical ?? "");
    }
  }
  const today = todayIso();

  return graph.steps.map((s) => {
    const status = s.status ?? (s.completed ? "utfort" : "planlagt");
    const contact = s.contact_id ? contactById.get(s.contact_id) : null;
    const opp = s.opportunity_id ? oppById.get(s.opportunity_id) : null;
    const app = s.application_id ? appById.get(s.application_id) : null;
    const isOpen = status === "planlagt" || status === "pagaar";
    return {
      id: s.id,
      title: s.title,
      description: s.description ?? null,
      due_date: s.due_date ?? null,
      priority: s.priority ?? null,
      status,
      activity_type: s.activity_type ?? "annet",
      activity_scope: s.activity_scope ?? "context",
      result_note: s.result_note ?? null,
      completed_at: s.completed_at ?? null,
      contactId: s.contact_id ?? null,
      contactName: contact ? (contact.manual_display_name ?? contact.display_name) : null,
      companyKey: s.company_id ?? null,
      companyName: s.company_id ? (companyNameById.get(s.company_id) || null) : null,
      opportunityId: s.opportunity_id ?? null,
      opportunityTitle: opp?.card_title ?? null,
      applicationId: s.application_id ?? null,
      applicationTitle: app ? `${app.role_title ?? "Søknad"} · ${app.company_name ?? ""}`.trim() : null,
      isOpen,
      isOverdue: isOpen && !!s.due_date && s.due_date < today,
    };
  });
}

export type ActivityFilter = {
  tilstand?: "apen" | "utfort" | "alle";
  forfall?: "forfalt" | "kommende" | "alle";
  type?: string;
  prioritet?: string;
  kontakt?: string;
  selskap?: string;
  mulighet?: string;
};

export function filterActivities(activities: NetworkActivity[], f: ActivityFilter): NetworkActivity[] {
  return activities.filter((a) => {
    if ((f.tilstand ?? "apen") === "apen" && !a.isOpen) return false;
    if (f.tilstand === "utfort" && a.status !== "utfort") return false;
    if (f.forfall === "forfalt" && !a.isOverdue) return false;
    if (f.forfall === "kommende" && (a.isOverdue || !a.isOpen)) return false;
    if (f.type && a.activity_type !== f.type) return false;
    if (f.prioritet && a.priority !== f.prioritet) return false;
    if (f.kontakt && a.contactId !== f.kontakt) return false;
    if (f.selskap && a.companyKey !== f.selskap) return false;
    if (f.mulighet && a.opportunityId !== f.mulighet) return false;
    return true;
  });
}

/** Statuskort «Trenger oppfølging» = åpne eller forfalte aktiviteter. */
export function followUpActivities(graph: NetworkGraph): NetworkActivity[] {
  return filterActivities(buildActivities(graph), { tilstand: "apen" });
}

const CLOSED_OPPORTUNITY_STATUSES = new Set([
  "avsluttet",
  "avslag",
  "rejected",
  "closed",
  "withdrawn",
  "trukket",
  "arkivert",
  "archived",
  "declined",
]);

export type NetworkOpportunityItem = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  status: string | null;
  url: string | null;
  isOpen: boolean;
  relevanceScore: number | null;
  matchVersion: string | null;
  matchModel: string | null;
  screeningEvaluatedAt: string | null;
  nextActivity: NetworkActivity | null;
};

export function buildOpportunities(graph: NetworkGraph): NetworkOpportunityItem[] {
  const activities = buildActivities(graph);
  return graph.opportunities.map((o) => {
    const open = !o.status || !CLOSED_OPPORTUNITY_STATUSES.has(String(o.status).toLowerCase());
    const next =
      activities
        .filter((a) => a.opportunityId === o.id && a.isOpen)
        .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))[0] ?? null;
    return {
      id: o.id,
      title: o.card_title ?? "Uten tittel",
      company: o.card_company ?? null,
      location: o.card_location ?? null,
      status: o.status ?? null,
      url: o.card_display_url ?? o.card_raw_url ?? null,
      isOpen: open,
      relevanceScore: o.relevance_score ?? null,
      matchVersion: o.match_score_version ?? null,
      matchModel: o.match_scored_model ?? null,
      screeningEvaluatedAt: o.screening_evaluated_at ?? null,
      nextActivity: next,
    };
  });
}

export function activeOpportunities(graph: NetworkGraph): NetworkOpportunityItem[] {
  return buildOpportunities(graph).filter((o) => o.isOpen);
}

/**
 * Varme kontakter: fullført kontaktnær aktivitet (møte, samtale, e-post)
 * knyttet til kontakten de siste 90 dagene. Fullført søknadsoppgave teller ikke.
 */
export function warmContacts(graph: NetworkGraph): NetworkContactItem[] {
  const cutoff = new Date(Date.now() - WARM_WINDOW_DAYS * 86_400_000).toISOString();
  const warmIds = new Set(
    graph.steps
      .filter(
        (s) =>
          s.contact_id &&
          (s.status ?? (s.completed ? "utfort" : "planlagt")) === "utfort" &&
          WARM_ACTIVITY_TYPES.has(s.activity_type ?? "annet") &&
          (s.completed_at ?? "") >= cutoff,
      )
      .map((s) => s.contact_id as string),
  );
  if (warmIds.size === 0) return [];
  return buildContacts(graph).filter((c) => warmIds.has(c.id));
}

export type InterviewEntry = {
  key: string;
  source: "interviews" | "activity";
  title: string;
  date: string;
  applicationId: string | null;
  opportunityId: string | null;
  activityId: string | null;
};

/**
 * Intervjuer denne måneden fra to kilder. Samme intervju må ikke telles to
 * ganger: rader dedupliseres på felles søknads-/mulighetskobling innenfor
 * samme dato, med `interviews` som foretrukket kilde.
 */
export function interviewsThisMonth(graph: NetworkGraph): InterviewEntry[] {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const inMonth = (d: string | null) => !!d && d >= monthStart && d <= monthEnd;

  const seen = new Set<string>();
  const out: InterviewEntry[] = [];
  const dedupeKey = (appId: string | null, oppId: string | null, date: string) =>
    appId ? `a:${appId}:${date}` : oppId ? `o:${oppId}:${date}` : null;

  const appById = new Map((graph.applications ?? []).map((a) => [a.id, a]));

  for (const iv of graph.interviews ?? []) {
    const date = iv.scheduled_at ? String(iv.scheduled_at).slice(0, 10) : null;
    if (!inMonth(date)) continue;
    const app = iv.application_id ? appById.get(iv.application_id) : null;
    const key = dedupeKey(iv.application_id ?? null, null, date!);
    if (key) seen.add(key);
    out.push({
      key: `interview-${iv.id}`,
      source: "interviews",
      title: app ? `${app.role_title ?? "Intervju"} · ${app.company_name ?? ""}`.trim() : (iv.interview_type ?? "Intervju"),
      date: date!,
      applicationId: iv.application_id ?? null,
      opportunityId: null,
      activityId: null,
    });
  }

  for (const a of buildActivities(graph)) {
    if (a.activity_type !== "intervju" || a.status === "avlyst") continue;
    const date = a.due_date ?? (a.completed_at ? a.completed_at.slice(0, 10) : null);
    if (!inMonth(date)) continue;
    const key = dedupeKey(a.applicationId, a.opportunityId, date!);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push({
      key: `activity-${a.id}`,
      source: "activity",
      title: a.title,
      date: date!,
      applicationId: a.applicationId,
      opportunityId: a.opportunityId,
      activityId: a.id,
    });
  }

  return out.sort((x, y) => x.date.localeCompare(y.date));
}
