// @ts-nocheck
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startApplicationFromPosting } from "@/lib/network.functions";

/**
 * Kontrollert brukerhandling: gjør en jobbannonse om til én mulighet i
 * Nettverksarbeid. Idempotent — samme annonse gir aldri to muligheter.
 */
export function StartApplicationButton({
  canonicalOpportunityId,
  className,
}: {
  canonicalOpportunityId: string | null | undefined;
  className?: string;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const startFn = useServerFn(startApplicationFromPosting);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await startFn({ data: { canonicalOpportunityId } });
      if (!res?.ok || !res.opportunityId) throw new Error(res?.errorCode ?? "write_failed");
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["network"] });
      toast.success(res.created ? "Muligheten er opprettet." : "Du har allerede en mulighet for denne annonsen.");
      navigate({ to: "/nettverk/muligheter/$id", params: { id: res.opportunityId } });
    },
    onError: (e: any) => toast.error(`Kunne ikke starte søknadsarbeidet (${e?.message ?? "ukjent feil"}).`),
  });

  if (!canonicalOpportunityId) return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      className={className ?? "h-9"}
      disabled={mutation.isPending}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        mutation.mutate();
      }}
    >
      <Briefcase className="mr-1 h-4 w-4" /> Start søknadsarbeid
    </Button>
  );
}
