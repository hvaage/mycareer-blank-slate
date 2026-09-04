// @ts-nocheck
/**
 * Samlet kø for «Til gjennomgang» på dashboardet.
 *
 * Ett sted teller alt som venter på et valg fra brukeren, uansett hvilken
 * modul det oppsto i. Nye køer legges til i PENDING_QUEUES — ingen andre
 * steder. Hver kø må ha en lenke til stedet den behandles.
 *
 * Kun tellinger hentes (head-spørringer), aldri hele datasett.
 */
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type PendingQueueKey =
  | "cv"
  | "ai"
  | "kilder"
  | "nettverk_import"
  | "selskap_avstemming"
  | "aktivitetsforslag"
  | "jobb_leads"
  | "muligheter"
  | "onsker"
  | "maal";

export type PendingItem = {
  key: PendingQueueKey;
  count: number;
  /** Kort setning: hva som venter. */
  label: string;
  /** Hvorfor det betyr noe. */
  detail: string;
  to: string;
  /** Høyere tall = viktigere. Styrer rekkefølgen. */
  weight: number;
};

type QueueDef = {
  key: PendingQueueKey;
  to: string;
  weight: number;
  label: (n: number) => string;
  detail: string;
  count: (userId: string) => Promise<number>;
};

const headCount = async (build: () => any): Promise<number> => {
  const { count, error } = await build();
  if (error) throw error;
  return count ?? 0;
};

const PENDING_QUEUES: QueueDef[] = [
  {
    key: "cv",
    to: "/forslag/cv",
    weight: 90,
    label: (n) => `${n} linjer fra CV-importen`,
    detail: "Ingenting teller som grunnlag før du har sett gjennom dem.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("cv_parse_candidates")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "ubehandlet"),
      ),
  },
  {
    key: "ai",
    to: "/forslag/ai",
    weight: 70,
    label: (n) => `${n} KI-forslag til profilen`,
    detail: "Forslag fra KI lagres ikke før du har godkjent dem.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("atom_enrichment_proposals")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "pending_review"),
      ),
  },
  {
    key: "kilder",
    to: "/kildegjennomgang",
    weight: 85,
    label: (n) => `${n} forslag fra LinkedIn-importen`,
    detail: "Avstemming mot det du allerede har registrert. Du bestemmer hva som beholdes.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("linkedin_reconciliation_proposals")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", ["pending_review", "needs_resolution", "approved_for_promotion"]),
      ),
  },
  {
    key: "nettverk_import",
    to: "/nettverk/kontakter/import",
    weight: 65,
    label: (n) => `${n} nye kontakter klare til import`,
    detail: "Kontaktene legges ikke inn i nettverket før du starter importen.",
    count: async (userId) => {
      const { data, error } = await supabase
        .from("linkedin_network_reconciliation_batches")
        .select("new_contact_count")
        .eq("user_id", userId)
        .eq("status", "ready")
        .is("consumed_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return Number(data?.new_contact_count ?? 0);
    },
  },
  {
    key: "selskap_avstemming",
    to: "/nettverk/selskaper/avstemming",
    weight: 55,
    label: (n) => `${n} selskaper venter på bekreftet organisasjonsnummer`,
    detail: "Uten kobling til registeret får du ikke arbeidsgiverinnsikt for selskapet.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("network_company_reconciliation")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .is("superseded_at", null)
          .in("state", ["suggested_exact", "suggested_possible"]),
      ),
  },
  {
    key: "aktivitetsforslag",
    to: "/nettverk/aktiviteter",
    weight: 60,
    label: (n) => `${n} aktivitetsforslag i nettverksarbeidet`,
    detail: "KI foreslår neste steg. Ingenting opprettes eller sendes uten at du sier ja.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("network_activity_suggestions")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "pending_review"),
      ),
  },
  {
    key: "jobb_leads",
    to: "/job-leads",
    weight: 75,
    label: (n) => `${n} jobb-leads fra e-post`,
    detail: "Stillinger hentet inn fra e-post som ikke er vurdert ennå.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("job_leads")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .in("status", ["ny", "new"]),
      ),
  },
  {
    key: "muligheter",
    to: "/job-leads",
    weight: 50,
    label: (n) => `${n} nye stillinger å ta stilling til`,
    detail: "Matchet mot grunnlaget ditt. Velg hvilke du vil følge opp.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("user_opportunities")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("status", "new")
          .or("screening_status.is.null,screening_status.neq.excluded"),
      ),
  },
  {
    key: "onsker",
    to: "/preferences",
    weight: 40,
    label: (n) => `${n} ønsker er eldre enn ferskhetsgrensen`,
    detail: "Gamle ønsker styrer matchingen til du bekrefter eller endrer dem.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("career_atoms")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true)
          .in("atom_kind", ["onske", "verdi"])
          .not("stale_at", "is", null)
          .lt("stale_at", new Date().toISOString()),
      ),
  },
  {
    key: "maal",
    to: "/preferences",
    weight: 45,
    label: (n) => `${n} mål har passert fristen`,
    detail: "Lukk målet, flytt fristen eller la det gå videre.",
    count: (userId) =>
      headCount(() =>
        supabase
          .from("career_atoms")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("is_active", true)
          .eq("atom_kind", "maal")
          .in("state", ["planlagt", "i_arbeid"])
          .not("due_at", "is", null)
          .lt("due_at", new Date().toISOString()),
      ),
  },
];

export type PendingOverview = {
  items: PendingItem[];
  total: number;
};

/** Alle ventende gjennomganger på tvers av modulene, sortert etter viktighet. */
export const pendingOverviewQuery = (userId: string) =>
  queryOptions({
    queryKey: ["dashboard-pending", userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async (): Promise<PendingOverview> => {
      const counts = await Promise.all(
        PENDING_QUEUES.map((q) => q.count(userId).catch(() => 0)),
      );
      const items = PENDING_QUEUES.map((q, i) => ({
        key: q.key,
        count: counts[i] ?? 0,
        label: q.label(counts[i] ?? 0),
        detail: q.detail,
        to: q.to,
        weight: q.weight,
      }))
        .filter((i) => i.count > 0)
        .sort((a, b) => b.weight - a.weight);
      return { items, total: items.reduce((sum, i) => sum + i.count, 0) };
    },
  });
