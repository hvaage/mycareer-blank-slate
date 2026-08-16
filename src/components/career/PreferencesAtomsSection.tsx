// @ts-nocheck
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Heart, Loader2, Plus, RefreshCw, Shield, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";
import {
  EVIDENCE_ATOM_CATEGORIES,
  PREFERENCE_ATOM_DIMENSIONS,
  atomScoreBand,
  atomScoreBandLabelNb,
  getEvidenceAtomCategoryMeta,
  getPreferenceAtomDimensionMeta,
} from "@/lib/career-atoms";
import {
  deactivateEvidenceAtom,
  deactivatePreferenceAtom,
  invalidateUserAtomQueries,
  refreshUserAtoms,
  upsertEvidenceAtom,
  upsertPreferenceAtom,
  userEvidenceAtomsQuery,
  userPreferenceAtomsQuery,
  type UserEvidenceAtomRow,
  type UserPreferenceAtomRow,
} from "@/lib/queries/career-atoms";
import { computeCareerProfileCompleteness } from "@/lib/career-profile-completeness";
import type { UserCareerProfileRow } from "@/lib/queries/user-career-profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";

type Props = {
  userId: string;
  careerProfileId: string | null;
  profile: UserCareerProfileRow | null;
  profileLoading?: boolean;
};

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  return rows.reduce<Record<string, T[]>>((acc, r) => {
    const k = key(r);
    if (!acc[k]) acc[k] = [];
    acc[k].push(r);
    return acc;
  }, {});
}

