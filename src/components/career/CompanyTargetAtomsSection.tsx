import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  companyProfileAtomsQuery,
  companySignalAtomsQuery,
  refreshCompanyAtomsMutation,
} from "@/lib/queries/target-atoms";
import { extractCompanyProfileAtoms, extractCompanySignalAtoms } from "@/lib/target-atom-extraction";
import type { CompanyAtomRefreshInput } from "@/lib/company-atom-refresh-select";
import { companyProfileLabelNb, companySignalLabelNb } from "@/lib/target-atoms";

type Props = {
  companyId: string;
  company: CompanyAtomRefreshInput;
};

export function CompanyTargetAtomsSection({ companyId, company }: Props) {
  const qc = useQueryClient();
  const { data: profileAtoms = [], isLoading: lp } = useQuery(companyProfileAtomsQuery(companyId));
  const { data: signalAtoms = [], isLoading: ls } = useQuery(companySignalAtomsQuery(companyId));

  const refresh = useMutation({
    ...refreshCompanyAtomsMutation(qc, companyId),
    onSuccess: (r) => {
      toast.success(`Mål-atomer oppdatert (${r.upserted} rader, ${r.deactivated} deaktivert).`);
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere"),
  });

  const fallbackProfile = extractCompanyProfileAtoms(company);
  const fallbackSignals = extractCompanySignalAtoms(company);

  const showProfile = profileAtoms.length > 0 ? profileAtoms : null;
  const showSignals = signalAtoms.length > 0 ? signalAtoms : null;

  return (
    <Card className="border-dashed border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base">Selskapssignaler</CardTitle>
            <CardDescription className="text-xs">
              Strukturerte mål-atomer fra lagret selskapsdata (uten ny AI). Trykk «Oppdater atomer» for å skrive til
              databasen; ellers vises heuristikk fra tilgjengelig tekst.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={refresh.isPending || lp || ls}
            onClick={() => refresh.mutate()}
          >
            {refresh.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2">Oppdater atomer</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <div>
          <p className="font-medium text-foreground/90 mb-1.5">Profil (stabile trekk)</p>
          <div className="flex flex-wrap gap-1.5">
            {(showProfile ?? fallbackProfile.slice(0, 12)).map((a, i) => {
              const key = "id" in a && a.id ? a.id : `${a.source_hash}-${i}`;
              const text =
                typeof (a as { label?: string | null }).label === "string" &&
                String((a as { label?: string | null }).label).trim()
                  ? String((a as { label: string }).label)
                  : companyProfileLabelNb(a.category);
              return (
                <Badge key={key} variant="secondary" className="text-[10px] font-normal">
                  {text}
                </Badge>
              );
            })}
            {!showProfile && !fallbackProfile.length && <span className="text-muted-foreground">Ingen trekk funnet ennå.</span>}
          </div>
        </div>
        <div>
          <p className="font-medium text-foreground/90 mb-1.5">Operative signaler</p>
          <div className="flex flex-wrap gap-1.5">
            {(showSignals ?? fallbackSignals.slice(0, 10)).map((a, i) => {
              const key = "id" in a && a.id ? a.id : `${a.source_hash}-${i}`;
              const text =
                typeof (a as { label?: string | null }).label === "string" &&
                String((a as { label?: string | null }).label).trim()
                  ? String((a as { label: string }).label)
                  : companySignalLabelNb(a.signal_type);
              return (
                <Badge key={key} variant="outline" className="text-[10px] font-normal">
                  {text}
                </Badge>
              );
            })}
            {!showSignals && !fallbackSignals.length && <span className="text-muted-foreground">Ingen signaler funnet.</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
