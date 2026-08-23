/**
 * Vurdering av arbeidsgivere — søk i arbeidsgiverregisteret og vurder enhver
 * norsk juridisk enhet med verifisert organisasjonsnummer.
 *
 * Frontend leser aldri registertabellene direkte: søk går via RPC
 * `search_employers`, og valg av treff materialiserer kanonisk selskap +
 * vurderingsobjekt via `employer_review_ensure_target_by_orgnr`.
 */
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { searchEmployersQuery, type EmployerSearchRow } from "@/lib/queries/employer-insight";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const ORGNR_RE = /^\d{9}$/;
const RECENT_KEY = "karrierenmin.vurdering.nylig";

type RecentItem = { orgnr: string; navn: string };

type RegisterRow = EmployerSearchRow & {
  organisasjonsform_beskrivelse?: string | null;
  forretningsadresse_poststed?: string | null;
};

export const Route = createFileRoute("/_authenticated/vurdering-av-arbeidsgivere/")({
  component: RouteComponent,
  head: () => ({
    meta: [
      { title: "Vurdering av arbeidsgivere | Karrierenmin" },
      {
        name: "description",
        content:
          "Søk opp en norsk arbeidsgiver med verifisert organisasjonsnummer og del erfaringene dine. Felles vurderinger vises anonymt.",
      },
      { property: "og:title", content: "Vurdering av arbeidsgivere" },
      {
        property: "og:description",
        content:
          "Søk i arbeidsgiverregisteret og gi din vurdering. Felles tall vises først når nok kvalifiserte bidrag finnes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function readRecent(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as RecentItem[]) : [];
    return Array.isArray(parsed) ? parsed.filter((r) => ORGNR_RE.test(r?.orgnr ?? "")).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function RouteComponent() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pendingOrgnr, setPendingOrgnr] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  useEffect(() => setRecent(readRecent()), []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const digits = debounced.replace(/\D/g, "");
  const isOrgnr = ORGNR_RE.test(digits);
  const searchTerm = isOrgnr ? digits : debounced;
  const enabled = isOrgnr || debounced.length >= 3;

  const { data, isFetching, isError, error } = useQuery({
    ...searchEmployersQuery({ q: searchTerm, page: 1, pageSize: 15 }),
    enabled,
  });

  const rows = (data?.rows ?? []) as RegisterRow[];
  const orgnrs = useMemo(
    () => rows.map((r) => r.organisasjonsnummer).filter((o): o is string => ORGNR_RE.test(o ?? "")),
    [rows],
  );

  const { data: statusMap } = useQuery({
    queryKey: ["employer-review-search-status", orgnrs],
    enabled: orgnrs.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: res, error: err } = await supabase.rpc("employer_review_search_status", {
        p_organisasjonsnumre: orgnrs,
      } as never);
      if (err) return {} as Record<string, boolean>;
      const map: Record<string, boolean> = {};
      for (const r of (res ?? []) as { organisasjonsnummer: string; has_public_aggregate: boolean }[]) {
        map[r.organisasjonsnummer] = r.has_public_aggregate;
      }
      return map;
    },
  });

  const openEmployer = async (orgnr: string, navn: string) => {
    if (!ORGNR_RE.test(orgnr)) return;
    setPendingOrgnr(orgnr);
    try {
      const { data: res, error: err } = await supabase.rpc(
        "employer_review_ensure_target_by_orgnr",
        { p_organisasjonsnummer: orgnr } as never,
      );
      if (err) throw err;
      const companyId = (res as { company_id?: string } | null)?.company_id;
      if (!companyId) throw new Error("Fant ikke selskapet");

      const next = [{ orgnr, navn }, ...readRecent().filter((r) => r.orgnr !== orgnr)].slice(0, 5);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* ignorerer utilgjengelig lagring */
      }
      setRecent(next);

      await navigate({
        to: "/vurdering-av-arbeidsgivere/$companyId",
        params: { companyId },
      });
    } catch (e) {
      toast.error(
        e instanceof Error && e.message.includes("employer_not_found")
          ? "Vi fant ikke en verifisert norsk juridisk enhet."
          : "Kunne ikke åpne arbeidsgiveren akkurat nå.",
      );
    } finally {
      setPendingOrgnr(null);
    }
  };

  const showEmpty = enabled && !isFetching && !isError && rows.length === 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-display font-bold tracking-tight">
          Vurdering av arbeidsgivere
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Søk etter en norsk arbeidsgiver med verifisert organisasjonsnummer. Du kan dele erfaringer
          som ansatt, kandidat, kunde eller partner. Felles vurderinger vises anonymt først når nok
          kvalifiserte bidrag finnes.
        </p>
      </header>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Søk etter arbeidsgiver eller organisasjonsnummer"
          aria-label="Søk etter arbeidsgiver eller organisasjonsnummer"
          className="h-11 pl-9"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Minst tre tegn for navnesøk. Organisasjonsnummer kan søkes direkte.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Søkeresultat</CardTitle>
          <CardDescription>
            Velg arbeidsgiveren for å se felles vurdering og gi din egen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!enabled ? (
            <p className="text-sm text-muted-foreground">
              Skriv navnet eller organisasjonsnummeret til arbeidsgiveren du vil vurdere.
            </p>
          ) : isFetching && rows.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Søker…
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive">
              Kunne ikke utføre søket: {error instanceof Error ? error.message : "Ukjent feil"}
            </p>
          ) : showEmpty ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">Vi fant ikke en verifisert norsk juridisk enhet.</p>
              <p className="text-xs text-muted-foreground">
                Kontroller skrivemåten, eller søk med organisasjonsnummer.
              </p>
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((row) => {
                const orgnr = row.organisasjonsnummer ?? "";
                const sted =
                  row.forretningsadresse_kommune ?? row.forretningsadresse_poststed ?? null;
                const harFelles = statusMap?.[orgnr] === true;
                return (
                  <li
                    key={orgnr}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{row.navn}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{orgnr}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[row.organisasjonsform_beskrivelse, sted].filter(Boolean).join(" · ")}
                        {(row.organisasjonsform_beskrivelse || sted) && " · "}
                        {harFelles ? "Felles vurdering tilgjengelig" : "Ingen felles vurdering ennå"}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 self-start sm:self-auto"
                      disabled={pendingOrgnr !== null || !ORGNR_RE.test(orgnr)}
                      onClick={() => void openEmployer(orgnr, row.navn ?? orgnr)}
                    >
                      {pendingOrgnr === orgnr ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Åpner…
                        </>
                      ) : (
                        "Åpne"
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nylig sett eller vurdert</CardTitle>
            <CardDescription>Snarveier til arbeidsgivere du nylig åpnet herfra.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {recent.map((r) => (
                <li key={r.orgnr} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">{r.navn}</span>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-xs tabular-nums text-muted-foreground">{r.orgnr}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pendingOrgnr !== null}
                      onClick={() => void openEmployer(r.orgnr, r.navn)}
                    >
                      Åpne
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
