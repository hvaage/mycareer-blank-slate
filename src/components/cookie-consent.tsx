// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "sokr.cookie-consent.v1";

type Consent = "all" | "necessary";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);

  const accept = (choice: Consent) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ choice, ts: Date.now() }));
    } catch {
      // ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Samtykke til informasjonskapsler"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6"
    >
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card/95 p-5 shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">
            <p className="text-foreground font-medium">Vi bruker informasjonskapsler</p>
            <p className="mt-1">
              Vi bruker nødvendige cookies for at tjenesten skal fungere, og valgfrie cookies for å forbedre opplevelsen. Les mer i vår{" "}
              <Link to="/privacy" className="underline">personvernerklæring</Link>
              {" "}og <Link to="/eula" className="underline">brukervilkår</Link>.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => accept("necessary")}>
              Kun nødvendige
            </Button>
            <Button size="sm" onClick={() => accept("all")}>
              Godta alle
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
