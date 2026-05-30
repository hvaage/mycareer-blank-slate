// @ts-nocheck
import { useEffect, useState } from "react";
import { Apple, Smartphone, Monitor, Share, Plus, MoreVertical, Download } from "lucide-react";

type Platform = "ios" | "android" | "desktop" | "ipad";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  if (isIPad) return "ipad";
  if (/iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function InstallGuide({ defaultPlatform }: { defaultPlatform?: Platform }) {
  const [tab, setTab] = useState<Platform>(defaultPlatform ?? "desktop");

  useEffect(() => {
    if (!defaultPlatform) setTab(detectPlatform());
  }, [defaultPlatform]);

  const tabs: { id: Platform; label: string; icon: any }[] = [
    { id: "ios", label: "iPhone", icon: Smartphone },
    { id: "ipad", label: "iPad", icon: Apple },
    { id: "android", label: "Android", icon: Smartphone },
    { id: "desktop", label: "Desktop", icon: Monitor },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-border hover:bg-accent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm text-card-foreground">
        {(tab === "ios" || tab === "ipad") && (
          <ol className="space-y-3 list-decimal list-inside">
            <li>Åpne <strong>karrierenmin.no</strong> i <strong>Safari</strong> (fungerer ikke i Chrome på iOS).</li>
            <li>
              Trykk på <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Del</strong>-knappen
              {tab === "ipad" ? " øverst i Safari." : " nederst i Safari."}
            </li>
            <li>
              Bla ned og velg <Plus className="inline h-4 w-4 align-text-bottom" /> <strong>Legg til på Hjem-skjerm</strong>.
            </li>
            <li>Trykk <strong>Legg til</strong> øverst til høyre.</li>
            <li>Du finner nå Karrierenmin-ikonet på {tab === "ipad" ? "iPad-en" : "iPhone-en"} din.</li>
          </ol>
        )}

        {tab === "android" && (
          <ol className="space-y-3 list-decimal list-inside">
            <li>Åpne <strong>karrierenmin.no</strong> i <strong>Chrome</strong>.</li>
            <li>
              Trykk på <MoreVertical className="inline h-4 w-4 align-text-bottom" /> <strong>menyen</strong> øverst til høyre.
            </li>
            <li>Velg <strong>Installer app</strong> eller <strong>Legg til på startskjerm</strong>.</li>
            <li>Bekreft med <strong>Installer</strong>.</li>
            <li>karrierenmin.no åpnes nå som en egen app fra startskjermen.</li>
          </ol>
        )}

        {tab === "desktop" && (
          <ol className="space-y-3 list-decimal list-inside">
            <li>Åpne <strong>karrierenmin.no</strong> i <strong>Chrome</strong>, <strong>Edge</strong> eller <strong>Brave</strong>.</li>
            <li>
              Se etter <Download className="inline h-4 w-4 align-text-bottom" /> <strong>installasjonsikonet</strong> til høyre i adressefeltet.
            </li>
            <li>Trykk på ikonet og velg <strong>Installer</strong>.</li>
            <li>
              Alternativt: åpne menyen (⋮) → <strong>Installer karrierenmin.no</strong> / <strong>Apps → Installer dette nettstedet</strong>.
            </li>
            <li>karrierenmin.no åpnes nå i eget vindu og finnes i applikasjonsmappen din.</li>
          </ol>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Tips: Når en ny versjon av karrierenmin.no er klar, får du beskjed nederst i appen med en
        <strong> «Oppdater»</strong>-knapp. Trykk på den for å laste inn siste versjon.
      </p>
    </div>
  );
}
