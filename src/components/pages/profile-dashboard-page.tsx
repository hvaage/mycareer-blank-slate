// @ts-nocheck
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpen,
  BriefcaseBusiness,
  FileSearch,
  FolderOpen,
  Pencil,
  Sparkles,
  Target,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getCareerStage } from "@/lib/career-stage";
import { getCareerLifePhase } from "@/lib/career-life-phase";
import { getAgeGroup } from "@/lib/age-group";
import { foundationStatusQuery } from "@/lib/queries/dashboard-status";
import { useReviewInboxCounts } from "@/lib/queries/review-inbox";
import { AgeSalaryContext } from "@/components/career/age-salary-context";
import { useCareerProfileAutosave } from "@/lib/career-profile-save";
import { AGE_GROUPS } from "@/lib/age-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const destinations = [
  { title: "Profilopplysninger", description: "Bakgrunn, jobbønsker og lønnsønske", to: "/min-profil/opplysninger", icon: Pencil },
  { title: "Karriereprofil", description: "Stilling, fase, stadium og aldersgruppe", to: "/min-profil/karriereretning", icon: Target },
  { title: "Erfaring og kompetanse", description: "Roller, resultater og kompetanser", to: "/karriere/erfaring", icon: BriefcaseBusiness },
  { title: "Gap mot målrolle", description: "Sammenlign grunnlaget ditt mot en målrolle", to: "/karriere/gap", icon: FileSearch },
  { title: "Legg til kilder", description: "Importer CV, LinkedIn og annen dokumentasjon", to: "/kilder", icon: FolderOpen },
  { title: "Gjennomgå forslag", description: "Ta stilling til forslag fra kildene", to: "/forslag", icon: Sparkles },
  { title: "Min dokumentasjon", description: "Dokumenter og genererte filer", to: "/documentation", icon: BookOpen },
] as const;

function formatSalary(min: number | null, max: number | null, currency: string | null) {
  if (min == null && max == null) return "Ikke oppgitt";
  const f = (value: number | null) => value == null ? "?" : new Intl.NumberFormat("nb-NO").format(value);
  return `${f(min)}–${f(max)} ${currency ?? "NOK"}`;
}

function formatUpdated(value: string | null) {
  if (!value) return "Ingen oppdatering registrert";
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(new Date(value));
}

