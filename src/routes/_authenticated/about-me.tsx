import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { AutoSaveInput, AutoSaveTextarea } from "@/components/auto-save";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, Linkedin, Globe2, FileText, Briefcase, Download, LogOut, Trash2, User as UserIcon, Plug, Network } from "lucide-react";
import { toast } from "sonner";
import { EmailConnections } from "@/components/email-connections";
import { CvUploader } from "@/components/cv-uploader";
import { AboutMeCvSection } from "@/components/cv-upload/about-me-section";
import { JobSearchPrefs } from "@/components/job-search-prefs";
import { startLinkedInOAuth } from "@/lib/linkedin-oauth";

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
            Samlet oversikt over deg selv: integrasjoner, CV-arkiv, karriereoversikt,
            personlig profil og kontoinnstillinger. Endringer lagres automatisk, og
            spørreskjemaet under <strong>Kort om meg</strong> kan eksporteres som
            <code> about-me.md</code>.
            {" "}
            <Link to="/preferences" className="text-primary hover:underline font-medium">
              Karriereprofil for matching
            </Link>{" "}
            finner du på egen side.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportMarkdown}>
          <Download className="h-4 w-4 mr-2" /> Eksporter .md
        </Button>
      </div>

      <Tabs defaultValue="kort_om_meg" className="w-full">
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 h-auto gap-2 bg-transparent p-0">
          <TabsTrigger
            value="integrasjoner"
            className="flex flex-col items-center gap-1.5 h-auto py-4 border rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary"
          >
            <Plug className="h-5 w-5" />
            <span className="text-sm font-medium">Integrasjoner</span>
          </TabsTrigger>
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
          <TabsTrigger
            value="konto"
            className="flex flex-col items-center gap-1.5 h-auto py-4 border rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary"
          >
            <Briefcase className="h-5 w-5" />
            <span className="text-sm font-medium">Konto</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="integrasjoner" className="space-y-6 mt-6">
          <EmailConnections />
          <LinkedInConnection profile={p} />
          <JobBoardIntegrations />
        </TabsContent>

        <TabsContent value="cv" className="mt-6">
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
                  <Label className="text-xs">Senioritet</Label>
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4. Geografi</CardTitle>
              <CardDescription>Hvor søker du jobb?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-3 gap-4">
                <AutoSaveInput label="Land" value={p.target_country} onSave={save("target_country")} placeholder="Norge" />
                <AutoSaveInput label="Region / fylke" value={p.target_region} onSave={save("target_region")} placeholder="Oslo / Viken" />
                <AutoSaveInput label="By" value={p.target_city} onSave={save("target_city")} placeholder="Oslo" />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={!!p.willing_to_relocate}
                  onCheckedChange={async (v) => {
                    const { error } = await supabase.from("profiles").update({ willing_to_relocate: !!v }).eq("id", user.id);
                    if (error) toast.error(error.message);
                    qc.invalidateQueries({ queryKey: ["profile", user.id] });
                  }}
                />
                Åpen for flytting
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tilbudsvurdering</CardTitle>
              <CardDescription>
                Brukes når vi henter stillingsannonser fra Careerjet på Jobb-leads-siden.
              </CardDescription>
            </CardHeader>
            <CardContent>
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
                  await (supabase.from("profiles") as any)
                    .update({ preferred_locations: v })
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

        <TabsContent value="konto" className="mt-6">
          <AccountSection email={user.email ?? ""} userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function LinkedInConnection({ profile }: { profile: any }) {
  const connected = !!profile?.linkedin_connected_at;

  const handleConnect = () => {
    try {
      startLinkedInOAuth();
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke åpne LinkedIn");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Linkedin className="h-5 w-5" /> LinkedIn
        </CardTitle>
        <CardDescription>
          Koble til LinkedIn for å hente profildata (navn, headline, profilbilde).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <div className="space-y-2">
            <div className="flex items-start gap-3">
              {profile.linkedin_picture_url && (
                <img
                  src={profile.linkedin_picture_url}
                  alt=""
                  className="h-14 w-14 rounded-full object-cover ring-2 ring-border shrink-0"
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide bg-primary/10 text-primary px-2 py-0.5 rounded">
                Tilkoblet
              </span>
              <span className="text-muted-foreground">
                {new Date(profile.linkedin_connected_at).toLocaleDateString("nb-NO")}
              </span>
            </div>
            {profile.linkedin_headline && (
              <p className="text-sm text-foreground">{profile.linkedin_headline}</p>
            )}
            {profile.linkedin_vanity_url && (
              <a
                href={profile.linkedin_vanity_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary hover:underline break-all"
              >
                {profile.linkedin_vanity_url}
              </a>
            )}
            <Button variant="outline" size="sm" onClick={handleConnect}>
              Oppdater tilkobling
            </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button onClick={handleConnect}>
            <Linkedin className="h-4 w-4 mr-2" /> Koble til LinkedIn
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function JobBoardIntegrations() {
  const boards = [
    { key: "finn", name: "Finn.no", icon: Globe2, desc: "Hent stillingsannonser fra Finn.no" },
    { key: "dn", name: "DN Jobb", icon: Globe2, desc: "Stillinger fra Dagens Næringsliv" },
    { key: "fn", name: "FN-jobb", icon: Globe2, desc: "FN og internasjonale organisasjoner" },
    { key: "nav", name: "NAV / arbeidsplassen", icon: Globe2, desc: "Offentlig stillingsdatabase" },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobbportaler</CardTitle>
        <CardDescription>
          Koble til stillingsportaler for automatisk synk av leads og annonser. Kommer snart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-3">
          {boards.map((b) => (
            <div
              key={b.key}
              className="flex items-start gap-3 p-3 border rounded-lg bg-muted/20"
            >
              <b.icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{b.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    Kommer
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AccountSection({ email, userId }: { email: string; userId: string }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const changeEmail = async () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast.error("Skriv inn en gyldig e-post");
      return;
    }
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      toast.success("Bekreftelses-e-post sendt til " + newEmail);
      setNewEmail("");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke endre e-post");
    } finally {
      setSavingEmail(false);
    }
  };

  const changePassword = async () => {
    if (pwd.length < 8) {
      toast.error("Passordet må være minst 8 tegn");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("Passordene er ikke like");
      return;
    }
    setSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      toast.success("Passord oppdatert");
      setPwd(""); setPwd2("");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke oppdatere passord");
    } finally {
      setSavingPwd(false);
    }
  };

  const deleteMyData = async () => {
    if (!confirm("Slette ALL din data (søknader, dokumenter, leads, karriereoversikt, profil)? Dette kan ikke angres.")) return;
    try {
      await Promise.all([
        supabase.from("documents").delete().eq("user_id", userId),
        supabase.from("attachments").delete().eq("user_id", userId),
        supabase.from("contacts").delete().eq("user_id", userId),
        supabase.from("interviews").delete().eq("user_id", userId),
        supabase.from("job_leads").delete().eq("user_id", userId),
        supabase.from("email_connections").delete().eq("user_id", userId),
        supabase.from("user_company_ratings").delete().eq("user_id", userId),
        supabase.from("cv_evidence_atoms").delete().eq("user_id", userId),
        supabase.from("cv_imports").delete().eq("user_id", userId),
        supabase.from("applications").delete().eq("user_id", userId),
      ]);

      // Best-effort: rydd opp opplastede CV-filer fra storage (cv-uploads/<userId>/...)
      try {
        const { data: files } = await supabase.storage
          .from("cv-uploads")
          .list(userId, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${userId}/${f.name}`);
          await supabase.storage.from("cv-uploads").remove(paths);
        }
      } catch {
        // ignorer storage-feil — RLS-data er allerede slettet
      }

      toast.success("All din data er slettet");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke slette data");
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Slette kontoen din permanent? All data slettes også. Dette kan ikke angres.")) return;
    setDeleting(true);
    try {
      await deleteMyData();
      const { error } = await supabase.functions.invoke("delete-account");
      if (error) throw error;
      await signOut();
      toast.success("Konto slettet");
      navigate({ to: "/login" });
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke slette konto. Logg ut og kontakt support.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Konto</CardTitle>
        <CardDescription>Innlogget som <strong>{email}</strong></CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4" /> Bytt e-post
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="ny@epost.no"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Button size="sm" onClick={changeEmail} disabled={savingEmail}>
              {savingEmail ? "Sender…" : "Endre e-post"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Du må bekrefte den nye e-posten via en lenke som sendes til adressen.
          </p>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Bytt passord</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nytt passord</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Bekreft passord</Label>
              <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={changePassword} disabled={savingPwd}>
            {savingPwd ? "Lagrer…" : "Oppdater passord"}
          </Button>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Logg ut</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => { await signOut(); navigate({ to: "/login" }); }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Logg ut
          </Button>
        </div>

        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-destructive">Faresone</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={deleteMyData}>
              <Trash2 className="h-4 w-4 mr-2" /> Slett all min data
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteAccount} disabled={deleting}>
              <Trash2 className="h-4 w-4 mr-2" /> {deleting ? "Sletter…" : "Slett konto permanent"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            "Slett all min data" fjerner søknader, dokumenter, leads og kontakter, men beholder kontoen.
            "Slett konto" fjerner alt og logger deg ut.
          </p>
        </div>
      </CardContent>
    </Card>
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
