// @ts-nocheck
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type QKey = "q1_acknowledgment" | "q2_communication" | "q3_respect" | "q4_feedback" | "q5_kept_promises" | "q6_would_recommend";

const QUESTIONS: Array<{ key: QKey; label: string; hint: string }> = [
  {
    key: "q1_acknowledgment",
    label: "Bekreftet de mottak av søknaden raskt og tydelig?",
    hint: "1 = ingen bekreftelse · 5 = umiddelbar og tydelig",
  },
  {
    key: "q2_communication",
    label: "Var kommunikasjonen gjennom prosessen ryddig og forutsigbar?",
    hint: "1 = hørte aldri noe · 5 = ryddig og forutsigbar",
  },
  {
    key: "q3_respect",
    label: "Behandlet rekrutterer/leder deg respektfullt og profesjonelt?",
    hint: "1 = svært dårlig · 5 = svært profesjonelt",
  },
  {
    key: "q4_feedback",
    label: "Fikk du konstruktiv tilbakemelding (uavhengig av utfall)?",
    hint: "1 = ikke svar · 2 = kun «autogenererte» svar · 5 = konstruktiv tilbakemelding",
  },
  {
    key: "q5_kept_promises",
    label: "Holdt selskapet avtaler om tidslinjer og neste steg?",
    hint: "1 = aldri · 5 = alltid",
  },
  {
    key: "q6_would_recommend",
    label: "Vil du anbefale selskapet som arbeidsgiver til andre ut fra din totale opplevelse av selskapets søknadsprosess?",
    hint: "1 = absolutt ikke · 5 = absolutt",
  },
];

export function ProcessRatingDialog({
  open,
  onOpenChange,
  applicationId,
  companyId,
  companyName,
  onSubmitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  applicationId: string;
  companyId: string | null;
  companyName?: string;
  onSubmitted?: () => void;
}) {
  const [scores, setScores] = useState<Record<QKey, number>>({
    q1_acknowledgment: 3,
    q2_communication: 3,
    q3_respect: 3,
    q4_feedback: 3,
    q5_kept_promises: 3,
    q6_would_recommend: 3,
  });
  const [comments, setComments] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error("Ikke innlogget");

      const payload: any = {
        user_id: uid,
        application_id: applicationId,
        company_id: companyId,
        ...scores,
        comments: comments.trim() || null,
      };
      const { error } = await (supabase.from("application_process_ratings") as any)
        .upsert(payload, { onConflict: "user_id,application_id" });
      if (error) throw error;

      if (companyId) {
        await supabase.rpc("refresh_company_process_aggregate" as any, {
          p_company_id: companyId,
        });
      }

      toast.success("Takk for vurderingen!");
      onSubmitted?.();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Kunne ikke lagre vurdering");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vurder søknadsprosessen</DialogTitle>
          <DialogDescription>
            Hvordan opplevde du å bli behandlet av {companyName ?? "selskapet"}? Dine svar
            samles anonymt på tvers av brukere og hjelper andre.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {QUESTIONS.map((q) => (
            <div key={q.key} className="space-y-2">
              <div className="flex items-start justify-between gap-3">
                <Label className="text-sm leading-snug">{q.label}</Label>
                <span className="text-sm tabular-nums font-medium shrink-0">
                  {scores[q.key].toFixed(0)} / 5
                </span>
              </div>
              <Slider
                value={[scores[q.key]]}
                min={1}
                max={5}
                step={1}
                onValueChange={([v]) => setScores((s) => ({ ...s, [q.key]: v }))}
              />
              <p className="text-xs text-muted-foreground">{q.hint}</p>
            </div>
          ))}

          <div className="space-y-1.5 pt-2">
            <Label htmlFor="proc-comments">Andre kommentarer (valgfritt)</Label>
            <Textarea
              id="proc-comments"
              rows={3}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Egne erfaringer fra prosessen…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hopp over
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Lagrer…" : "Send vurdering"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
