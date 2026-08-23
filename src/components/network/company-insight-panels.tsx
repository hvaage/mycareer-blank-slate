// ============================================================
// Fase 5G — arbeidsgiverinnsikt og registernøkkeltall på selskapsdetaljen.
//
// Alle data hentes gjennom eksisterende SECURITY DEFINER-RPC-er
// (`get_employer_analysis_view`, `get_employer_detail`). Frontend leser aldri
// registertabellene direkte. Ingen score oppdiktes: manglende dimensjoner
// merkes «Ikke analysert», og manglende regnskapsgrunnlag gir tomtilstand.
// ============================================================
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  EmployerAnalysisSearchDialog,
  type ExistingEmployerMatch,
} from "@/components/employers/EmployerAnalysisSearchDialog";
import { myEmployersQuery } from "@/lib/queries/companies";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { messageFromFunctionInvokeError } from "@/lib/edge-invoke-error";
import { normalizeAiErrorMessage } from "@/lib/ai-ux-messages";
import { NetworkPanel, PanelEmpty } from "@/components/network/panel";
import {
  employerAnalysisViewQuery,
  type EmployerAnalysisDimensionKey,
} from "@/lib/queries/employer-analysis-view";
import { employerDetailQuery } from "@/lib/queries/employer-insight";

/** Hele dimensjonsmodellen. Alle åtte områdene vises alltid. */
const DIMENSIONS: { key: EmployerAnalysisDimensionKey; label: string }[] = [
  { key: "culture", label: "Kultur og verdier" },
  { key: "leadership", label: "Ledelseskvalitet" },
  { key: "work_environment", label: "Arbeidsmiljø" },
  { key: "career_development", label: "Karriereutvikling" },
  { key: "financial_stability", label: "Finansiell stabilitet" },
  { key: "mission", label: "Misjon og formål" },
  { key: "diversity_inclusion", label: "Mangfold og inkludering" },
  { key: "talent_attraction_retention", label: "Rekruttering og retensjon" },
];

const SOURCE_KIND_LABEL: Record<string, string> = {
  brreg_local_mirror: "Enhets- og regnskapsregisteret",
  official_web_fallback: "Offentlig publisert årsregnskap",
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nb-NO", { day: "2-digit", month: "long", year: "numeric" });
}

function formatAmount(value: number | null | undefined, currency: string): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function formatScore(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 }).format(value);
}

const ORGNR_RE = /^[0-9]{9}$/;

/**
 * Eksplisitt brukerhandling: starter en reell arbeidsgiveranalyse via
 * edge-funksjonen `analyze-company`.
 *
 * Mangler selskapet organisasjonsnummer, startes ingenting: brukeren får samme
 * søke- og bekreftelsesdialog som under Marked → Arbeidsgivere, forhåndsutfylt
 * med selskapsnavnet, og analysen kjøres først på et validert orgnr.
 */
