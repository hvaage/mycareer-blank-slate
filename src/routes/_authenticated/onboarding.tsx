import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { markOnboarded } from "@/lib/onboarding";

export const Route = createFileRoute("/_authenticated/onboarding")({
  component: Onboarding,
});

function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [importing, setImporting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const importLinkedIn = async () => {
    setImporting(true);
    await new Promise((r) => setTimeout(r, 900));
    const data = {
      profile_image_url: `https://i.pravatar.cc/120?u=${user?.id ?? "guest"}`,
      headline: "Senior Rådgiver",
    };
    localStorage.setItem("km_linkedin", JSON.stringify(data));
    setImporting(false);
    setStep(3);
  };

  const finish = async () => {
    if (!user) return;
    setFinishing(true);
    await markOnboarded(user.id);
    navigate({ to: "/app" });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-xl">
        <p className="text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Steg {step} av 3
        </p>
        <div className="mt-6 rounded-lg border border-border bg-card p-10 shadow-sm">
          {step === 1 && (
            <>
              <h1 className="font-serif text-3xl text-foreground">
                Velkommen – la oss sette opp grunnlaget
              </h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Vi bruker noen minutter på å sette opp profilen din. Du kan endre alt senere.
              </p>
              <Button className="mt-8" size="lg" onClick={() => setStep(2)}>
                Fortsett
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-serif text-3xl text-foreground">Koble til LinkedIn</h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Hent inn tittel og profilbilde for å komme raskere i gang. Dette er kun for å fylle
                ut profilen din – det er ikke innlogging.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" onClick={importLinkedIn} disabled={importing}>
                  {importing ? "Importerer…" : "Importer fra LinkedIn"}
                </Button>
                <Button size="lg" variant="outline" onClick={() => setStep(3)} disabled={importing}>
                  Hopp over
                </Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-serif text-3xl text-foreground">Du er klar</h1>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Grunnlaget er på plass. Du kan nå gå inn i karriereplattformen.
              </p>
              <Button className="mt-8" size="lg" onClick={finish} disabled={finishing}>
                {finishing ? "Fullfører…" : "Gå til plattformen"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
