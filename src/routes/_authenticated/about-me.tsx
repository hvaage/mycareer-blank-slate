// @ts-nocheck
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AutoSaveInput, AutoSaveTextarea } from "@/components/auto-save";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, Download, User as UserIcon, Network } from "lucide-react";
import { toast } from "sonner";
import { CvUploader } from "@/components/cv-uploader";
import { AboutMeCvSection } from "@/components/cv-upload/about-me-section";
import { JobSearchPrefs } from "@/components/job-search-prefs";

export const Route = createFileRoute("/_authenticated/about-me")({
  component: AboutMePage,
});

const profileQuery = (userId: string) =>
  queryOptions({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

function AboutMePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: p, isLoading } = useQuery({
    ...profileQuery(user?.id ?? ""),
    enabled: !!user,
  });

  if (!user) return null;
  if (isLoading || !p) return <div className="p-8 max-w-3xl mx-auto"><Skeleton className="h-96 w-full" /></div>;

  const save = (field: string, transform?: (v: string) => any) => async (v: string) => {
    const value = transform ? transform(v) : (v || null);
    const { error } = await (supabase.from("profiles") as any).update({ [field]: value }).eq("id", user.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
  };

  const csvList = (v: string) => {
    const arr = v.split(",").map((s) => s.trim()).filter(Boolean);
    return arr.length ? arr : null;
  };
  const num = (v: string) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  };

  const exportMarkdown = () => {
    const md = buildMarkdown(p);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "about-me.md"; a.click();
    URL.revokeObjectURL(url);
    toast.success("about-me.md lastet ned");
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Om meg</h1>
          <p className="text-sm text-muted-foreground">
            CV-arkiv, karriereoversikt og personlig profil. Endringer lagres automatisk, og
            spørreskjemaet under <strong>Kort om meg</strong> kan eksporteres som
            <code> about-me.md</code>.
            {" "}
            <Link to="/preferences" className="text-primary hover:underline font-medium">
              Karriereprofil for matching
            </Link>{" "}
            finner du på egen side. Integrasjoner og konto ligger nå under{" "}
            <Link to="/innstillinger/integrasjoner" className="text-primary hover:underline font-medium">
              Innstillinger
            </Link>.
          </p>

        </div>
        <Button variant="outline" size="sm" onClick={exportMarkdown}>
          <Download className="h-4 w-4 mr-2" /> Eksporter .md
        </Button>
      </div>

      <Tabs defaultValue="kort_om_meg" className="w-full">
        <TabsList className="grid grid-cols-3 sm:grid-cols-3 h-auto gap-2 bg-transparent p-0">
          <TabsTrigger
            value="cv"
            className="flex flex-col items-center gap-1.5 h-auto py-4 border rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary"
          >
            <FileText className="h-5 w-5" />
            <span className="text-sm font-medium">CV</span>
          </TabsTrigger>
          <TabsTrigger
            value="karriereoversikt"
            className="flex flex-col items-center gap-1.5 h-auto py-4 border rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary"
          >
            <Network className="h-5 w-5" />
            <span className="text-sm font-medium">Karriereoversikt</span>
          </TabsTrigger>
          <TabsTrigger
            value="kort_om_meg"
            className="flex flex-col items-center gap-1.5 h-auto py-4 border rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary"
          >
            <UserIcon className="h-5 w-5" />
            <span className="text-sm font-medium">Kort om meg</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cv" className="mt-6 space-y-4">
          <div className="rounded-lg border border-amber-500/50 bg-muted/40 p-4 text-sm">
            Filene her er et <strong>arkiv</strong> — de lagres som de er, uten analyse. Skal
            innholdet bli karrieredata du kan bekrefte i gjennomgangen, laster du opp CV-en under
            fanen <strong>Karriereoversikt</strong> og kjører «Analyser CV».
          </div>
          <CvUploader
            userId={user.id}
            profile={p}
            onChanged={() => qc.invalidateQueries({ queryKey: ["profile", user.id] })}
          />
        </TabsContent>


        <TabsContent value="karriereoversikt" className="mt-6">
          <AboutMeCvSection userId={user.id} />
        </TabsContent>

        <TabsContent value="kort_om_meg" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle>1. Kort om deg</CardTitle>
              <CardDescription>Som en heis-pitch — én linje + et lengre avsnitt.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AutoSaveInput
                label="Overskrift / tittel"
                value={p.headline}
                onSave={save("headline")}
                placeholder="f.eks. Erfaren produktleder med bakgrunn i fintech"
              />
              <AutoSaveTextarea
                label="Kort biografi"
                value={p.bio}
                rows={5}
                onSave={save("bio")}
                placeholder="Skriv 3–5 setninger om bakgrunn, ekspertise og hva du brenner for."
              />
              <div className="grid sm:grid-cols-3 gap-4">
                <AutoSaveInput
                  label="År med erfaring"
                  value={p.years_experience?.toString()}
                  onSave={save("years_experience", num)}
                />
                <AutoSaveInput label="Nåværende rolle" value={p.current_role_title} onSave={save("current_role_title")} />
                <AutoSaveInput label="Nåværende arbeidsgiver" value={p.current_employer} onSave={save("current_employer")} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Bransjer, ferdigheter og språk</CardTitle>
              <CardDescription>Skriv kommaseparert.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AutoSaveInput
                label="Bransjer du har jobbet i"
                value={p.industries?.join(", ")}
                onSave={save("industries", csvList)}
                placeholder="f.eks. fintech, SaaS, helse"
              />
              <AutoSaveInput
                label="Nøkkelferdigheter"
                value={p.skills?.join(", ")}
                onSave={save("skills", csvList)}
                placeholder="f.eks. ledelse, produktstrategi, P&L"
              />
              <AutoSaveInput
                label="Språk"
                value={p.languages?.join(", ")}
                onSave={save("languages", csvList)}
                placeholder="f.eks. norsk, engelsk, tysk"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Hva slags jobb søker du?</CardTitle>
              <CardDescription>Hjelper med å filtrere og vurdere fit på nye stillinger.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AutoSaveInput
                label="Ønskede roller"
                value={p.target_roles?.join(", ")}
                onSave={save("target_roles", csvList)}
                placeholder="f.eks. CFO, Finansdirektør, COO"
              />
              <AutoSaveInput
                label="Ønskede bransjer"
                value={p.target_industries?.join(", ")}
                onSave={save("target_industries", csvList)}
              />
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <CareerStageContext userId={user.id} />
                  <Label className="text-xs">Hvilket nivå søker du?</Label>
                  <Select
                    value={p.target_seniority ?? "ikke-valgt"}
                    onValueChange={(v) => save("target_seniority")(v === "ikke-valgt" ? "" : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Velg…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ikke-valgt">Ikke valgt</SelectItem>
                      <SelectItem value="Junior">Junior</SelectItem>
                      <SelectItem value="Mid">Mid</SelectItem>
                      <SelectItem value="Senior">Senior</SelectItem>
                      <SelectItem value="Lead/Manager">Lead / Manager</SelectItem>
                      <SelectItem value="Director">Director</SelectItem>
                      <SelectItem value="VP">VP</SelectItem>
                      <SelectItem value="C-level">C-level</SelectItem>
                      <SelectItem value="Styreverv">Styreverv</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <AutoSaveInput
                  label="Arbeidsformer"
                  value={p.work_types?.join(", ")}
                  onSave={save("work_types", csvList)}
                  placeholder="kontor, hybrid, remote"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs mb-2 block">Stillingsomfang</Label>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {[
                      { code: "full_time", label: "Heltid" },
                      { code: "part_time", label: "Deltid" },
                    ].map((opt) => {
                      const arr: string[] = Array.isArray(p.preferred_work_extents) ? p.preferred_work_extents : [];
                      const checked = arr.includes(opt.code);
                      return (
                        <label key={opt.code} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={async (v) => {
                              const next = v
                                ? Array.from(new Set([...arr, opt.code]))
                                : arr.filter((c) => c !== opt.code);
                              const { error } = await (supabase.from("profiles") as any)
                                .update({ preferred_work_extents: next })
                                .eq("id", user.id);
                              if (error) toast.error(error.message);
                              qc.invalidateQueries({ queryKey: ["profile", user.id] });
                            }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Tom = ingen preferanse.</p>
                </div>
                <div>
                  <Label className="text-xs mb-2 block">Ansettelsesforhold</Label>
                  <div className="flex flex-wrap gap-4 pt-1">
                    {[
                      { code: "permanent", label: "Fast" },
                      { code: "temporary", label: "Vikariat" },
                      { code: "project", label: "Prosjekt" },
                      { code: "interim", label: "Interim" },
                    ].map((opt) => {
                      const arr: string[] = Array.isArray(p.preferred_engagement_types) ? p.preferred_engagement_types : [];
                      const checked = arr.includes(opt.code);
                      return (
                        <label key={opt.code} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={async (v) => {
                              const next = v
                                ? Array.from(new Set([...arr, opt.code]))
                                : arr.filter((c) => c !== opt.code);
                              const { error } = await (supabase.from("profiles") as any)
                                .update({ preferred_engagement_types: next })
                                .eq("id", user.id);
                              if (error) toast.error(error.message);
                              qc.invalidateQueries({ queryKey: ["profile", user.id] });
                            }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Tom = ingen preferanse.</p>
                </div>
              </div>
            </CardContent>
          </Card>


          <Card>
            <CardHeader>
              <CardTitle>4. Geografi og jobbsøk</CardTitle>
              <CardDescription>
                Hvor søker du jobb? Brukes som filter mot NAV, Careerjet og
                parsede e-post-jobbannonser.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <AutoSaveInput
                  label="Land"
                  value={p.target_country}
                  onSave={save("target_country")}
                  placeholder="Norge"
                />
                <label className="flex items-center gap-2 text-sm self-end pb-2">
                  <Checkbox
                    checked={!!p.willing_to_relocate}
                    onCheckedChange={async (v) => {
                      const { error } = await supabase
                        .from("profiles")
                        .update({ willing_to_relocate: !!v })
                        .eq("id", user.id);
                      if (error) toast.error(error.message);
                      qc.invalidateQueries({ queryKey: ["profile", user.id] });
                    }}
                  />
                  Åpen for flytting
                </label>
              </div>
              <JobSearchPrefs
                keywords={p.job_search_keywords ?? ""}
                locations={(p.preferred_locations ?? []) as string[]}
                onKeywordsChange={async (v) => {
                  await (supabase.from("profiles") as any)
                    .update({ job_search_keywords: v || null })
                    .eq("id", user.id);
                  qc.invalidateQueries({ queryKey: ["profile", user.id] });
                }}
                onLocationsChange={async (v) => {
                  // Synk første valgte sted også inn i target_city/target_region
                  // så eldre matching-koder fortsatt har data å jobbe med.
                  const first = v[0] ?? null;
                  const firstCity = first ? first.replace(/\s*\(.*\)\s*$/, "").trim() : null;
                  const firstRegion = (() => {
                    const m = first ? /\(([^)]+)\)\s*$/.exec(first) : null;
                    if (!m) return null;
                    const parts = m[1].split(",").map((s) => s.trim()).filter(Boolean);
                    return parts[parts.length - 1] ?? null;
                  })();
                  await (supabase.from("profiles") as any)
                    .update({
                      preferred_locations: v,
                      target_city: firstCity ?? p.target_city ?? null,
                      target_region: firstRegion ?? p.target_region ?? null,
                    })
                    .eq("id", user.id);
                  qc.invalidateQueries({ queryKey: ["profile", user.id] });
                }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>5. Kompensasjon og tilgjengelighet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <AutoSaveInput
                  label="Lønn min"
                  value={p.salary_expectation_min?.toString()}
                  onSave={save("salary_expectation_min", num)}
                />
                <AutoSaveInput
                  label="Lønn maks"
                  value={p.salary_expectation_max?.toString()}
                  onSave={save("salary_expectation_max", num)}
                />
                <AutoSaveInput label="Valuta" value={p.salary_currency} onSave={save("salary_currency")} />
              </div>
              <AutoSaveInput
                label="Tilgjengelig fra (åååå-mm-dd)"
                value={p.available_from}
                onSave={save("available_from")}
                placeholder="2026-08-01"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>6. Refleksjon</CardTitle>
              <CardDescription>
                Disse svarene gir bedre råd og enklere å skrive målrettede søknader.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <AutoSaveTextarea label="Hva motiverer deg?" value={p.motivation} onSave={save("motivation")} rows={3} />
              <AutoSaveTextarea label="Dine tre største styrker" value={p.strengths} onSave={save("strengths")} rows={3} />
              <AutoSaveTextarea label="Områder du jobber med å utvikle" value={p.weaknesses} onSave={save("weaknesses")} rows={3} />
              <AutoSaveTextarea label="Viktigste prestasjoner (kvantifisert)" value={p.achievements} onSave={save("achievements")} rows={4} />
              <AutoSaveTextarea label="Deal-breakers" value={p.deal_breakers} onSave={save("deal_breakers")} rows={3} />
              <AutoSaveTextarea label="Annet" value={p.additional_notes} onSave={save("additional_notes")} rows={3} />
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}

function buildMarkdown(p: any): string {
  const list = (arr?: string[] | null) => (arr?.length ? arr.map((x) => `- ${x}`).join("\n") : "_(ikke utfylt)_");
  const v = (x: any) => (x ?? "_(ikke utfylt)_");
  const loc = [p.target_city, p.target_region, p.target_country].filter(Boolean).join(", ") || "_(ikke utfylt)_";
  const salary =
    p.salary_expectation_min || p.salary_expectation_max
      ? `${p.salary_expectation_min ?? "?"}–${p.salary_expectation_max ?? "?"} ${p.salary_currency ?? ""}`.trim()
      : "_(ikke utfylt)_";

  return `# Om meg

**${v(p.headline)}**

${v(p.bio)}

- **Nåværende rolle:** ${v(p.current_role_title)}${p.current_employer ? ` @ ${p.current_employer}` : ""}
- **Erfaring:** ${p.years_experience ?? "?"} år

## Bransjer
${list(p.industries)}

## Nøkkelferdigheter
${list(p.skills)}

## Språk
${list(p.languages)}

## Hva jeg ser etter

- **Roller:** ${p.target_roles?.join(", ") || "_(ikke utfylt)_"}
- **Bransjer:** ${p.target_industries?.join(", ") || "_(ikke utfylt)_"}
- **Senioritet:** ${v(p.target_seniority)}
- **Arbeidsform:** ${p.work_types?.join(", ") || "_(ikke utfylt)_"}

## Geografi

- **Sted:** ${loc}
- **Åpen for flytting:** ${p.willing_to_relocate ? "Ja" : "Nei"}

## Kompensasjon og tilgjengelighet

- **Lønnsforventning:** ${salary}
- **Tilgjengelig fra:** ${v(p.available_from)}

## Refleksjon

### Motivasjon
${v(p.motivation)}

### Styrker
${v(p.strengths)}

### Utviklingsområder
${v(p.weaknesses)}

### Prestasjoner
${v(p.achievements)}

### Deal-breakers
${v(p.deal_breakers)}

### Annet
${v(p.additional_notes)}
`;
}
