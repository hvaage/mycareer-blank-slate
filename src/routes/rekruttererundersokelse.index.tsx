// @ts-nocheck
import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Shield, Lock, ChevronRight, ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import {
  getActiveSurvey,
  submitSurvey,
  signupForResults,
} from "@/lib/recruiter-survey.functions";
import {
  RESPONDENT_TYPES,
  INDUSTRIES,
  SENIORITY_LEVELS,
  YEARS_EXPERIENCE,
  CANDIDATE_FOCUS,
  SECTORS,
} from "@/lib/recruiter-survey-constants";

export const Route = createFileRoute("/rekruttererundersokelse/")({
  head: () => ({
    meta: [
      { title: "Rekruttererundersøkelsen 2026 — Karrierenmin" },
      {
        name: "description",
        content:
          "Anonym undersøkelse for headhuntere, executive search-konsulenter og rekrutterere. Bidra til bedre verktøy for jobbsøkere.",
      },
      { property: "og:title", content: "Rekruttererundersøkelsen 2026 — Karrierenmin" },
      {
        property: "og:description",
        content:
          "Anonym undersøkelse om hvordan rekrutterere vurderer kandidater i dagens marked.",
      },
    ],
  }),
  component: SurveyPage,
  errorComponent: ({ error, reset }) => (
    <div className="mx-auto max-w-xl px-6 py-20 text-center">
      <h1 className="text-xl font-semibold">Kunne ikke laste undersøkelsen</h1>
      <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      <Button className="mt-6" onClick={reset}>Prøv igjen</Button>
    </div>
  ),
  notFoundComponent: () => <p className="p-10">Ikke funnet.</p>,
});

const STORAGE_KEY = "kmn.recruiter-survey.submitted-v1";

