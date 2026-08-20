// @ts-nocheck
// ============================================================
// LinkedIn-import: brukerens opplasting av eksportarkivet.
// Opplastingen gir umiddelbar kvittering. Selve lesingen skjer i
// bakgrunnen og fortsetter selv om nettleseren lukkes.
// Ingenting skrives til karriereoversikten her — importen lager
// kun forslag som brukeren tar stilling til i kildegjennomgangen.
// ============================================================
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";

const PURPOSE_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "profile", label: "Profil", hint: "Overskrift, sammendrag og profilfelt" },
  { value: "career", label: "Karriere", hint: "Stillinger, utdanning, kurs, språk og kompetanser" },
  { value: "network", label: "Nettverk", hint: "Kontakter og anbefalinger" },
  { value: "jobs", label: "Jobbsøk", hint: "Lagrede jobber og søknader" },
  { value: "learning", label: "Læring", hint: "LinkedIn Learning-kurs" },
  { value: "content", label: "Innhold", hint: "Innlegg og artikler du har skrevet" },
];

const PHASE_TEXT: Record<string, string> = {
  queued: "Venter på tur",
  validating_archive: "Sjekker arkivet",
  staging: "Leser filene i eksporten",
  reconciling: "Sammenligner med det du har fra før",
  finalizing: "Gjør ferdig",
};

const STATUS_TEXT: Record<string, string> = {
  uploaded: "Venter på tur",
  validating: "Sjekker arkivet",
  staging: "Leser filene i eksporten",
  staged: "Sammenligner med det du har fra før",
  reconciliation_ready: "Ferdig lest — forslag er klare",
  failed: "Importen ble avbrutt før den var ferdig",
  cancelled: "Importen ble avbrutt",
  rejected: "Arkivet kunne ikke leses",
};

const ACTIVE_STATUSES = new Set(["uploaded", "validating", "staging", "staged"]);

async function authedFetch(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Du må være pålogget.");
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok) throw new Error(json?.error?.message ?? "Handlingen kunne ikke utføres.");
  return json;
}

export function LinkedInImportCard() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [purposes, setPurposes] = useState<string[]>(["profile", "career"]);
  const [receipt, setReceipt] = useState<string | null>(null);

  const imports = useQuery({
    queryKey: ["linkedin-imports"],
    queryFn: async () =>
      (await authedFetch("/api/linkedin/imports")).imports as Array<Record<string, unknown>>,
    // Tettere puls mens noe er under arbeid; ellers rolig.
    refetchInterval: (query) => {
      const rows = (query.state.data ?? []) as Array<Record<string, unknown>>;
      return rows.some((r) => ACTIVE_STATUSES.has(String(r.status))) ? 5000 : 30000;
    },
  });

  const latest = imports.data?.[0];
  const attempt = (latest?.latest_attempt ?? null) as Record<string, unknown> | null;
  const isActive = latest ? ACTIVE_STATUSES.has(String(latest.status)) : false;
  const knownFiles = Number(latest?.known_file_count ?? 0);
  const processedFiles = Number(attempt?.processed_files_count ?? 0);
  const progressPct =
    knownFiles > 0 ? Math.min(99, Math.round((processedFiles / knownFiles) * 100)) : null;

  const upload = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Velg ZIP-filen fra LinkedIn.");
      if (purposes.length === 0) throw new Error("Velg minst ett formål.");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Du må være pålogget.");

      const body = new FormData();
      body.append("file", file);
      purposes.forEach((p) => body.append("purposes", p));

      const res = await fetch("/api/linkedin/imports", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error?.message ?? "Importen feilet. Prøv igjen.");
      }
      return json as { message?: string };
    },
    onSuccess: (json) => {
      setReceipt(
        json.message ??
          "Importen er mottatt og kjøres i bakgrunnen. Du får varsel når den er klar.",
      );
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["linkedin-imports"] });
      toast.success("Eksporten er mottatt — vi leser den i bakgrunnen");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importAction = useMutation({
    mutationFn: async (action: "cancel" | "retry") =>
      await authedFetch("/api/linkedin/imports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ import_id: latest?.id, action }),
      }),
    onSuccess: (_data, action) => {
      setReceipt(null);
      queryClient.invalidateQueries({ queryKey: ["linkedin-imports"] });
      toast.success(action === "cancel" ? "Importen avbrytes" : "Nytt forsøk er satt i kø");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-sm font-medium">Hva skal vi lese fra eksporten?</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {PURPOSE_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={purposes.includes(option.value)}
                onCheckedChange={(checked) =>
                  setPurposes((prev) =>
                    checked ? [...prev, option.value] : prev.filter((p) => p !== option.value),
                  )
                }
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Filer utenfor formålene du velger blir aldri lest.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="linkedin-archive" className="text-sm font-medium">
          LinkedIn-eksport (ZIP)
        </Label>
        <input
          id="linkedin-archive"
          type="file"
          accept=".zip,application/zip"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium"
        />
        <p className="text-xs text-muted-foreground">
          Last ned arkivet fra LinkedIn under Innstillinger → Få en kopi av dataene dine.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
          {upload.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Laster opp…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" aria-hidden /> Last opp og les i bakgrunnen
            </>
          )}
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
            Se kildegjennomgang
          </Link>
        </Button>
      </div>

      {receipt ? (
        <Alert>
          <AlertDescription className="text-sm">{receipt}</AlertDescription>
        </Alert>
      ) : null}

      {latest ? (
        <Alert>
          <AlertDescription className="space-y-2 text-sm">
            <div>
              Siste import:{" "}
              {attempt && isActive
                ? (PHASE_TEXT[String(attempt.phase)] ?? STATUS_TEXT[String(latest.status)])
                : (STATUS_TEXT[String(latest.status)] ?? String(latest.status))}
              {attempt && isActive && Number(attempt.retry_count ?? 0) > 0 ? (
                <> (forsøk {Number(attempt.attempt_number)} av {Number(attempt.max_attempts)})</>
              ) : null}
            </div>

            {isActive && progressPct !== null ? (
              <div className="space-y-1">
                <Progress value={progressPct} />
                <p className="text-xs text-muted-foreground">
                  {processedFiles} av {knownFiles} filer lest
                  {Number(attempt?.staged_records_count ?? 0) > 0
                    ? ` — ${Number(attempt?.staged_records_count)} rader så langt`
                    : ""}
                </p>
              </div>
            ) : null}

            {isActive ? (
              <p className="text-xs text-muted-foreground">
                Du kan lukke siden. Vi varsler deg her i appen når importen er ferdig.
              </p>
            ) : null}

            {latest.status === "reconciliation_ready" ? (
              <p>
                Ingenting er lagt til i karriereoversikten din ennå —{" "}
                <Link
                  to="/kildegjennomgang"
                  search={{ source: "linkedin" }}
                  className="underline underline-offset-2"
                >
                  gå til kildegjennomgangen
                </Link>{" "}
                for å ta stilling til forslagene.
              </p>
            ) : null}

            {String(latest.error_code ?? "") ? (
              <p className="text-xs text-muted-foreground">
                Årsak: {String(latest.error_summary ?? latest.error_code)}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              {isActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importAction.isPending}
                  onClick={() => importAction.mutate("cancel")}
                >
                  Avbryt importen
                </Button>
              ) : null}
              {latest.status === "failed" && latest.archive_available ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importAction.isPending}
                  onClick={() => importAction.mutate("retry")}
                >
                  Prøv igjen
                </Button>
              ) : null}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
