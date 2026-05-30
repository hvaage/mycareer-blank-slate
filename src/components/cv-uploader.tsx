import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, Upload, Trash2, FileText, Sparkles, Briefcase, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { fmtDate } from "@/lib/format";
import {
  useGeneratedGeneralCvs,
  useGeneratedTailoredCvs,
  downloadDocument,
  type GeneratedCvRow,
} from "@/lib/queries/cv-archive";

type Lang = "no" | "en";
type Kind = "word" | "pdf";

const ACCEPT: Record<Kind, string> = {
  word: ".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: ".pdf,application/pdf",
};

interface Props {
  userId: string;
  profile: any;
  onChanged: () => void;
}

export function CvUploader({ userId, profile, onChanged }: Props) {
  return (
    <div className="space-y-6">
      <OwnCvCard userId={userId} profile={profile} onChanged={onChanged} />
      <GeneralGeneratedCard userId={userId} />
      <TailoredGeneratedCard userId={userId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card A — Egenproduserte CV-er (uploaded by user)
// ---------------------------------------------------------------------------

function OwnCvCard({ userId, profile, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const hasAny = !!(
    profile.cv_no_word_path || profile.cv_no_pdf_path ||
    profile.cv_en_word_path || profile.cv_en_pdf_path
  );
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-muted/40 transition-colors rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Egne CV-er (opplastet)</span>
                {hasAny && <Badge variant="secondary" className="text-[10px]">Lagret</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Last opp ferdige CV-filer du allerede har — de lagres som de er, uten analyse.
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-6 pt-2">
            <CvLangBlock lang="no" label="Norsk CV" userId={userId} profile={profile} onChanged={onChanged} />
            <CvLangBlock lang="en" label="Engelsk CV" userId={userId} profile={profile} onChanged={onChanged} />
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function CvLangBlock({
  lang, label, userId, profile, onChanged,
}: { lang: Lang; label: string; userId: string; profile: any; onChanged: () => void }) {
  const updatedAt = profile[`cv_${lang}_updated_at`];
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <span className="text-xs text-muted-foreground">
          {updatedAt ? `Sist oppdatert ${fmtDate(updatedAt)}` : "Ingen versjon lastet opp"}
        </span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <CvSlot lang={lang} kind="word" userId={userId} profile={profile} onChanged={onChanged} />
        <CvSlot lang={lang} kind="pdf" userId={userId} profile={profile} onChanged={onChanged} />
      </div>
    </div>
  );
}

function CvSlot({
  lang, kind, userId, profile, onChanged,
}: { lang: Lang; kind: Kind; userId: string; profile: any; onChanged: () => void }) {
  const field = `cv_${lang}_${kind}_path` as const;
  const path: string | null = profile[field] ?? null;
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const ext = file.name.split(".").pop() ?? (kind === "pdf" ? "pdf" : "docx");
      const newPath = `${userId}/cv-${lang}-${kind}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("job-documents")
        .upload(newPath, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;

      if (path) await supabase.storage.from("job-documents").remove([path]);

      const update: Record<string, any> = {
        [field]: newPath,
        [`cv_${lang}_updated_at`]: new Date().toISOString(),
      };
      const { error } = await (supabase.from("profiles") as any).update(update).eq("id", userId);
      if (error) throw error;
      toast.success("CV lastet opp");
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "Opplasting feilet");
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    if (!path) return;
    const { data, error } = await supabase.storage.from("job-documents").createSignedUrl(path, 60);
    if (error || !data) return toast.error(error?.message ?? "Kunne ikke åpne fil");
    window.open(data.signedUrl, "_blank");
  };

  const remove = async () => {
    if (!path) return;
    setBusy(true);
    try {
      await supabase.storage.from("job-documents").remove([path]);
      const { error } = await (supabase.from("profiles") as any)
        .update({ [field]: null }).eq("id", userId);
      if (error) throw error;
      toast.success("Slettet");
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "Sletting feilet");
    } finally {
      setBusy(false);
    }
  };

  const fileName = path?.split("/").pop();
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <FileText className="h-4 w-4" />
        {kind === "word" ? "Word" : "PDF"}
      </div>
      {path ? (
        <>
          <div className="text-xs text-muted-foreground truncate" title={fileName}>{fileName}</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={download} disabled={busy}>
              <Download className="h-3.5 w-3.5 mr-1" /> Last ned
            </Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Ingen fil</p>
      )}
      <label className="block">
        <span className="sr-only">Last opp {kind}</span>
        <Input
          type="file"
          accept={ACCEPT[kind]}
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
      </label>
      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
        <Upload className="h-3 w-3" /> {path ? "Erstatt fil" : "Velg fil"}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card B — Generelle CV-er generert av systemet
// ---------------------------------------------------------------------------

function GeneralGeneratedCard({ userId }: { userId: string }) {
  const q = useGeneratedGeneralCvs(userId);
  const [open, setOpen] = useState(false);
  const [sourceLang, setSourceLang] = useState<"no" | "en">("no");
  const [translate, setTranslate] = useState(true);
  const byLang = (lang: "no" | "en") =>
    q.data?.find((d) => (d.render_language ?? "").toLowerCase() === lang) ?? null;
  const otherLang = sourceLang === "no" ? "engelsk" : "norsk";
  const count = q.data?.length ?? 0;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-muted/40 transition-colors rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Generelle CV-er (generert)</span>
                {count > 0 && <Badge variant="secondary" className="text-[10px]">{count}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Bygges fra Karriereoversikten via CV-bygger. Skriv på ett språk og oversett automatisk til det andre.
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 pt-2">
            <LangAndTranslatePanel
              sourceLang={sourceLang}
              setSourceLang={setSourceLang}
              translate={translate}
              setTranslate={setTranslate}
              otherLang={otherLang}
              ctaLabel="Generer generell CV"
              search={{ type: "general", lang: sourceLang, translate }}
            />
            {q.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                <GeneralSlot lang="no" label="Norsk" doc={byLang("no")} />
                <GeneralSlot lang="en" label="Engelsk" doc={byLang("en")} />
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function GeneralSlot({ lang, label, doc }: { lang: "no" | "en"; label: string; doc: GeneratedCvRow | null }) {
  const handleDownload = async () => {
    if (!doc?.file_path) return;
    try {
      await downloadDocument(doc.file_path);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke åpne fil");
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {doc && <Badge variant="secondary">v{doc.version ?? 1}</Badge>}
      </div>
      {doc ? (
        <>
          <div className="text-xs text-muted-foreground">
            Generert {fmtDate(doc.created_at)}
          </div>
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="h-3.5 w-3.5 mr-1" /> Last ned
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ingen {label.toLowerCase()} versjon ennå.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card C — Stillingstilpassede CV-er
// ---------------------------------------------------------------------------

function TailoredGeneratedCard({ userId }: { userId: string }) {
  const q = useGeneratedTailoredCvs(userId);
  const [open, setOpen] = useState(false);
  const [sourceLang, setSourceLang] = useState<"no" | "en">("no");
  const [translate, setTranslate] = useState(false);
  const otherLang = sourceLang === "no" ? "engelsk" : "norsk";
  const count = q.data?.length ?? 0;

  const sorted = (q.data ?? [])
    .slice()
    .sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 px-6 py-4 text-left hover:bg-muted/40 transition-colors rounded-lg"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Stillingstilpassede CV-er (generert)</span>
                {count > 0 && <Badge variant="secondary" className="text-[10px]">{count}</Badge>}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Skreddersydd til en spesifikk stillingsannonse — startes fra siden til den enkelte søknaden.
              </p>
            </div>
            <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-5 pt-2">
            <LangAndTranslatePanel
              sourceLang={sourceLang}
              setSourceLang={setSourceLang}
              translate={translate}
              setTranslate={setTranslate}
              otherLang={otherLang}
              ctaLabel="Velg stilling og generer"
              search={{ type: "tailored", lang: sourceLang, translate }}
              helper={
                <>
                  Tilpasset CV knyttes til en spesifikk søknad. Velg stillingen
                  fra <Link to="/applications" className="underline text-foreground">Mine søknader</Link>.
                </>
              }
            />

            {q.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : !sorted.length ? (
              <p className="text-sm text-muted-foreground">
                Ingen tilpassede CV-er ennå.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {sorted.map((row) => {
                  const lang = (row.render_language ?? "").toLowerCase();
                  const langLabel = lang === "en" ? "EN" : lang === "no" ? "NO" : (row.render_language ?? "—");
                  const company = row.applications?.company_name ?? row.company_name ?? "Ukjent selskap";
                  const role = row.applications?.role_title ?? "";
                  const handleDownload = async () => {
                    if (!row.file_path) return;
                    try {
                      await downloadDocument(row.file_path);
                    } catch (e: any) {
                      toast.error(e.message ?? "Kunne ikke åpne fil");
                    }
                  };
                  return (
                    <li key={row.id} className="py-2 px-3 flex items-center gap-3 text-sm">
                      <span className="text-xs text-muted-foreground tabular-nums w-20 shrink-0">
                        {fmtDate(row.created_at)}
                      </span>
                      <span className="font-medium truncate flex-1 min-w-0" title={`${company}${role ? " — " + role : ""}`}>
                        {company}
                        {role && <span className="text-muted-foreground"> — {role}</span>}
                      </span>
                      <Badge variant="secondary" className="shrink-0">{langLabel}</Badge>
                      <Button size="sm" variant="outline" onClick={handleDownload} className="shrink-0">
                        <Download className="h-3.5 w-3.5 mr-1" /> Last ned
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shared: Language + translate generation panel
// ---------------------------------------------------------------------------

function LangAndTranslatePanel({
  sourceLang, setSourceLang, translate, setTranslate, otherLang,
  ctaLabel, search, helper,
}: {
  sourceLang: "no" | "en";
  setSourceLang: (v: "no" | "en") => void;
  translate: boolean;
  setTranslate: (v: boolean) => void;
  otherLang: string;
  ctaLabel: string;
  search: Record<string, any>;
  helper?: ReactNode;
}) {
  return (
    <div className="rounded-md border p-4 space-y-4 bg-muted/30">
      <div className="space-y-2">
        <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Skriv CV-en på
        </Label>
        <RadioGroup
          value={sourceLang}
          onValueChange={(v) => setSourceLang(v as "no" | "en")}
          className="flex gap-4"
        >
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <RadioGroupItem value="no" /> Norsk
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <RadioGroupItem value="en" /> Engelsk
          </label>
        </RadioGroup>
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox
          checked={translate}
          onCheckedChange={(v) => setTranslate(!!v)}
          className="mt-0.5"
        />
        <span>
          Oversett automatisk til <strong>{otherLang}</strong> med formelt
          forretningsspråk, så begge versjoner holdes synkronisert.
        </span>
      </label>
      {helper && <p className="text-xs text-muted-foreground">{helper}</p>}
      <Button asChild size="sm">
        <Link to="/cv-builder" search={search as any}>
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {ctaLabel}
        </Link>
      </Button>
    </div>
  );
}

