/**
 * Vurdering av arbeidsgivere — inngang til å vurdere verifiserte arbeidsgivere.
 * Kun arbeidsgivere med verifisert organisasjonsnummer kan vurderes.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search } from "lucide-react";
import { myEmployersQuery } from "@/lib/queries/companies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/vurdering-av-arbeidsgivere/")({
  component: RouteComponent,
  head: () => ({
    meta: [
      { title: "Vurdering av arbeidsgivere | Karrierenmin" },
      {
        name: "description",
        content:
          "Vurder arbeidsgivere du har erfaring med. Felles tall vises anonymisert og først over personverntersklene.",
      },
      { property: "og:title", content: "Vurdering av arbeidsgivere" },
      {
        property: "og:description",
        content:
          "Gi din vurdering av verifiserte arbeidsgivere og se anonymiserte felles vurderinger.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function RouteComponent() {
  const { data, isPending } = useQuery(myEmployersQuery());
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = (data?.employers ?? []).filter((e) =>
      /^\d{9}$/.test(String((e as { organisasjonsnummer?: string | null }).organisasjonsnummer ?? "")),
    );
    if (!q.trim()) return list;
    const needle = q.trim().toLowerCase();
    return list.filter((e) => (e.name ?? "").toLowerCase().includes(needle));
  }, [data, q]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-display font-bold tracking-tight">
          Vurdering av arbeidsgivere
        </h1>
        <p className="text-sm text-muted-foreground">
          Du kan vurdere arbeidsgivere med verifisert organisasjonsnummer. Felles vurderinger vises
          anonymisert, og først når nok kvalifiserte bidragsytere har svart.
        </p>
      </header>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk etter arbeidsgiver"
          className="pl-9"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Verifiserte arbeidsgivere</CardTitle>
          <CardDescription>
            Velg en arbeidsgiver for å se felles vurdering og gi din egen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ingen arbeidsgivere med verifisert organisasjonsnummer ennå.
            </p>
          ) : (
            <ul className="divide-y">
              {rows.map((e) => (
                <li key={e.id}>
                  <Link
                    to="/employers/$companyId"
                    params={{ companyId: e.id }}
                    className="flex items-center gap-3 px-1 py-3 hover:bg-accent/40"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-medium truncate">{e.name}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {(e as { organisasjonsnummer?: string | null }).organisasjonsnummer}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
