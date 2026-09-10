// ============================================================
// Oppsett av AI-assistent, e-post og LinkedIn-import.
//
// Brukes både i onboarding og i Innstillinger > Integrasjoner.
// De fire assistentene er likestilte: ingen er forhåndsvalgt og
// ingen er merket som anbefalt. Brukeren velger aldri driftsform —
// den utledes av bekreftede egenskaper og forklares i klartekst.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Info, Loader2, Mail, Linkedin, Unplug } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { LinkedInImportCard } from "@/components/linkedin/linkedin-import-card";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  AI_PLAN_LABELS,
  AI_PLAN_TIERS,
  AI_PROVIDER_LABELS,
  AI_PROVIDER_ORDER,
  DEFAULT_AUTOMATION_CHOICES,
  EFFECTIVE_MODE_TEXT,
  EMAIL_PROVIDER_OPTIONS,
  deriveEffectiveMode,
  type AiCapabilities,
  type AiEffectiveMode,
  type AiPlanTier,
  type AiProvider,
  type AutomationChoices,
  type EmailProviderChoice,
} from "@/lib/ai-integrations/contract";

type IntegrationRow = {
  id: string;
  provider: AiProvider;
  declared_plan_tier: AiPlanTier;
  effective_mode: AiEffectiveMode;
  status: string;
  capabilities: AiCapabilities | null;
  last_verified_at: string | null;
};

type SetupData = {
  integrations: IntegrationRow[];
  automation: AutomationChoices;
  forwarding_address: string | null;
};

const STATUS_TEXT: Record<string, string> = {
  draft: "Ikke fullført",
  connecting: "Venter på at du fullfører i assistenten",
  active: "Aktiv",
  degraded: "Virker delvis",
  disconnected: "Frakoblet",
};

const CAPABILITY_TEXT: Array<{ key: keyof AiCapabilities; label: string }> = [
  { key: "background_execution", label: "Kan jobbe i bakgrunnen" },
  { key: "scheduled_runs", label: "Kan kjøre på faste tidspunkter" },
  { key: "email_forward_or_send", label: "Kan sende og videresende e-post" },
];

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Du må være pålogget.");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function authedJson(path: string, init?: RequestInit) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Du må være pålogget.");
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.ok)
    throw new Error(json?.error?.message ?? "Handlingen kunne ikke utføres.");
  return json;
}

