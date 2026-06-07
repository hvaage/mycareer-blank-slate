// @ts-nocheck
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  adminGetOverview,
  adminGetQuestions,
  adminUpdateQuestion,
  adminGetTextAnswers,
  adminUpdateAnswer,
  adminIssueAccessToken,
  adminExportCsv,
} from "@/lib/recruiter-survey.functions";
import { Copy, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/rekruttererundersokelse")({
  head: () => ({
    meta: [
      { title: "Admin · Rekruttererundersøkelsen — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminSurveyPage,
});

function AdminSurveyPage() {
  const overviewFn = useServerFn(adminGetOverview);
  const { data: overview, isLoading } = useQuery({
    queryKey: ["admin-survey-overview"],
    queryFn: () => overviewFn(),
  });

  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const versionId =
    selectedVersion ??
    overview?.versions?.find((v: any) => v.is_active)?.id ??
    overview?.versions?.[0]?.id ??
    null;

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Laster…</div>;
  }
  if (!overview || overview.versions.length === 0) {
    return <div className="p-6 text-sm text-muted-foreground">Ingen versjoner.</div>;
  }

  const version = overview.versions.find((v: any) => v.id === versionId);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Rekruttererundersøkelsen</h1>
        <p className="text-sm text-muted-foreground">
          Administrer spørsmål, publisering og resultater.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-xs">Versjon:</Label>
        <Select value={versionId ?? ""} onValueChange={setSelectedVersion}>
          <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            {overview.versions.map((v: any) => (
              <SelectItem key={v.id} value={v.id}>
                v{v.version_number} – {v.title} {v.is_active && "· aktiv"}
                {" · "}{overview.counts[v.id] ?? 0} svar
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">Spørsmål</TabsTrigger>
          <TabsTrigger value="texts">Tekstsvar</TabsTrigger>
          <TabsTrigger value="signups">E-postliste</TabsTrigger>
          <TabsTrigger value="export">Eksport & lenker</TabsTrigger>
        </TabsList>

        <TabsContent value="questions" className="mt-4">
          {versionId && <QuestionsAdmin versionId={versionId} />}
        </TabsContent>

        <TabsContent value="texts" className="mt-4">
          {versionId && <TextAnswersAdmin versionId={versionId} />}
        </TabsContent>

        <TabsContent value="signups" className="mt-4">
          <SignupsAdmin signups={overview.signups} />
        </TabsContent>

        <TabsContent value="export" className="mt-4">
          {versionId && <ExportAdmin versionId={versionId} title={version?.title ?? ""} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QuestionsAdmin({ versionId }: { versionId: string }) {
  const fn = useServerFn(adminGetQuestions);
  const updateFn = useServerFn(adminUpdateQuestion);
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["admin-survey-questions", versionId],
    queryFn: () => fn({ data: { versionId } }),
  });

  async function update(id: string, patch: Record<string, any>) {
    try {
      await updateFn({ data: { id, patch } });
      await qc.invalidateQueries({ queryKey: ["admin-survey-questions", versionId] });
      toast.success("Lagret");
    } catch (e: any) {
      toast.error(e?.message ?? "Feil");
    }
  }

  return (
    <div className="space-y-2">
      {(data?.questions ?? []).map((q: any) => (
        <Card key={q.id} className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                #{q.sort_order} · {q.category} · {q.question_type}
              </p>
              <p className="mt-1 text-sm font-medium">{q.question_text}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {q.is_active ? (
                <Badge variant="default">Aktiv</Badge>
              ) : (
                <Badge variant="secondary">Inaktiv</Badge>
              )}
              <Badge variant="outline">{q.visibility_level}</Badge>
              {q.is_public_result_enabled && <Badge>Offentlig</Badge>}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={q.is_active}
                onCheckedChange={(v) => update(q.id, { is_active: !!v })}
              />
              Aktiv
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={q.is_public_result_enabled}
                onCheckedChange={(v) => update(q.id, { is_public_result_enabled: !!v })}
              />
              Vis offentlig
            </label>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={q.is_full_result_enabled}
                onCheckedChange={(v) => update(q.id, { is_full_result_enabled: !!v })}
              />
              Vis i fullversjon
            </label>
            <Select
              value={q.visibility_level}
              onValueChange={(v) => update(q.id, { visibility_level: v })}
            >
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hidden">Skjult</SelectItem>
                <SelectItem value="full_only">Kun fullversjon</SelectItem>
                <SelectItem value="public">Offentlig</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <Label className="text-xs">Rekkefølge:</Label>
            <Input
              type="number"
              className="h-8 w-24"
              defaultValue={q.sort_order}
              onBlur={(e) => {
                const v = Number(e.target.value);
                if (v !== q.sort_order) update(q.id, { sort_order: v });
              }}
            />
          </div>
        </Card>
      ))}
    </div>
  );
}

function TextAnswersAdmin({ versionId }: { versionId: string }) {
  const qFn = useServerFn(adminGetQuestions);
  const ansFn = useServerFn(adminGetTextAnswers);
  const updFn = useServerFn(adminUpdateAnswer);
  const qc = useQueryClient();
  const { data: qData } = useQuery({
    queryKey: ["admin-survey-questions", versionId],
    queryFn: () => qFn({ data: { versionId } }),
  });
  const textQs = useMemo(
    () => (qData?.questions ?? []).filter((q: any) => q.question_type === "open_text"),
    [qData],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const qid = selected ?? textQs[0]?.id ?? null;
  const { data: answers } = useQuery({
    queryKey: ["admin-survey-texts", qid],
    queryFn: () => ansFn({ data: { questionId: qid! } }),
    enabled: !!qid,
  });

  async function toggle(id: string, field: string, value: boolean) {
    await updFn({ data: { id, patch: { [field]: value } } });
    await qc.invalidateQueries({ queryKey: ["admin-survey-texts", qid] });
  }

  if (textQs.length === 0) {
    return <p className="text-sm text-muted-foreground">Ingen tekstspørsmål.</p>;
  }

  return (
    <div className="space-y-4">
      <Select value={qid ?? ""} onValueChange={setSelected}>
        <SelectTrigger className="w-full max-w-xl"><SelectValue /></SelectTrigger>
        <SelectContent>
          {textQs.map((q: any) => (
            <SelectItem key={q.id} value={q.id}>{q.question_text}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="space-y-2">
        {(answers?.answers ?? []).map((a: any) => (
          <Card key={a.id} className="p-4">
            <p className="text-sm whitespace-pre-wrap">{a.text_answer}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={a.is_full_quote_approved}
                  onCheckedChange={(v) => toggle(a.id, "is_full_quote_approved", !!v)}
                />
                Vis i fullversjon
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={a.is_public_quote_approved}
                  onCheckedChange={(v) => toggle(a.id, "is_public_quote_approved", !!v)}
                />
                Godkjent for offentlig
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={a.is_flagged}
                  onCheckedChange={(v) => toggle(a.id, "is_flagged", !!v)}
                />
                Marker
              </label>
            </div>
          </Card>
        ))}
        {answers && answers.answers.length === 0 && (
          <p className="text-sm text-muted-foreground">Ingen tekstsvar enda.</p>
        )}
      </div>
    </div>
  );
}

function SignupsAdmin({ signups }: { signups: any[] }) {
  const issueFn = useServerFn(adminIssueAccessToken);
  const qc = useQueryClient();

  async function issue(id: string) {
    try {
      const { token } = await issueFn({ data: { signupId: id } });
      const url = `${window.location.origin}/rekruttererundersokelse/resultater/full?token=${token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Tilgangslenke kopiert");
      await qc.invalidateQueries({ queryKey: ["admin-survey-overview"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Feil");
    }
  }

  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left">
          <tr>
            <th className="p-3 text-xs font-medium">Navn</th>
            <th className="p-3 text-xs font-medium">E-post</th>
            <th className="p-3 text-xs font-medium">Registrert</th>
            <th className="p-3 text-xs font-medium">Tilgang</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {signups.map((s) => (
            <tr key={s.id} className="border-b last:border-0">
              <td className="p-3">{s.name ?? "–"}</td>
              <td className="p-3">{s.email}</td>
              <td className="p-3 text-xs text-muted-foreground">
                {new Date(s.created_at).toLocaleString("no")}
              </td>
              <td className="p-3 text-xs">
                {s.access_granted_at ? (
                  <Badge>Aktiv</Badge>
                ) : (
                  <Badge variant="secondary">Ikke utstedt</Badge>
                )}
              </td>
              <td className="p-3 text-right">
                <Button size="sm" variant="outline" onClick={() => issue(s.id)}>
                  <Copy className="mr-1 h-3 w-3" />
                  {s.access_granted_at ? "Ny lenke" : "Lag lenke"}
                </Button>
              </td>
            </tr>
          ))}
          {signups.length === 0 && (
            <tr>
              <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                Ingen påmeldinger ennå.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}

function ExportAdmin({ versionId, title }: { versionId: string; title: string }) {
  const fn = useServerFn(adminExportCsv);
  async function download() {
    try {
      const { csv } = await fn({ data: { versionId } });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/\s+/g, "-").toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Feil ved eksport");
    }
  }
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Eksport</h3>
        <p className="text-xs text-muted-foreground">
          Last ned alle svar som CSV (uten kontaktinformasjon — denne er lagret separat).
        </p>
      </div>
      <Button onClick={download}>
        <Download className="mr-2 h-4 w-4" /> Last ned CSV
      </Button>
      <div className="pt-2">
        <h3 className="text-sm font-semibold">Forhåndsvis</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/rekruttererundersokelse/resultater" target="_blank" rel="noreferrer">
              Offentlig <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/rekruttererundersokelse/resultater/full" target="_blank" rel="noreferrer">
              Full <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/rekruttererundersokelse" target="_blank" rel="noreferrer">
              Skjema <ExternalLink className="ml-1 h-3 w-3" />
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