export function PreferencesAtomsSection({ userId, careerProfileId, profile, profileLoading }: Props) {
  const qc = useQueryClient();
  const { data: prefRows = [] } = useQuery({ ...userPreferenceAtomsQuery(userId), enabled: !!userId });
  const { data: evRows = [] } = useQuery({ ...userEvidenceAtomsQuery(userId), enabled: !!userId });

  const { data: profileBrief } = useQuery({
    queryKey: ["profile-brief-for-atoms", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("linkedin_id, linkedin_vanity_url, cv_no_pdf_path, cv_en_pdf_path")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: documentTypes = [] } = useQuery({
    queryKey: ["user-document-types-for-atoms", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("document_type")
        .eq("user_id", userId)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map((r) => r.document_type);
    },
  });

  const hasCvDocument = useMemo(() => documentTypes.includes("cv"), [documentTypes]);

  const activePrefs = useMemo(() => prefRows.filter((r) => r.is_active), [prefRows]);
  const activeEv = useMemo(() => evRows.filter((r) => r.is_active), [evRows]);

  const completeness = useMemo(() => {
    if (profileLoading) {
      return {
        score: 0,
        missingAreas: [] as string[],
        summaryNb: "Laster karriereprofil…",
      };
    }
    return computeCareerProfileCompleteness(profile, activePrefs.length, activeEv.length, {
      userProfile: profileBrief ?? null,
      hasCvDocument,
    });
  }, [profile, profileLoading, activePrefs.length, activeEv.length, profileBrief, hasCvDocument]);

  /** Uten registrert erfaring eller ønsker hviler en prosent på ingenting. */
  const hasFoundation = activePrefs.length > 0 || activeEv.length > 0;

  const prefByDim = useMemo(() => groupBy(activePrefs, (r) => r.dimension), [activePrefs]);
  const evByCat = useMemo(() => groupBy(activeEv, (r) => r.category), [activeEv]);

  const [prefDim, setPrefDim] = useState<string>(PREFERENCE_ATOM_DIMENSIONS[0]!.id);
  const [prefLabel, setPrefLabel] = useState("");
  const [prefValue, setPrefValue] = useState("");
  const [prefImp, setPrefImp] = useState("4");

  const [evCat, setEvCat] = useState<string>(EVIDENCE_ATOM_CATEGORIES[0]!.id);
  const [evLabel, setEvLabel] = useState("");
  const [evDesc, setEvDesc] = useState("");

  const addPref = useMutation({
    mutationFn: async () => {
      const label = prefLabel.trim();
      if (!label) throw new Error("Skriv en kort label");
      const imp = parseInt(prefImp, 10);
      await upsertPreferenceAtom(userId, {
        career_profile_id: careerProfileId,
        dimension: prefDim,
        label,
        value: prefValue.trim() || null,
        importance_score: Number.isFinite(imp) ? Math.min(6, Math.max(1, imp)) : null,
        source: "manual",
      });
    },
    onSuccess: () => {
      toast.success("Lagt til");
      setPrefLabel("");
      setPrefValue("");
      qc.invalidateQueries({ queryKey: ["user-preference-atoms", userId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const addEv = useMutation({
    mutationFn: async () => {
      const label = evLabel.trim();
      if (!label) throw new Error("Skriv en kort label");
      await upsertEvidenceAtom(userId, {
        category: evCat,
        label,
        description: evDesc.trim() || null,
        source: "manual",
      });
    },
    onSuccess: () => {
      toast.success("Lagt til");
      setEvLabel("");
      setEvDesc("");
      qc.invalidateQueries({ queryKey: ["user-evidence-atoms", userId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke lagre"),
  });

  const delPref = useMutation({
    mutationFn: (id: string) => deactivatePreferenceAtom(userId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-preference-atoms", userId] }),
  });
  const delEv = useMutation({
    mutationFn: (id: string) => deactivateEvidenceAtom(userId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["user-evidence-atoms", userId] }),
  });

  const refreshAtoms = useMutation({
    mutationFn: () => refreshUserAtoms(userId),
    onSuccess: (data) => {
      invalidateUserAtomQueries(qc, userId);
      const w = data.warnings.length ? ` Merk: ${data.warnings.slice(0, 3).join(" · ")}` : "";
      toast.success(
        `Fant ${data.preferenceUpserted} ønske(r) og ${data.evidenceUpserted} ting du kan dokumentere.` +
          (data.deactivated ? ` ${data.deactivated} utdaterte linjer ble fjernet.` : "") +
          w,
      );
    },
    onError: (e: Error) => toast.error(e.message ?? "Kunne ikke oppdatere"),
  });

  return (
    <div className="space-y-4">
      <Card className="border-dashed border-primary/25">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hent fra det du allerede har lagt inn</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Vi leser CV, dokumenter, profilen din og arbeidsgivervurderingene dine, og foreslår hva som er viktig for
            deg og hva du kan dokumentere. Du starter det selv, og ingenting du har skrevet manuelt blir slettet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={refreshAtoms.isPending || !userId}
            onClick={() => refreshAtoms.mutate()}
            className="shrink-0"
          >
            {refreshAtoms.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden />
                Henter…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
                Hent forslag
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-primary/20 bg-muted/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hvor komplett er profilen din</CardTitle>
          <CardDescription>
            {hasFoundation
              ? completeness.summaryNb
              : "Vi viser ingen prosent før du har lagt inn grunnlaget. Et tall uten innhold bak sier ingenting."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {hasFoundation && !profileLoading ? (
            <div className="flex items-center gap-3">
              <Progress value={completeness.score} className="h-2 flex-1" />
              <span className="text-sm font-semibold tabular-nums w-12 text-right">{completeness.score}%</span>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-3 text-sm space-y-2">
              <p className="text-muted-foreground">Dette mangler før profilen kan brukes til noe:</p>
              <ul className="list-disc pl-4 text-sm space-y-0.5">
                <li>Rollene dine — last opp CV-en, så henter vi dem</li>
                <li>Hva du oppnådde i rollene</li>
                <li>Hva som er viktig for deg i neste jobb</li>
              </ul>
              <Button asChild size="sm" variant="secondary">
                <Link to="/about-me">Last opp CV</Link>
              </Button>
            </div>
          )}
          {hasFoundation && !profileLoading && completeness.missingAreas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Mangler fortsatt: </span>
              {completeness.missingAreas.slice(0, 6).join(" · ")}
              {completeness.missingAreas.length > 6 ? " …" : ""}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-1">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-primary shrink-0" aria-hidden />
              <CardTitle className="text-lg">Dette er viktig for deg</CardTitle>
            </div>
            <CardDescription>
              Vi bruker det til å sortere bort stillinger som bryter med det du har sagt er viktig, og til å forklare
              hvorfor et treff passer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activePrefs.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                <p>Ingenting registrert ennå.</p>
                <p className="text-xs leading-relaxed">
                  Trykk «Hent forslag» over, så leser vi CV, dokumenter og profilen din. Du kan også skrive inn selv
                  under.
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {Object.entries(prefByDim).map(([dim, atoms]) => {
                  const meta = getPreferenceAtomDimensionMeta(dim);
                  return (
                    <li key={dim}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        {meta?.labelNb ?? dim}
                      </p>
                      <ul className="space-y-2">
                        {atoms.map((a: UserPreferenceAtomRow) => (
                          <li
                            key={a.id}
                            className="flex items-start justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">{a.label}</p>
                              {a.value && <p className="text-xs text-muted-foreground truncate">{a.value}</p>}
                              {a.importance_score != null && (() => {
                                const b = atomScoreBand(a.importance_score);
                                return (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Viktighet: {a.importance_score}/6
                                  {b ? ` (${atomScoreBandLabelNb(b)})` : ""}
                                </p>
                                );
                              })()}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 h-8 w-8"
                              aria-label="Fjern"
                              disabled={delPref.isPending}
                              onClick={() => delPref.mutate(a.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground/90">Legg til for hånd</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Dimensjon</Label>
                  <Select value={prefDim} onValueChange={setPrefDim}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERENCE_ATOM_DIMENSIONS.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.labelNb}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Viktighet 1–6</Label>
                  <Input className="h-9" inputMode="numeric" value={prefImp} onChange={(e) => setPrefImp(e.target.value)} />
                  <p className="text-[11px] text-muted-foreground">Avgjør hvor tungt det veier når vi sorterer treff.</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kort label</Label>
                <Input className="h-9" placeholder="F.eks. «Betydning over ren lønn»" value={prefLabel} onChange={(e) => setPrefLabel(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Verdi / presisering (valgfritt)</Label>
                <Input className="h-9" placeholder="Fritekst" value={prefValue} onChange={(e) => setPrefValue(e.target.value)} />
              </div>
              <Button type="button" size="sm" disabled={addPref.isPending} onClick={() => addPref.mutate()}>
                <Plus className="h-4 w-4 mr-1" /> Legg til
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary shrink-0" aria-hidden />
              <CardTitle className="text-lg">Dette kan du dokumentere</CardTitle>
            </div>
            <CardDescription>
              Dette er det vi kan bruke i CV og søknad uten å finne på noe. Alt må kunne spores til noe du har gjort.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeEv.length === 0 ? (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground space-y-2">
                <p>Ingenting registrert ennå.</p>
                <p className="text-xs leading-relaxed">
                  Trykk «Hent forslag» over, så leser vi CV, dokumenter og profilen din. Du kan også skrive inn
                  eksempler selv under.
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {Object.entries(evByCat).map(([cat, atoms]) => {
                  const meta = getEvidenceAtomCategoryMeta(cat);
                  return (
                    <li key={cat}>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                        {meta?.labelNb ?? cat}
                      </p>
                      <ul className="space-y-2">
                        {atoms.map((a: UserEvidenceAtomRow) => (
                          <li
                            key={a.id}
                            className="flex items-start justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm"
                          >
                            <div className="min-w-0">
                              <p className="font-medium truncate">{a.label}</p>
                              {a.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{a.description}</p>
                              )}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="shrink-0 h-8 w-8"
                              aria-label="Fjern"
                              disabled={delEv.isPending}
                              onClick={() => delEv.mutate(a.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
              <p className="text-xs font-medium text-foreground/90">Legg til for hånd</p>
              <div className="space-y-1">
                <Label className="text-xs">Kategori</Label>
                <Select value={evCat} onValueChange={setEvCat}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVIDENCE_ATOM_CATEGORIES.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.labelNb}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Kort label</Label>
                <Input className="h-9" placeholder="F.eks. «Ledet produktlansering X»" value={evLabel} onChange={(e) => setEvLabel(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Beskrivelse (valgfritt)</Label>
                <Textarea className="min-h-[72px] text-sm" placeholder="Kontekst du kan utdype senere" value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
              </div>
              <Button type="button" size="sm" disabled={addEv.isPending} onClick={() => addEv.mutate()}>
                <Plus className="h-4 w-4 mr-1" /> Legg til
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