export function AiIntegrationSetup({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();

  const [provider, setProvider] = useState<AiProvider | null>(null);
  const [decideLater, setDecideLater] = useState(false);
  const [planTier, setPlanTier] = useState<AiPlanTier>("unknown");
  const [emailProvider, setEmailProvider] = useState<EmailProviderChoice>("gmail");
  const [automation, setAutomation] = useState<AutomationChoices>(DEFAULT_AUTOMATION_CHOICES);

  const setup = useQuery({
    queryKey: ["ai-integration-setup"],
    queryFn: async () => (await authedJson("/api/ai-integrations")) as SetupData & { ok: true },
  });

  // Fyll skjemaet fra lagrede valg første gang de kommer inn.
  useEffect(() => {
    if (!setup.data) return;
    const active = setup.data.integrations.find((i) => i.status !== "disconnected");
    if (active) {
      setProvider((prev) => prev ?? active.provider);
      setPlanTier(active.declared_plan_tier);
    }
    setAutomation({ ...DEFAULT_AUTOMATION_CHOICES, ...(setup.data.automation ?? {}) });
  }, [setup.data]);

  const current = useMemo(
    () => setup.data?.integrations.find((i) => i.provider === provider) ?? null,
    [setup.data, provider],
  );

  const capabilities = (current?.capabilities ?? {}) as AiCapabilities;
  const mode = deriveEffectiveMode(capabilities);
  const hasConfirmedCapabilities = CAPABILITY_TEXT.some((c) => capabilities[c.key] === true);

  const save = useMutation({
    mutationFn: async () => {
      // provider = null er gyldig: da lagres bare e-post- og LinkedIn-valgene.
      // E-postleverandørvalget sendes bevisst ikke — det lagres ikke i fase 1.
      const res = await fetch("/api/ai-integrations", {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ provider, plan_tier: planTier, automation }),
      });
      const json = await res.json().catch(() => null);
      if (json?.error?.code === "partial_failure") {
        return { partial: true, message: json.error.message as string };
      }
      if (!res.ok || !json?.ok)
        throw new Error(json?.error?.message ?? "Handlingen kunne ikke utføres.");
      return { partial: false, message: "" };
    },
    onSuccess: (result) => {
      // Ved delvis lagring hentes fersk tilstand, slik at UI aldri viser mer enn det som faktisk ble lagret.
      queryClient.invalidateQueries({ queryKey: ["ai-integration-setup"] });
      if (result.partial) toast.warning(result.message);
      else if (provider) toast.success("Oppsettet er lagret");
      else toast.success("E-post- og LinkedIn-valgene dine er lagret");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("Ingen assistent å koble fra.");
      return await authedJson("/api/ai-integrations", {
        method: "DELETE",
        body: JSON.stringify({ provider }),
      });
    },
    onSuccess: () => {
      setSetupCode(null);
      queryClient.invalidateQueries({ queryKey: ["ai-integration-setup"] });
      toast.success("Assistenten er koblet fra. Karrieredataene dine er urørt.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const chooseLater = () => {
    // Ingen databasekall: valget er bevisst lokalt og skal aldri blokkere.
    setProvider(null);
    setSetupCode(null);
    setDecideLater(true);
  };

  const setAuto = (patch: Partial<AutomationChoices>) =>
    setAutomation((prev) => {
      const next = { ...prev, ...patch };
      if (!next.linkedin_export_import_enabled) next.linkedin_ready_detection_enabled = false;
      return next;
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assistent, e-post og LinkedIn</CardTitle>
        <CardDescription>
          Koble Karrierenmin til AI-assistenten du allerede bruker. Karrierenmin håndterer mottak,
          analyse, lagring, deduplisering og varsler uansett hvilken du velger. Alle forslag til
          karriereloggen må godkjennes av deg.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* 1. Assistent */}
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Hvilken assistent vil du bruke?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {AI_PROVIDER_ORDER.map((p) => {
              const selected = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setProvider(p);
                    setDecideLater(false);
                    setSetupCode(null);
                  }}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                  )}
                >
                  <span className="font-medium">{AI_PROVIDER_LABELS[p]}</span>
                </button>
              );
            })}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={chooseLater}>
            Jeg vil velge senere
          </Button>
          {decideLater ? (
            <p className="text-xs text-muted-foreground">
              Helt greit. Du kan sette opp en assistent når som helst under Innstillinger →
              Integrasjoner. E-post- og LinkedIn-valgene nedenfor virker uansett.
            </p>
          ) : null}
        </fieldset>

        {/* 2. Abonnement */}
        {provider ? (
          <>
            <Separator />
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">
                Hvilket abonnement har du hos {AI_PROVIDER_LABELS[provider]}?
              </legend>
              <RadioGroup
                value={planTier}
                onValueChange={(v) => setPlanTier(v as AiPlanTier)}
                className="grid gap-2 sm:grid-cols-3"
              >
                {AI_PLAN_TIERS.map((tier) => (
                  <div key={tier} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    <RadioGroupItem value={tier} id={`plan-${tier}`} />
                    <Label htmlFor={`plan-${tier}`} className="cursor-pointer text-sm font-normal">
                      {AI_PLAN_LABELS[tier]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
                Med gratis abonnement starter du gjerne flere oppgaver selv. Karrierenmin tar seg
                fortsatt av mottak, analyse, lagring, deduplisering og varsler. Et betalt abonnement
                kan gi mer automatikk, men bare dersom vi faktisk får bekreftet at funksjonene er
                tilgjengelige for deg.
              </p>
            </fieldset>
          </>
        ) : null}

        {/* 3. E-post */}
        <Separator />
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">E-post</h3>
          </div>
          <p className="max-w-prose text-xs leading-relaxed text-muted-foreground">
            E-post er den viktigste datakilden. Vi ber deg aldri om passordet ditt.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="email-provider" className="text-sm">
              Hvor får du jobb-e-postene dine?
            </Label>
            <select
              id="email-provider"
              value={emailProvider}
              onChange={(e) => setEmailProvider(e.target.value as EmailProviderChoice)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {EMAIL_PROVIDER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Dette svaret brukes bare til å vise deg riktig veiledning nå. Det lagres ikke.
            </p>
          </div>

          {setup.data?.forwarding_address ? (
            <Alert>
              <AlertDescription className="space-y-2 text-sm">
                <p>Videresend jobb-e-poster til din private importadresse:</p>
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all rounded bg-muted px-2 py-1 text-xs">
                    {setup.data.forwarding_address}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard
                        ?.writeText(setup.data!.forwarding_address!)
                        .then(() => toast.success("Adressen er kopiert"))
                        .catch(() => toast.error("Kunne ikke kopiere"));
                    }}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Kopier
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Info className="h-4 w-4" aria-hidden />
              <AlertDescription className="text-sm">
                Du har ingen privat importadresse ennå. Vi setter den opp for deg, og den vises her
                så snart den er klar til bruk. Du trenger ikke gjøre noe i mellomtiden.
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            <ToggleRow
              id="opt-job-import"
              label="Importer jobbvarsler"
              hint="Stillinger fra jobbvarsler kommer inn automatisk og blir vurdert mot profilen din."
              checked={automation.job_email_import_enabled}
              onChange={(v) => setAuto({ job_email_import_enabled: v })}
            />
            <ToggleRow
              id="opt-career-log"
              label="Foreslå oppføringer til karriereloggen fra e-post"
              hint="Du får forslag til gjennomgang. Ingenting lagres i karriereloggen uten at du godkjenner det."
              checked={automation.career_email_suggestions_enabled}
              onChange={(v) => setAuto({ career_email_suggestions_enabled: v })}
            />
            <ToggleRow
              id="opt-linkedin-ready"
              label="Oppdag når LinkedIn-eksporten er klar"
              hint="Vi ser etter e-posten fra LinkedIn og minner deg på å laste ned arkivet."
              checked={automation.linkedin_ready_detection_enabled}
              disabled={!automation.linkedin_export_import_enabled}
              onChange={(v) => setAuto({ linkedin_ready_detection_enabled: v })}
            />
          </div>
        </section>

        {/* 4. LinkedIn */}
        <Separator />
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Linkedin className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium">LinkedIn-eksport</h3>
          </div>
          <ToggleRow
            id="opt-linkedin-import"
            label="Bruk offisiell LinkedIn-eksport (ZIP)"
            hint="Du bestiller og laster ned arkivet selv hos LinkedIn. Vi logger aldri inn for deg og henter ingenting automatisk. Jobbsøkerpreferanser importeres ikke."
            checked={automation.linkedin_export_import_enabled}
            onChange={(v) => setAuto({ linkedin_export_import_enabled: v })}
          />
          {automation.linkedin_export_import_enabled ? (
            <div className="rounded-lg border border-border p-4">
              <LinkedInImportCard />
            </div>
          ) : null}
        </section>

        {/* 5. Lagre */}
        <Separator />
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            {provider ? "Lagre oppsettet" : "Lagre e-post- og LinkedIn-valgene"}
          </Button>
          {!provider ? (
            <span className="text-xs text-muted-foreground">
              Du trenger ingen assistent for å lagre disse valgene.
            </span>
          ) : null}
        </div>

        {/* 6. Status */}
        {current ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{AI_PROVIDER_LABELS[current.provider]}</span>
              <Badge variant="secondary">{STATUS_TEXT[current.status] ?? current.status}</Badge>
              <Badge variant="outline">
                Oppgitt abonnement: {AI_PLAN_LABELS[current.declared_plan_tier]}
              </Badge>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Bekreftede egenskaper</p>
              {hasConfirmedCapabilities ? (
                <ul className="space-y-0.5 text-sm">
                  {CAPABILITY_TEXT.filter((c) => capabilities[c.key] === true).map((c) => (
                    <li key={c.key}>{c.label}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Ingen egenskaper er bekreftet ennå. Vi lover ingen automatikk før vi har sjekket
                  hva assistenten din faktisk kan.
                </p>
              )}
            </div>

            {/* last_verified_at = sist bekreftede FORBINDELSE. Sier ingenting
                om hvilke egenskaper som er bekreftet. */}
            <p className="text-xs text-muted-foreground">
              {current.last_verified_at
                ? `Forbindelsen ble sist bekreftet ${new Date(current.last_verified_at).toLocaleDateString("nb-NO")}. Det betyr at koblingen virker — ikke at egenskapene over er sjekket.`
                : "Forbindelsen er ikke bekreftet ennå."}
            </p>

            <div className="space-y-0.5">
              <p className="text-sm font-medium">{EFFECTIVE_MODE_TEXT[mode].title}</p>
              <p className="max-w-prose text-sm text-muted-foreground">
                {EFFECTIVE_MODE_TEXT[mode].body}
              </p>
            </div>

            <p className="max-w-prose text-xs text-muted-foreground">
              Dette krever handling av deg: fullfør oppsettet inne i assistenten med engangskoden
              under, og godkjenn forslag til karriereloggen etter hvert som de kommer.
            </p>

            {setupCode ? (
              <Alert>
                <KeyRound className="h-4 w-4" aria-hidden />
                <AlertDescription className="space-y-1 text-sm">
                  <p className="font-mono break-all text-base tracking-wide">{setupCode.code}</p>
                  <p className="text-xs text-muted-foreground">
                    Vises bare denne ene gangen. Gyldig til{" "}
                    {new Date(setupCode.expiresAt).toLocaleTimeString("nb-NO", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    .
                  </p>
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => newCode.mutate()}
                disabled={newCode.isPending}
              >
                {newCode.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="mr-2 h-4 w-4" aria-hidden />
                )}
                Lag ny engangskode
              </Button>
              {current.status !== "disconnected" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  <Unplug className="mr-2 h-4 w-4" aria-hidden /> Koble fra
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {compact ? null : (
          <p className="text-xs text-muted-foreground">Kalenderen din brukes ikke som datakilde.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className={cn("text-sm", disabled && "text-muted-foreground")}>
          {label}
        </Label>
        <p className="mt-0.5 max-w-prose text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-label={label}
      />
    </div>
  );
}
