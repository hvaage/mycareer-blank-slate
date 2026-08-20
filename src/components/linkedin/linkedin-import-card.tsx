// @ts-nocheck
// ============================================================
// LinkedIn-import: brukerens opplasting av eksportarkivet.
// Ingenting skrives til karriereoversikten her — importen lager
// kun forslag som brukeren tar stilling til i kildegjennomgangen.
// ============================================================
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

export function LinkedInImportCard() {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [purposes, setPurposes] = useState<string[]>(["profile", "career"]);
  const [result, setResult] = useState<{ proposals: number; staged: number } | null>(null);

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
      return json as { proposals: number; counts: { staged_records: number } };
    },
    onSuccess: (json) => {
      setResult({ proposals: json.proposals ?? 0, staged: json.counts?.staged_records ?? 0 });
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["review-inbox-counts"] });
      queryClient.invalidateQueries({ queryKey: ["linkedin-reconciliation-proposals"] });
      toast.success("LinkedIn-eksporten er lest inn");
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
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Leser eksporten…
            </>
          ) : (
            <>
              <Upload className="mr-2 h-4 w-4" aria-hidden /> Last opp og lag forslag
            </>
          )}
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/kildegjennomgang" search={{ source: "linkedin" }}>
            Se kildegjennomgang
          </Link>
        </Button>
      </div>

      {result ? (
        <Alert>
          <AlertDescription className="text-sm">
            Vi leste {result.staged} rader og laget {result.proposals} forslag. Ingenting er lagt til
            i karriereoversikten din ennå —{" "}
            <Link
              to="/kildegjennomgang"
              search={{ source: "linkedin" }}
              className="underline underline-offset-2"
            >
              gå til kildegjennomgangen
            </Link>{" "}
            for å ta stilling til forslagene.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