function simpleHash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function SurveyPage() {
  const navigate = useNavigate();
  const fetchSurvey = useServerFn(getActiveSurvey);
  const submitFn = useServerFn(submitSurvey);
  const signupFn = useServerFn(signupForResults);

  const { data, isLoading, error } = useQuery({
    queryKey: ["active-survey"],
    queryFn: () => fetchSurvey(),
    staleTime: 60_000,
  });

  const [step, setStep] = useState(0); // 0 = intro+profile, 1..n = questions
  const [profile, setProfile] = useState({
    respondent_type: "",
    industries: [] as string[],
    seniority_levels: [] as string[],
    years_experience: "",
    candidate_focus: "",
    sector: "",
  });
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [wantsResults, setWantsResults] = useState(false);
  const [signup, setSignup] = useState({ name: "", email: "" });

  const questions = data?.questions ?? [];
  const totalSteps = 1 + questions.length;
  const progress = Math.round((step / Math.max(totalSteps - 1, 1)) * 100);

  useEffect(() => {
    if (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) {
      // soft warning; we still allow access but show notice via toast
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center text-muted-foreground">
          Laster undersøkelsen…
        </div>
      </div>
    );
  }
  if (error || !data?.version) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="mx-auto max-w-2xl px-6 py-20 text-center">
          <h1 className="text-xl font-semibold">Ingen aktiv undersøkelse</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Kom tilbake snart.
          </p>
        </div>
        <Footer />
      </div>
    );
  }

  const toggleArray = (arr: string[], v: string, max?: number | null) => {
    if (arr.includes(v)) return arr.filter((x) => x !== v);
    if (max && arr.length >= max) return arr;
    return [...arr, v];
  };

  function profileValid() {
    return (
      !!profile.respondent_type &&
      profile.industries.length > 0 &&
      profile.seniority_levels.length > 0 &&
      !!profile.years_experience &&
      !!profile.candidate_focus &&
      !!profile.sector
    );
  }

  function questionAnswered(q: any) {
    if (!q.is_required) return true;
    if (q.question_type === "open_text") {
      return (texts[q.id] ?? "").trim().length > 0;
    }
    if (q.question_type === "multi_choice" || q.question_type === "ranked_choice") {
      const a = answers[q.id];
      return Array.isArray(a) && a.length > 0;
    }
    const a = answers[q.id];
    return a !== undefined && a !== null && a !== "";
  }

  const currentQ = step > 0 ? questions[step - 1] : null;
  const canAdvance = step === 0 ? profileValid() : currentQ ? questionAnswered(currentQ) : true;

  async function handleSubmit() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const screen =
        typeof window !== "undefined"
          ? `${window.screen.width}x${window.screen.height}`
          : "";
      const submission_hash = simpleHash(
        `${data!.version!.id}|${ua}|${screen}|${profile.respondent_type}|${profile.years_experience}`,
      );

      const answerPayload = questions
        .map((q: any) => {
          if (q.question_type === "open_text") {
            const t = (texts[q.id] ?? "").trim();
            if (!t) return null;
            return { question_id: q.id, answer_value: t, text_answer: t };
          }
          const a = answers[q.id];
          if (a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0)) {
            return null;
          }
          return { question_id: q.id, answer_value: a, text_answer: null };
        })
        .filter(Boolean) as any[];

      const result = await submitFn({
        data: {
          versionId: data!.version!.id,
          profile,
          answers: answerPayload,
          submission_hash,
          user_agent: ua,
        },
      });

      if (wantsResults && signup.email.trim()) {
        try {
          await signupFn({
            data: {
              versionId: data!.version!.id,
              name: signup.name,
              email: signup.email,
            },
          });
        } catch (e: any) {
          toast.error(e?.message ?? "Kunne ikke lagre e-post");
        }
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      }

      navigate({
        to: "/rekruttererundersokelse/takk",
        search: { duplicate: result.duplicate ? 1 : 0 },
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Noe gikk galt. Prøv igjen.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Bransjeundersøkelse · Karrierenmin
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          {data.version.title}
        </h1>

        <Card className="mt-6 border-rule bg-muted/30 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
            <p className="text-sm leading-relaxed text-foreground">
              Takk for at du bidrar. Denne undersøkelsen er <strong>anonym</strong> og brukes til å forstå
              hvordan rekrutterere, headhuntere og Search-konsulenter vurderer kandidater i dagens arbeidsmarked.
              Innsikten brukes til å utvikle bedre verktøy for jobbsøkere. Du kan velge å legge igjen e-post
              separat dersom du ønsker tilgang til resultatene når analysen er klar.
            </p>
          </div>
        </Card>

        <div className="mt-8 mb-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Steg {step + 1} av {totalSteps}
          </span>
          <span>{progress}%</span>
        </div>
        <Progress value={progress} className="mb-8 h-1.5" />

        {step === 0 && (
          <Card className="p-5 sm:p-6 space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Om deg som respondent</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Disse opplysningene brukes kun for å bryte ned resultatene, og lagres som anonyme kategorier.
              </p>
            </div>

            <Field label="Type respondent" required>
              <RadioGroup
                value={profile.respondent_type}
                onValueChange={(v) => setProfile((p) => ({ ...p, respondent_type: v }))}
                className="grid grid-cols-1 gap-1.5 sm:grid-cols-2"
              >
                {RESPONDENT_TYPES.map((t) => (
                  <label key={t} className="flex cursor-pointer items-center gap-2 rounded-md border border-rule p-2 text-sm hover:bg-muted/50">
                    <RadioGroupItem value={t} /> {t}
                  </label>
                ))}
              </RadioGroup>
            </Field>

            <Field label="Primære bransjer" required hint="Velg én eller flere">
              <CheckGrid
                options={INDUSTRIES as unknown as string[]}
                selected={profile.industries}
                onChange={(v) => setProfile((p) => ({ ...p, industries: toggleArray(p.industries, v) }))}
              />
            </Field>

            <Field label="Hvilket nivå rekrutterer du oftest til?" required hint="Velg én eller flere">
              <CheckGrid
                options={SENIORITY_LEVELS as unknown as string[]}
                selected={profile.seniority_levels}
                onChange={(v) =>
                  setProfile((p) => ({ ...p, seniority_levels: toggleArray(p.seniority_levels, v) }))
                }
              />
            </Field>

            <Field label="Antall år erfaring med rekruttering" required>
              <SelectChips
                options={YEARS_EXPERIENCE as unknown as string[]}
                value={profile.years_experience}
                onChange={(v) => setProfile((p) => ({ ...p, years_experience: v }))}
              />
            </Field>

            <Field label="Jobber du primært med…" required>
              <SelectChips
                options={CANDIDATE_FOCUS as unknown as string[]}
                value={profile.candidate_focus}
                onChange={(v) => setProfile((p) => ({ ...p, candidate_focus: v }))}
              />
            </Field>

            <Field label="Primær sektor" required>
              <SelectChips
                options={SECTORS as unknown as string[]}
                value={profile.sector}
                onChange={(v) => setProfile((p) => ({ ...p, sector: v }))}
              />
            </Field>
          </Card>
        )}

        {step > 0 && currentQ && (
          <Card className="p-5 sm:p-6">
            {currentQ.category && (
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {currentQ.category}
              </p>
            )}
            <h2 className="mt-2 text-lg font-semibold leading-snug">
              {currentQ.question_text}
              {currentQ.is_required && <span className="text-destructive"> *</span>}
            </h2>
            {currentQ.max_choices && (
              <p className="mt-1 text-xs text-muted-foreground">
                {currentQ.question_type === "ranked_choice"
                  ? `Velg opptil ${currentQ.max_choices} i prioritert rekkefølge — første klikk = 1. mest vanlig.`
                  : `Maks ${currentQ.max_choices} valg`}
              </p>
            )}

            <div className="mt-5">
              <QuestionInput
                q={currentQ}
                value={answers[currentQ.id]}
                textValue={texts[currentQ.id] ?? ""}
                onValueChange={(v) => setAnswers((a) => ({ ...a, [currentQ.id]: v }))}
                onTextChange={(t) => setTexts((s) => ({ ...s, [currentQ.id]: t }))}
              />
            </div>
          </Card>
        )}

        {step === totalSteps - 1 && (
          <Card className="mt-6 p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
              <div>
                <h3 className="text-sm font-semibold">Vil du få tilsendt resultatene?</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  E-post og navn lagres separat og kan ikke kobles til svarene dine.
                </p>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={wantsResults} onCheckedChange={(v) => setWantsResults(!!v)} />
                Ja, send meg resultatene når analysen er klar.
              </label>
              {wantsResults && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Navn (valgfritt)</Label>
                    <Input
                      value={signup.name}
                      onChange={(e) => setSignup((s) => ({ ...s, name: e.target.value }))}
                      placeholder="Navn"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">E-post</Label>
                    <Input
                      type="email"
                      value={signup.email}
                      onChange={(e) => setSignup((s) => ({ ...s, email: e.target.value }))}
                      placeholder="navn@firma.no"
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0 || submitting}
          >
            <ChevronLeft className="mr-1 h-4 w-4" /> Tilbake
          </Button>

          {step < totalSteps - 1 ? (
            <Button
              onClick={() => setStep((s) => s + 1)}
              disabled={!canAdvance}
              className="w-full sm:w-auto"
            >
              Neste <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={!canAdvance || submitting || (wantsResults && !signup.email.trim())}
              className="w-full sm:w-auto"
            >
              {submitting ? "Sender…" : "Send inn anonymt"}
            </Button>
          )}
        </div>

        <PrivacyNote />
      </main>
      <Footer />
    </div>
  );
}

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function CheckGrid({
  options, selected, onChange,
}: { options: string[]; selected: string[]; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {options.map((o) => {
        const on = selected.includes(o);
        return (
          <label
            key={o}
            className={`flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm transition ${
              on ? "border-foreground bg-foreground/5" : "border-rule hover:bg-muted/50"
            }`}
          >
            <Checkbox checked={on} onCheckedChange={() => onChange(o)} />
            <span>{o}</span>
          </label>
        );
      })}
    </div>
  );
}

function SelectChips({
  options, value, onChange,
}: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded-full border px-3 py-1.5 text-xs transition ${
              on ? "border-foreground bg-foreground text-background" : "border-rule hover:bg-muted/50"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function QuestionInput({
  q, value, textValue, onValueChange, onTextChange,
}: {
  q: any;
  value: any;
  textValue: string;
  onValueChange: (v: any) => void;
  onTextChange: (t: string) => void;
}) {
  if (q.question_type === "open_text") {
    return (
      <Textarea
        value={textValue}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Skriv her…"
        rows={5}
        maxLength={2000}
      />
    );
  }
  if (q.question_type === "single_choice") {
    return (
      <RadioGroup value={value ?? ""} onValueChange={onValueChange} className="space-y-1.5">
        {(q.options as string[]).map((o) => (
          <label
            key={o}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-rule p-2.5 text-sm hover:bg-muted/50"
          >
            <RadioGroupItem value={o} /> {o}
          </label>
        ))}
      </RadioGroup>
    );
  }
  if (q.question_type === "multi_choice") {
    const arr: string[] = Array.isArray(value) ? value : [];
    const max = q.max_choices ?? null;
    return (
      <div className="space-y-1.5">
        {(q.options as string[]).map((o) => {
          const on = arr.includes(o);
          const disabled = !on && max ? arr.length >= max : false;
          return (
            <label
              key={o}
              className={`flex cursor-pointer items-center gap-2 rounded-md border p-2.5 text-sm transition ${
                on ? "border-foreground bg-foreground/5" : "border-rule hover:bg-muted/50"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <Checkbox
                checked={on}
                disabled={disabled}
                onCheckedChange={() => {
                  if (on) onValueChange(arr.filter((x) => x !== o));
                  else if (!disabled) onValueChange([...arr, o]);
                }}
              />
              <span>{o}</span>
            </label>
          );
        })}
      </div>
    );
  }
  if (q.question_type === "scale") {
    const min = q.scale_min ?? 1;
    const max = q.scale_max ?? 10;
    const nums = Array.from({ length: max - min + 1 }, (_, i) => i + min);
    return (
      <div>
        <div className="flex flex-wrap gap-1.5">
          {nums.map((n) => {
            const on = value === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => onValueChange(n)}
                className={`h-10 w-10 rounded-md border text-sm transition ${
                  on ? "border-foreground bg-foreground text-background" : "border-rule hover:bg-muted/50"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex justify-between text-[11px] text-muted-foreground">
          <span>{min} = {q.scale_min_label}</span>
          <span>{q.scale_mid_label}</span>
          <span>{max} = {q.scale_max_label}</span>
        </div>
      </div>
    );
  }
  return null;
}

function PrivacyNote() {
  return (
    <div className="mt-10 rounded-lg border border-rule bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
      <p className="font-semibold text-foreground">Personvern</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Svarene er anonyme.</li>
        <li>Kontaktinformasjon lagres separat fra svarene.</li>
        <li>Kontaktinformasjon brukes kun til å sende resultatene.</li>
        <li>Ingen individuelle svar publiseres.</li>
        <li>Resultater presenteres aggregert.</li>
      </ul>
      <p className="mt-3">
        Les mer i vår <Link to="/personvern" className="underline">personvernerklæring</Link>.
      </p>
    </div>
  );
}
