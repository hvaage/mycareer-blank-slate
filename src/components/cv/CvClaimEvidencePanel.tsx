// Gjennomgang av påstandene i et CV-utkast.
//
// Ingenting kan godkjennes eller eksporteres så lenge en påstand mangler
// dekning. Brukeren kan enten bekrefte opplysningen som sin egen, be om en
// omskriving, legge til dokumentasjon, eller fjerne formuleringen.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  attestClaim,
  getClaimEvidence,
  withdrawClaimAttestation,
} from "@/lib/cv-claim-evidence.functions";
import {
  CLAIM_REVIEW_ACTION_TEXT,
  EVIDENCE_STATUS_TEXT,
  type ClaimEvidence,
  type ClaimReviewAction,
} from "@/lib/cv-skills-contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Props = {
  documentId: string;
  onRequestRewrite?: (claim: ClaimEvidence) => void;
  onAddDocumentation?: (claim: ClaimEvidence) => void;
  onRemoveClaim?: (claim: ClaimEvidence) => void;
};

export function CvClaimEvidencePanel({
  documentId,
  onRequestRewrite,
  onAddDocumentation,
  onRemoveClaim,
}: Props) {
  const queryClient = useQueryClient();
  const fetchEvidence = useServerFn(getClaimEvidence);
  const attest = useServerFn(attestClaim);
  const withdraw = useServerFn(withdrawClaimAttestation);
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceYear, setSourceYear] = useState("");

  const queryKey = ["cv-claim-evidence", documentId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => fetchEvidence({ data: { documentId } }),
  });

  const attestMutation = useMutation({
    mutationFn: (claimId: string) =>
      attest({
        data: {
          documentId,
          claimId,
          note: note.trim() === "" ? null : note.trim(),
          externalSourceName: sourceName.trim() === "" ? null : sourceName.trim(),
          externalSourceYear: sourceYear.trim() === "" ? null : Number(sourceYear.trim()),
          externalDocumentAvailable: false,
        },
      }),
    onSuccess: (report) => {
      queryClient.setQueryData(queryKey, report);
      setOpenClaimId(null);
      setNote("");
      setSourceName("");
      setSourceYear("");
      toast.success("Opplysningen er registrert som din egen bekreftelse.");
    },
    onError: () => toast.error("Kunne ikke lagre bekreftelsen."),
  });

  const withdrawMutation = useMutation({
    mutationFn: (claimId: string) => withdraw({ data: { documentId, claimId, reason: null } }),
    onSuccess: (report) => {
      queryClient.setQueryData(queryKey, report);
      toast.success("Bekreftelsen er trukket.");
    },
    onError: () => toast.error("Kunne ikke trekke bekreftelsen."),
  });

  if (isLoading || !data) {
    return <p className="text-sm text-muted-foreground">Henter påstandene …</p>;
  }

  const coverage = data.documentedCoverage;

  const runAction = (action: ClaimReviewAction, claim: ClaimEvidence) => {
    if (action === "attest") {
      setOpenClaimId(claim.claimId === openClaimId ? null : claim.claimId);
      return;
    }
    if (action === "rewrite") onRequestRewrite?.(claim);
    if (action === "add_documentation") onAddDocumentation?.(claim);
    if (action === "remove") onRemoveClaim?.(claim);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Grunnlag for teksten</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-sm">
          <Badge variant="secondary">Dokumentert: {coverage.documented}</Badge>
          <Badge variant="secondary">Bekreftet av deg: {coverage.user_attested}</Badge>
          <Badge variant="outline">Delvis dekket: {coverage.partially_supported}</Badge>
          <Badge variant="outline">Uten dekning: {coverage.unsupported}</Badge>
          <Badge variant="destructive">Strider mot grunnlaget: {coverage.contradicted}</Badge>
        </CardContent>
      </Card>

      {!data.canApprove && (
        <Alert variant="destructive">
          <AlertTitle>Kan ikke godkjennes ennå</AlertTitle>
          <AlertDescription>
            {data.blockingClaimIds.length} formulering(er) mangler dekning. Bekreft, omskriv,
            dokumenter eller fjern dem før CV-en kan brukes.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-3">
        {data.claims
          .filter((c) => c.approvalBlocking || c.evidenceStatus === "user_attested")
          .map((claim) => (
            <Card key={claim.claimId}>
              <CardContent className="space-y-3 pt-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm">{claim.value}</p>
                  <Badge variant={claim.approvalBlocking ? "outline" : "secondary"}>
                    {EVIDENCE_STATUS_TEXT[claim.evidenceStatus]}
                  </Badge>
                </div>

                {claim.userAttestation?.valid && (
                  <p className="text-xs text-muted-foreground">
                    Bekreftet av deg{" "}
                    {new Date(claim.userAttestation.attestedAt).toLocaleDateString("nb-NO")}
                    {claim.userAttestation.externalSourceName
                      ? ` — kilde: ${claim.userAttestation.externalSourceName}`
                      : ""}
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  {claim.availableActions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant={action === "attest" ? "default" : "outline"}
                      onClick={() => runAction(action, claim)}
                    >
                      {CLAIM_REVIEW_ACTION_TEXT[action]}
                    </Button>
                  ))}
                  {claim.userAttestation?.valid && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => withdrawMutation.mutate(claim.claimId)}
                    >
                      Trekk bekreftelsen
                    </Button>
                  )}
                </div>

                {openClaimId === claim.claimId && (
                  <div className="space-y-3 rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">
                      Du står selv inne for opplysningen. Den merkes som bekreftet av deg, ikke som
                      dokumentert. Endrer du teksten senere, må du bekrefte på nytt.
                    </p>
                    <div className="space-y-1">
                      <Label htmlFor={`note-${claim.claimId}`}>Kort begrunnelse</Label>
                      <Textarea
                        id={`note-${claim.claimId}`}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`src-${claim.claimId}`}>Kilde (valgfritt)</Label>
                        <Input
                          id={`src-${claim.claimId}`}
                          value={sourceName}
                          onChange={(e) => setSourceName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`year-${claim.claimId}`}>År (valgfritt)</Label>
                        <Input
                          id={`year-${claim.claimId}`}
                          inputMode="numeric"
                          value={sourceYear}
                          onChange={(e) => setSourceYear(e.target.value.replace(/\D/g, ""))}
                        />
                      </div>
                    </div>
                    <Button
                      size="sm"
                      disabled={attestMutation.isPending}
                      onClick={() => attestMutation.mutate(claim.claimId)}
                    >
                      Bekreft som egen opplysning
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
      </div>
    </div>
  );
}