function StartAnalysisButton({
  companyId,
  companyName,
  orgnr,
  label,
  onOrgnrSelected,
}: {
  companyId?: string | null;
  companyName?: string | null;
  orgnr?: string | null;
  label: string;
  onOrgnrSelected?: (orgnr: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const hasOrgnr = Boolean(orgnr && ORGNR_RE.test(orgnr));
  const canStart = Boolean(companyId || hasOrgnr || (companyName && companyName.trim()));

  const employers = useQuery({ ...myEmployersQuery(), enabled: dialogOpen });
  const existingByOrgnr = useMemo(() => {
    const m = new Map<string, ExistingEmployerMatch>();
    (employers.data?.employers ?? []).forEach((e: { id: string; name?: string | null; organisasjonsnummer?: string | null }) => {
      if (e.organisasjonsnummer && ORGNR_RE.test(e.organisasjonsnummer)) {
        m.set(e.organisasjonsnummer, { id: e.id, name: e.name ?? "" });
      }
    });
    return m;
  }, [employers.data]);

  const start = useMutation({
    mutationFn: async (chosenOrgnr?: string) => {
      const uid = user?.id;
      if (!uid) throw new Error("Du må være innlogget for å starte en analyse.");
      const body: Record<string, unknown> = { user_id: uid, force: true };
      if (chosenOrgnr) {
        if (!ORGNR_RE.test(chosenOrgnr)) throw new Error("Ugyldig organisasjonsnummer");
        body.organisasjonsnummer = chosenOrgnr;
      } else {
        if (companyId) body.company_id = companyId;
        if (orgnr) body.organisasjonsnummer = orgnr;
        if (!companyId && companyName) body.name = companyName.trim();
      }
      const { data, error } = await supabase.functions.invoke("analyze-company", { body });
      if (error) throw new Error(await messageFromFunctionInvokeError(error, data));
      const res = data as { error?: unknown; message?: string } | null;
      if (res?.error) {
        throw new Error(
          normalizeAiErrorMessage(res.message ?? String(res.error), { kind: "analysis" }),
        );
      }
      return res;
    },
    onSuccess: () => {
      toast.success("Arbeidsgiveranalyse startet", {
        description: "Analysen kjører i bakgrunnen. Panelet oppdateres når den er ferdig.",
      });
      qc.invalidateQueries({ queryKey: ["employer-analysis-view"] });
      if (companyId) qc.invalidateQueries({ queryKey: ["company", companyId] });
    },
    onError: (err: unknown) => {
      toast.error(
        normalizeAiErrorMessage(err instanceof Error ? err.message : undefined, {
          kind: "analysis",
        }),
      );
    },
  });

  if (!canStart) return null;

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        onClick={() => (hasOrgnr ? start.mutate(undefined) : setDialogOpen(true))}
        disabled={start.isPending || !user?.id}
      >
        {start.isPending ? "Starter analyse…" : label}
      </Button>
      <p className="text-xs text-muted-foreground">
        {hasOrgnr
          ? "Analysen er KI-generert og bygger på åpne, offentlige kilder."
          : "Du velger og bekrefter riktig juridisk enhet før analysen starter."}
      </p>

      <EmployerAnalysisSearchDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialQuery={companyName ?? null}
        existingByOrgnr={existingByOrgnr}
        isPending={start.isPending}
        onAnalyzeConfirmed={async (row) => {
          const chosen = row.organisasjonsnummer ?? "";
          await start.mutateAsync(chosen);
          onOrgnrSelected?.(chosen);
          setDialogOpen(false);
        }}
        onOpenExisting={(cid) => {
          setDialogOpen(false);
          navigate({ to: "/employers/$companyId", params: { companyId: cid } });
        }}
      />
    </div>
  );
}

export function CompanyInsightPanel({
  orgnr,
  companyId = null,
  companyName = null,
}: {
  orgnr: string | null;
  companyId?: string | null;
  companyName?: string | null;
}) {
  const { user } = useAuth();
  const analysis = useQuery(employerAnalysisViewQuery(orgnr, user?.id ?? "anon"));
  const detail = useQuery({ ...employerDetailQuery(orgnr ?? ""), enabled: Boolean(orgnr) });

  if (!orgnr) {
    return (
      <NetworkPanel title="Arbeidsgiverinnsikt">
        <PanelEmpty>
          Selskapet er ikke koblet til et organisasjonsnummer, så det finnes ikke noe
          analysegrunnlag å vise ennå.
        </PanelEmpty>
        <div className="mt-3">
          <StartAnalysisButton
            companyId={companyId}
            companyName={companyName}
            orgnr={null}
            label="Start arbeidsgiveranalyse"
          />
        </div>
      </NetworkPanel>
    );
  }

  if (analysis.isPending) {
    return (
      <NetworkPanel title="Arbeidsgiverinnsikt">
        <p className="text-sm text-muted-foreground">Henter arbeidsgiveranalyse…</p>
      </NetworkPanel>
    );
  }

  const envelope = analysis.data ?? null;
  const report = envelope?.analysis ?? null;
  const ratedAt = formatDate(envelope?.company?.analysis_rated_at ?? null);

  if (analysis.isError || !report || !envelope?.company?.analysis_rated_at) {
    return (
      <NetworkPanel title="Arbeidsgiverinnsikt">
        <PanelEmpty>
          Ikke analysert ennå. Her vises kun reelle analyseresultater for selskapet.
        </PanelEmpty>
        <div className="mt-3">
          <StartAnalysisButton
            companyId={companyId}
            companyName={companyName}
            orgnr={orgnr}
            label="Start arbeidsgiveranalyse"
          />
        </div>
      </NetworkPanel>
    );
  }

  const byKey = new Map(report.dimensions.map((d) => [String(d.key), d]));
  const detailRow = detail.data?.kind === "ok" ? detail.data.data : null;
  const userScores: { label: string; score: number | null | undefined }[] = detailRow
    ? [
        { label: "Samlet", score: detailRow.agg_overall_score },
        { label: "Kultur og verdier", score: detailRow.agg_culture_score },
        { label: "Ledelseskvalitet", score: detailRow.agg_leadership_score },
        { label: "Arbeidsmiljø", score: detailRow.agg_work_environment_score },
        { label: "Karriereutvikling", score: detailRow.agg_career_development_score },
        { label: "Finansiell stabilitet", score: detailRow.agg_financial_stability_score },
        { label: "Misjon og formål", score: detailRow.agg_mission_score },
      ].filter((r) => r.score != null)
    : [];
  const ratingCount = detailRow?.agg_rating_count ?? 0;

  return (
    <NetworkPanel title="Arbeidsgiverinnsikt">
      <div className="space-y-3">
        <div className="rounded-md border border-dashed border-border bg-muted/20 p-2">
          <p className="text-xs font-medium">KI-generert vurdering</p>
          <p className="text-xs text-muted-foreground">
            {[
              ratedAt ? `Analysert ${ratedAt}` : null,
              envelope.financials?.source_kind
                ? `Kilde: ${SOURCE_KIND_LABEL[envelope.financials.source_kind] ?? envelope.financials.source_kind}`
                : "Kilde: åpne, offentlige kilder",
              `Brukervurderinger: ${ratingCount}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <dl className="space-y-1">
          <div className="flex gap-2 text-sm">
            <dt className="w-44 shrink-0 text-muted-foreground">Samlet KI-score</dt>
            <dd>{formatScore(report.overall?.score) ?? "Ikke analysert"}</dd>
          </div>
          {DIMENSIONS.map(({ key, label }) => {
            const dim = byKey.get(key);
            const score = formatScore(dim?.score);
            return (
              <div key={key} className="flex gap-2 text-sm">
                <dt className="w-44 shrink-0 text-muted-foreground">{dim?.label ?? label}</dt>
                <dd className={score ? "" : "text-muted-foreground"}>
                  {score ?? "Ikke analysert"}
                </dd>
              </div>
            );
          })}
        </dl>

        <div className="border-t border-border pt-2">
          <p className="text-xs font-medium">Vurderinger fra brukere</p>
          {userScores.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Ingen brukervurderinger er registrert på selskapet.
            </p>
          ) : (
            <dl className="mt-1 space-y-1">
              {userScores.map((r) => (
                <div key={r.label} className="flex gap-2 text-sm">
                  <dt className="w-44 shrink-0 text-muted-foreground">{r.label}</dt>
                  <dd>{formatScore(r.score)}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Brukervurderinger er selvrapporterte og holdes adskilt fra KI-scoren.
          </p>
        </div>

        <div className="border-t border-border pt-2">
          <StartAnalysisButton
            companyId={companyId}
            companyName={companyName}
            orgnr={orgnr}
            label="Oppdater arbeidsgiveranalyse"
          />
        </div>
      </div>
    </NetworkPanel>
  );
}

export function CompanyRegisterPanel({ orgnr }: { orgnr: string | null }) {
  const { user } = useAuth();
  const analysis = useQuery(employerAnalysisViewQuery(orgnr, user?.id ?? "anon"));
  const detail = useQuery({ ...employerDetailQuery(orgnr ?? ""), enabled: Boolean(orgnr) });

  const empty = (
    <NetworkPanel title="Registerdata og nøkkeltall">
      <PanelEmpty>
        Regnskapstall er ikke tilgjengelig ennå. Selskapet mangler enten kobling til
        organisasjonsnummer, eller det finnes ikke et innsendt regnskap i registeret.
      </PanelEmpty>
    </NetworkPanel>
  );

  if (!orgnr) return empty;
  if (analysis.isPending && detail.isPending) {
    return (
      <NetworkPanel title="Registerdata og nøkkeltall">
        <p className="text-sm text-muted-foreground">Henter registerdata…</p>
      </NetworkPanel>
    );
  }

  const fin = analysis.data?.financials ?? null;
  const detailRow = detail.data?.kind === "ok" ? detail.data.data : null;

  const year = fin?.fiscal_year ?? detailRow?.regnskapsaar ?? null;
  const currency = fin?.currency ?? detailRow?.valuta ?? null;
  // Beløp uten år eller valuta er ikke sammenlignbare nøkkeltall.
  if (!year || !currency) return empty;

  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: number | null | undefined) => {
    const formatted = formatAmount(value, currency);
    if (formatted) rows.push({ label, value: formatted });
  };
  push("Driftsinntekter", fin?.revenue_latest ?? detailRow?.driftsinntekter);
  push("Driftsresultat", fin?.operating_result_latest ?? detailRow?.driftsresultat);
  push("Årsresultat", fin?.profit_latest ?? detailRow?.aarsresultat);
  push("Sum eiendeler", fin?.assets_latest ?? detailRow?.sum_eiendeler);
  push("Egenkapital", fin?.equity_latest ?? detailRow?.sum_egenkapital);
  push("Gjeld", fin?.debt_latest ?? detailRow?.sum_gjeld);

  if (rows.length === 0) return empty;

  const regnskapstype = detailRow?.regnskapstype ?? null;
  const sourceLabel = fin?.source_kind
    ? (SOURCE_KIND_LABEL[fin.source_kind] ?? fin.source_kind)
    : "Enhets- og regnskapsregisteret";
  const updatedAt =
    formatDate(fin?.source_updated_at ?? detailRow?.regnskap_last_success_at ?? null) ?? null;

  return (
    <NetworkPanel title="Registerdata og nøkkeltall">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {[
            `Regnskapsår ${year}`,
            `Valuta ${currency}`,
            regnskapstype ? `Regnskapstype ${regnskapstype}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <dl className="space-y-1">
          {rows.map((r) => (
            <div key={r.label} className="flex gap-2 text-sm">
              <dt className="w-44 shrink-0 text-muted-foreground">{r.label}</dt>
              <dd className="tabular-nums">{r.value}</dd>
            </div>
          ))}
          {detailRow?.antall_ansatte != null ? (
            <div className="flex gap-2 text-sm">
              <dt className="w-44 shrink-0 text-muted-foreground">Antall ansatte</dt>
              <dd className="tabular-nums">{detailRow.antall_ansatte}</dd>
            </div>
          ) : null}
        </dl>
        <p className="text-xs text-muted-foreground">
          Kilde: {sourceLabel}
          {updatedAt ? ` · hentet ${updatedAt}` : ""} · organisasjonsnummer {orgnr}
        </p>
      </div>
    </NetworkPanel>
  );
}
