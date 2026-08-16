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
import { getCareerStage } from "@/lib/career-stage";
import { FormSection, sectionStatus } from "@/components/form/form-section";
import { PageSectionNav } from "@/components/layout/page-section-nav";
import { usePersistedCollapse } from "@/hooks/use-persisted-collapse";



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

/** Viser hvor brukeren står i dag, der han svarer på hvilket nivå han søker. */
function CareerStageContext({ userId }: { userId: string }) {
  const { data } = useQuery({
    queryKey: ["career-stage-context", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_career_profiles")
        .select("career_stage")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const stage = data?.career_stage ? getCareerStage(data.career_stage) : null;
  if (!stage) return null;
  return (
    <p className="text-[11px] text-muted-foreground mb-1">
      Karrierestadium i dag: <span className="text-foreground/80 font-medium">{stage.labelNb}</span>{" "}
      <Link to="/preferences" className="text-primary hover:underline">
        endre
      </Link>
    </p>
  );
}

function AboutMePage() {

  const { user } = useAuth();
  const qc = useQueryClient();
  const collapse = usePersistedCollapse("about-me:sections", true);
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

  const saveArrayToggle = async (field: string, arr: string[], code: string, on: boolean) => {
    const next = on ? Array.from(new Set([...arr, code])) : arr.filter((c) => c !== code);
    const { error } = await (supabase.from("profiles") as any).update({ [field]: next }).eq("id", user.id);
    if (error) toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["profile", user.id] });
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

  const filledCount = (...vals: unknown[]) =>
    vals.filter((v) => {
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === "string") return v.trim().length > 0;
      if (typeof v === "number") return Number.isFinite(v);
      return v === true;
    }).length;

  const sections = [
    {
      id: "om-deg",
      label: "Kort om deg",
      why: "Åpningen i søknadsbrev, og bakgrunnen selskapsanalysen bruker når den vurderer om du passer.",
      filled: filledCount(p.headline, p.bio, p.years_experience, p.current_role_title, p.current_employer),
      total: 5,
    },
    {
      id: "bakgrunn",
      label: "Bakgrunn",
      why: "Bransjer, ferdigheter og språk vektes direkte når en stilling scores.",
      filled: filledCount(p.industries, p.skills, p.languages),
      total: 3,
    },
    {
      id: "onsket-jobb",
      label: "Ønsket jobb",
      why: "Dette er filteret. Stillinger utenfor det du svarer her, kommer ikke opp i Jobber.",
      filled: filledCount(
        p.target_roles,
        p.target_industries,
        p.target_seniority,
        p.work_types,
        p.preferred_work_extents,
        p.preferred_engagement_types,
        p.salary_expectation_min ?? p.salary_expectation_max,
        p.available_from,
      ),
      total: 8,
    },
    {
      id: "geografi",
      label: "Geografi og søkeord",
      why: "Styrer hva vi henter inn fra NAV og Careerjet i det hele tatt.",
      filled: filledCount(p.preferred_locations, p.job_search_keywords, p.target_country, p.willing_to_relocate),
      total: 4,
    },
    {
      id: "utdypning",
      label: "Utdypning",
      why: "Fritekst som bare brukes av selskapsanalysen og søknadsbrevene — ikke av jobbfilteret.",
      filled: filledCount(p.motivation, p.strengths, p.weaknesses, p.deal_breakers, p.additional_notes),
      total: 5,
    },
  ];

  const isSectionOpen = (s: (typeof sections)[number]) =>
    collapse.isOpen(s.id, sectionStatus(s.filled, s.total) !== "ferdig");

  return (
    <div className="p-4 lg:p-6 max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Om meg</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Svarene her styrer hvilke stillinger du får se, og hva søknadene dine bygger på. Alt lagres mens du skriver.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportMarkdown}>
          <Download className="h-4 w-4 mr-2" /> Eksporter .md
        </Button>
      </div>

      <Tabs defaultValue="kort_om_meg" className="w-full">
        <TabsList className="h-auto gap-1 p-1">
          <TabsTrigger value="kort_om_meg" className="gap-1.5 text-sm">
            <UserIcon className="h-4 w-4" /> Svarene dine
          </TabsTrigger>
          <TabsTrigger value="karriereoversikt" className="gap-1.5 text-sm">
            <Network className="h-4 w-4" /> Karriereoversikt
          </TabsTrigger>
          <TabsTrigger value="cv" className="gap-1.5 text-sm">
            <FileText className="h-4 w-4" /> CV-filer
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cv" className="mt-4 space-y-3">
          <p className="max-w-prose text-sm text-muted-foreground">
            Filene her lagres som de er. Skal innholdet bli karrieredata du kan bekrefte, laster du opp CV-en under{" "}
            <strong>Karriereoversikt</strong>.
          </p>
          <CvUploader
            userId={user.id}
            profile={p}
            onChanged={() => qc.invalidateQueries({ queryKey: ["profile", user.id] })}
          />
        </TabsContent>

        <TabsContent value="karriereoversikt" className="mt-4">
          <AboutMeCvSection userId={user.id} />
        </TabsContent>

        <TabsContent value="kort_om_meg" className="space-y-3 mt-4">
          <PageSectionNav
            top={0}
            sections={sections.map((s) => ({
              id: s.id,
              label: s.label,
              status: sectionStatus(s.filled, s.total),
            }))}
          />

          <FormSection
            id="om-deg"
            title="Kort om deg"
            why={sections[0].why}
            filled={sections[0].filled}
            total={sections[0].total}
            open={isSectionOpen(sections[0])}
            onToggle={() => collapse.toggle(sections[0].id)}
          >
            <AutoSaveInput
              label="Overskrift"
              value={p.headline}
              onSave={save("headline")}
              placeholder="f.eks. Erfaren produktleder med bakgrunn i fintech"
            />
            <div className="max-w-prose">
              <AutoSaveTextarea
                label="Kort biografi"
                value={p.bio}
                rows={4}
                onSave={save("bio")}
                placeholder="3–5 setninger om bakgrunn og hva du er god til."
              />
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <AutoSaveInput
                label="År med erfaring"
                value={p.years_experience?.toString()}
                onSave={save("years_experience", num)}
              />
              <AutoSaveInput label="Nåværende rolle" value={p.current_role_title} onSave={save("current_role_title")} />
              <AutoSaveInput label="Nåværende arbeidsgiver" value={p.current_employer} onSave={save("current_employer")} />
            </div>
          </FormSection>

          <FormSection
            id="bakgrunn"
            title="Bakgrunn"
            why={sections[1].why}
            filled={sections[1].filled}
            total={sections[1].total}
            open={isSectionOpen(sections[1])}
            onToggle={() => collapse.toggle(sections[1].id)}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <AutoSaveInput
                label="Bransjer du har jobbet i"
                value={p.industries?.join(", ")}
                onSave={save("industries", csvList)}
                placeholder="fintech, SaaS, helse"
              />
              <AutoSaveInput
                label="Språk"
                value={p.languages?.join(", ")}
                onSave={save("languages", csvList)}
                placeholder="norsk, engelsk, tysk"
              />
            </div>
            <AutoSaveInput
              label="Nøkkelferdigheter"
              value={p.skills?.join(", ")}
              onSave={save("skills", csvList)}
              placeholder="ledelse, produktstrategi, P&L"
            />
            <p className="text-xs text-muted-foreground">
              Skriv kommaseparert. Det du kan dokumentere med eksempler, hører hjemme under{" "}
              <Link to="/karriere/erfaring" className="text-primary hover:underline">
                Erfaring og kompetanse
              </Link>
              .
            </p>
          </FormSection>

          <FormSection
            id="onsket-jobb"
            title="Ønsket jobb"
            why={sections[2].why}
            filled={sections[2].filled}
            total={sections[2].total}
            open={isSectionOpen(sections[2])}
            onToggle={() => collapse.toggle(sections[2].id)}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <AutoSaveInput
                label="Ønskede roller"
                value={p.target_roles?.join(", ")}
                onSave={save("target_roles", csvList)}
                placeholder="CFO, Finansdirektør, COO"
              />
              <AutoSaveInput
                label="Ønskede bransjer"
                value={p.target_industries?.join(", ")}
                onSave={save("target_industries", csvList)}
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
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

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs mb-1.5 block">Stillingsomfang</Label>
                <div className="flex flex-wrap gap-4">
                  {[
                    { code: "full_time", label: "Heltid" },
                    { code: "part_time", label: "Deltid" },
                  ].map((opt) => {
                    const arr: string[] = Array.isArray(p.preferred_work_extents) ? p.preferred_work_extents : [];
                    return (
                      <label key={opt.code} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={arr.includes(opt.code)}
                          onCheckedChange={(v) => saveArrayToggle("preferred_work_extents", arr, opt.code, !!v)}
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </div>
              <div>
                <Label className="text-xs mb-1.5 block">Ansettelsesforhold</Label>
                <div className="flex flex-wrap gap-4">
                  {[
                    { code: "permanent", label: "Fast" },
                    { code: "temporary", label: "Vikariat" },
                    { code: "project", label: "Prosjekt" },
                    { code: "interim", label: "Interim" },
                  ].map((opt) => {
                    const arr: string[] = Array.isArray(p.preferred_engagement_types) ? p.preferred_engagement_types : [];
                    return (
                      <label key={opt.code} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={arr.includes(opt.code)}
                          onCheckedChange={(v) => saveArrayToggle("preferred_engagement_types", arr, opt.code, !!v)}
                        />
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Står avkrysningene tomme, filtrerer vi ikke på dem.</p>

            <div className="grid sm:grid-cols-3 gap-3">
              <AutoSaveInput
                label="Lønn fra (NOK)"
                value={p.salary_expectation_min?.toString()}
                onSave={save("salary_expectation_min", num)}
              />
              <AutoSaveInput
                label="Lønn til (NOK)"
                value={p.salary_expectation_max?.toString()}
                onSave={save("salary_expectation_max", num)}
              />
              <AutoSaveInput
                label="Tilgjengelig fra"
                value={p.available_from}
                onSave={save("available_from")}
                placeholder="åååå-mm-dd"
              />
            </div>
          </FormSection>

          <FormSection
            id="geografi"
            title="Geografi og søkeord"
            why={sections[3].why}
            filled={sections[3].filled}
            total={sections[3].total}
            open={isSectionOpen(sections[3])}
            onToggle={() => collapse.toggle(sections[3].id)}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <AutoSaveInput label="Land" value={p.target_country} onSave={save("target_country")} placeholder="Norge" />
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
                // Første valgte sted speiles til target_city/target_region,
                // som eldre matching fortsatt leser.
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
          </FormSection>

          <FormSection
            id="utdypning"
            title="Utdypning"
            why={sections[4].why}
            filled={sections[4].filled}
            total={sections[4].total}
            open={isSectionOpen(sections[4])}
            onToggle={() => collapse.toggle(sections[4].id)}
          >
            <div className="max-w-prose space-y-3">
              <AutoSaveTextarea label="Hva motiverer deg?" value={p.motivation} onSave={save("motivation")} rows={3} />
              <AutoSaveTextarea label="Dine tre største styrker" value={p.strengths} onSave={save("strengths")} rows={3} />
              <AutoSaveTextarea
                label="Områder du jobber med å utvikle"
                value={p.weaknesses}
                onSave={save("weaknesses")}
                rows={3}
              />
              <AutoSaveTextarea label="Deal-breakers" value={p.deal_breakers} onSave={save("deal_breakers")} rows={3} />
              <AutoSaveTextarea label="Annet" value={p.additional_notes} onSave={save("additional_notes")} rows={3} />
              <p className="text-xs text-muted-foreground">
                Prestasjoner skriver du ikke her lenger — de hører under{" "}
                <Link to="/karriere/erfaring" className="text-primary hover:underline">
                  Erfaring og kompetanse
                </Link>
                , der de kan knyttes til rollen de kom fra.
              </p>
            </div>
          </FormSection>
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
