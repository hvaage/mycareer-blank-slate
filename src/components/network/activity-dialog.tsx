// @ts-nocheck
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { upsertActivity, completeActivity } from "@/lib/network.functions";
import { ACTIVITY_TYPE_LABEL, ACTIVITY_STATUS_LABEL } from "@/lib/queries/network";

export type ActivityContext = {
  contactId?: string | null;
  companyId?: string | null;
  opportunityId?: string | null;
  applicationId?: string | null;
};

const ERROR_TEXT: Record<string, string> = {
  missing_context:
    "Aktiviteten må knyttes til en kontakt, et selskap, en mulighet eller en søknad.",
  not_found: "Aktiviteten finnes ikke lenger.",
  forbidden: "Du har ikke tilgang til denne aktiviteten.",
  invalid_link: "Koblingen tilhører ikke deg.",
  write_failed: "Kunne ikke lagre aktiviteten. Prøv igjen.",
};

/**
 * Kanonisk skjema for aktiviteter. Klienten sender aldri `user_id`; all
 * skriving går via serverhandlingene som validerer eierskap og kobling.
 * Uten kobling lagres aktiviteten som en personlig aktivitet.
 */
export function ActivityDialog({
  context,
  activity,
  trigger,
  contextLabel,
  open: openProp,
  onOpenChange,
}: {
  context: ActivityContext;
  activity?: {
    id: string;
    title: string;
    description: string | null;
    due_date: string | null;
    priority: string | null;
    activity_type: string;
    status: string;
    result_note: string | null;
  } | null;
  trigger?: React.ReactNode;
  contextLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setOpenState(next);
  };
  const [title, setTitle] = useState(activity?.title ?? "");
  const [description, setDescription] = useState(activity?.description ?? "");
  const [dueDate, setDueDate] = useState(activity?.due_date ?? "");
  const [priority, setPriority] = useState(activity?.priority ?? "middels");
  const [type, setType] = useState(activity?.activity_type ?? "oppfolging");
  const [status, setStatus] = useState(activity?.status ?? "planlagt");
  const [resultNote, setResultNote] = useState(activity?.result_note ?? "");

  const hasContext =
    !!context.contactId || !!context.companyId || !!context.opportunityId || !!context.applicationId;

  const save = useMutation({
    mutationFn: async (override?: { status?: string }) =>
      upsertActivity({
        data: {
          activityId: activity?.id ?? null,
          title: title.trim(),
          description: description.trim() || null,
          dueDate: dueDate || null,
          priority,
          activityType: type,
          status: override?.status ?? status,
          resultNote: resultNote.trim() || null,
          activityScope: hasContext ? "context" : "personal",
          contactId: context.contactId ?? null,
          companyId: context.companyId ?? null,
          opportunityId: context.opportunityId ?? null,
          applicationId: context.applicationId ?? null,
        },
      }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(ERROR_TEXT[res.errorCode ?? "write_failed"] ?? ERROR_TEXT.write_failed);
        return;
      }
      qc.invalidateQueries({ queryKey: ["network"] });
      toast.success(activity ? "Aktiviteten er oppdatert." : "Aktiviteten er lagret.");
      setOpen(false);
    },
    onError: () => toast.error(ERROR_TEXT.write_failed),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{activity ? "Aktivitet" : "Ny aktivitet"}</DialogTitle>
          <DialogDescription>
            {contextLabel
              ? `Knyttes til ${contextLabel}.`
              : hasContext
                ? "Aktiviteten er knyttet til et objekt i nettverksarbeidet."
                : "Personlig aktivitet uten kobling til kontakt, selskap eller mulighet."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {Object.entries(ACTIVITY_STATUS_LABEL).map(([v, l]) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={status === v ? "default" : "outline"}
                onClick={() => {
                  setStatus(v);
                  if (activity) save.mutate({ status: v });
                }}
                disabled={save.isPending}
              >
                {l}
              </Button>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="act-title">Tittel</Label>
            <Input id="act-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="act-due">Dato</Label>
              <Input
                id="act-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_TYPE_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ACTIVITY_STATUS_LABEL).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Prioritet</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="høy">Høy</SelectItem>
                  <SelectItem value="middels">Middels</SelectItem>
                  <SelectItem value="lav">Lav</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="act-desc">Notat</Label>
            <Textarea
              id="act-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {status === "utfort" || status === "avlyst" ? (
            <div className="space-y-1">
              <Label htmlFor="act-result">Resultat</Label>
              <Textarea
                id="act-result"
                rows={2}
                value={resultNote}
                onChange={(e) => setResultNote(e.target.value)}
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Avbryt
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={!title.trim() || !hasContext || save.isPending}
          >
            {save.isPending ? "Lagrer…" : "Lagre"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Statusknapp som går via `network_complete_activity`. */
export function ActivityStatusButton({
  activityId,
  status,
}: {
  activityId: string;
  status: string;
}) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: async (next: string) =>
      completeActivity({ data: { activityId, status: next } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(ERROR_TEXT[res.errorCode ?? "write_failed"] ?? ERROR_TEXT.write_failed);
        return;
      }
      qc.invalidateQueries({ queryKey: ["network"] });
    },
    onError: () => toast.error(ERROR_TEXT.write_failed),
  });

  if (status === "utfort") {
    return (
      <Button variant="ghost" size="sm" disabled={m.isPending} onClick={() => m.mutate("planlagt")}>
        Gjenåpne
      </Button>
    );
  }
  if (status === "avlyst") {
    return (
      <Button variant="ghost" size="sm" disabled={m.isPending} onClick={() => m.mutate("planlagt")}>
        Gjenåpne
      </Button>
    );
  }
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate("utfort")}>
        Utført
      </Button>
      <Button size="sm" variant="ghost" disabled={m.isPending} onClick={() => m.mutate("avlyst")}>
        Avlys
      </Button>
    </div>
  );
}