export function ProfileDashboardPage() {
  const { user } = useAuth();
  const uid = user?.id ?? "";
  const review = useReviewInboxCounts(user?.id);
  const autosave = useCareerProfileAutosave(uid);
  const foundation = useQuery({ ...foundationStatusQuery(uid), enabled: !!uid });
  const overview = useQuery({
    queryKey: ["profile-dashboard", uid],
    enabled: !!uid,
    queryFn: async () => {
      const [profile, career, skills] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", uid).maybeSingle(),
        supabase.from("user_career_profiles").select("*").eq("user_id", uid).maybeSingle(),
        supabase.from("career_atoms").select("id, atom_type, atom_class, content_no, updated_at, viktighet").eq("user_id", uid).eq("is_active", true).eq("atom_kind", "evidens").order("viktighet", { ascending: false, nullsFirst: false }).limit(80),
      ]);
      if (profile.error) throw profile.error;
      if (career.error) throw career.error;
      if (skills.error) throw skills.error;
      return { profile: profile.data, career: career.data, atoms: skills.data ?? [] };
    },
  });

  if (!user) return null;
  if (overview.isLoading || foundation.isLoading) {
    return <div className="mx-auto max-w-6xl space-y-4 p-4 lg:p-8"><Skeleton className="h-40 w-full" /><Skeleton className="h-72 w-full" /></div>;
  }

  const profile = overview.data?.profile;
  const career = overview.data?.career;
  const atoms = overview.data?.atoms ?? [];
  const skills = atoms.filter((atom) => atom.atom_class === "kompetanse" || atom.atom_class === "eksponering" || atom.atom_type === "skill").slice(0, 8);
  const stage = getCareerStage(career?.career_stage);
  const phase = getCareerLifePhase(career?.career_life_phase);
  const age = getAgeGroup(career?.age_group);
  const updated = [profile?.updated_at, career?.updated_at, ...atoms.map((atom) => atom.updated_at)].filter(Boolean).sort().at(-1) ?? null;
  const reviewCount = review.data?.total ?? 0;
  const suggestions = [
    !career?.current_occupation_title && { label: "Velg nåværende stilling fra yrkesregisteret", to: "/min-profil/karriereretning" },
    !career?.age_group && { label: "Legg inn aldersgruppe for lønnssammenligning", to: "/min-profil/karriereretning" },
    (foundation.data?.roles ?? 0) === 0 && { label: "Legg til minst én rolle i karrieregrunnlaget", to: "/karriere/erfaring" },
    reviewCount > 0 && { label: `${reviewCount} elementer kan gjennomgås`, to: "/forslag" },
  ].filter(Boolean).slice(0, 3);

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-4 lg:p-8">
      <header className="flex flex-col gap-5 border-b pb-7 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <UserAvatar size="xl" />
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Min profil</p>
            <h1 className="truncate text-3xl font-bold">{profile?.full_name ?? profile?.display_name ?? user.email ?? "Din karriere"}</h1>
            <p className="mt-1 text-muted-foreground">{career?.current_occupation_title ?? profile?.current_role_title ?? "Nåværende stilling er ikke oppgitt"}{profile?.current_employer ? ` · ${profile.current_employer}` : ""}</p>
          </div>
        </div>
        <Button asChild variant="outline"><Link to="/min-profil/opplysninger"><Pencil className="mr-2 h-4 w-4" />Rediger profil</Link></Button>
      </header>

      <section aria-labelledby="profile-summary" className="space-y-4">
        <div className="flex items-end justify-between gap-4"><div><h2 id="profile-summary" className="text-xl font-semibold">Karrieregrunnlaget ditt</h2><p className="text-sm text-muted-foreground">Sist oppdatert {formatUpdated(updated)}</p></div></div>
        <div className="grid border-y sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="Bransje" value={(profile?.industries ?? profile?.target_industries ?? []).slice(0, 2).join(", ") || "Ikke oppgitt"} />
          <Summary label="Karrierestadium" value={stage?.labelNb ?? "Ikke valgt"} />
          <Summary label="Karrierefase" value={phase?.labelNb ?? "Ikke valgt"} detail={age?.labelNb ?? undefined} />
          <Summary label="Lønnsønske" value={formatSalary(profile?.salary_expectation_min ?? null, profile?.salary_expectation_max ?? null, profile?.salary_currency ?? null)} />
        </div>
        <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium">Viktigste kompetanser</h3><Button asChild variant="ghost" size="sm"><Link to="/karriere/erfaring">Se alle <ArrowRight className="ml-1 h-4 w-4" /></Link></Button></div><div className="flex flex-wrap gap-2">{skills.length ? skills.map((skill) => <Badge key={skill.id} variant="secondary">{skill.content_no}</Badge>) : <p className="text-sm text-muted-foreground">Ingen kompetanser er registrert ennå.</p>}</div></div>
          <dl className="grid grid-cols-3 divide-x border-y py-3 text-center"><Metric label="Roller" value={foundation.data?.roles ?? 0} /><Metric label="Resultater" value={foundation.data?.results ?? 0} /><Metric label="Kompetanser" value={foundation.data?.competences ?? 0} /></dl>
        </div>
      </section>

      <section aria-label="Lønnssammenligning" className="max-w-2xl space-y-3">
        <div className="space-y-2">
          <Label htmlFor="dashboard_age_group">Aldersgruppe</Label>
          <Select
            value={career?.age_group || "__empty"}
            onValueChange={(v) => autosave.save({ age_group: v === "__empty" ? null : v })}
          >
            <SelectTrigger id="dashboard_age_group" className="w-full">
              <SelectValue placeholder="Velg aldersgruppe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty">Ikke valgt</SelectItem>
              {AGE_GROUPS.map((a) => (
                <SelectItem key={a.code} value={a.code}>{a.labelNb}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {autosave.saving ? "Lagrer …" : "Valgene her lagres automatisk."}
          </p>
        </div>
        {career?.age_group ? (
          <AgeSalaryContext
            ageGroup={career.age_group}
            industrySlug={career?.primary_industry ?? null}
            onIndustryChange={(slug) => autosave.save({ primary_industry: slug })}
            preferredIndustryName={(profile?.industries ?? profile?.target_industries ?? [])[0] ?? null}
          />
        ) : null}
      </section>

      {suggestions.length > 0 && <section aria-labelledby="profile-next" className="border-y py-5"><h2 id="profile-next" className="mb-3 text-lg font-semibold">Foreslåtte oppdateringer</h2><div className="grid gap-2 md:grid-cols-3">{suggestions.map((item) => <Link key={item.label} to={item.to} className="flex items-center justify-between border-l-2 border-primary py-2 pl-3 text-sm font-medium hover:text-primary">{item.label}<ArrowRight className="h-4 w-4" /></Link>)}</div></section>}

      <section aria-labelledby="career-areas"><h2 id="career-areas" className="mb-4 text-xl font-semibold">Min karriere</h2><div className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2 lg:grid-cols-3">{destinations.map(({ title, description, to, icon: Icon }) => <Link key={to} to={to} className="group flex min-h-28 items-start gap-3 bg-background p-4 hover:bg-muted/50"><Icon className="mt-0.5 h-5 w-5 text-muted-foreground group-hover:text-primary" /><div><h3 className="font-medium">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div><ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" /></Link>)}</div></section>
    </main>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="min-w-0 border-b p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words font-medium">{value}</p>{detail && <p className="text-xs text-muted-foreground">{detail}</p>}</div>; }
function Metric({ label, value }: { label: string; value: number }) { return <div><dd className="text-2xl font-semibold">{value}</dd><dt className="text-xs text-muted-foreground">{label}</dt></div>; }