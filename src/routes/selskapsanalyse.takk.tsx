import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { trackLeadEvent } from "@/lib/leads.functions";
import { SELSKAPSANALYSE, TEST_MODE_KEY } from "@/lib/selskapsanalyse-site";

const HENRIK_LINKEDIN = "https://www.linkedin.com/in/henrikvaage";
const DOWNLOAD_PATH = "/api/public/selskapsanalyse/download";
const PREVIEW_EMAIL_PATH = "/api/public/selskapsanalyse/preview-email";

const search = z.object({
  token: z.string().optional().default(""),
  test: z.string().optional().default(""),
});

export const Route = createFileRoute("/selskapsanalyse/takk")({
  validateSearch: (s) => search.parse(s),
  head: () => ({
    meta: [
      { title: "Takk! Én siste ting — Karrierenmin" },
      {
        name: "description",
        content:
          "Koble til Henrik Vaage eller følg Karrierenmin.no på LinkedIn for å låse opp nedlasting av Claude-skillen.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: TakkPage,
});

function withUtm(url: string, params: Record<string, string>) {
  try {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function TakkPage() {
  const { token, test } = Route.useSearch();
  const track = useServerFn(trackLeadEvent);
  const testMode = test === TEST_MODE_KEY;

  const [unlockedBy, setUnlockedBy] = useState<{ connect: boolean; follow: boolean }>(
    { connect: testMode, follow: testMode }
  );

  useEffect(() => {
    if (testMode) setUnlockedBy({ connect: true, follow: true });
  }, [testMode]);

  function persistUnlock(next: { connect: boolean; follow: boolean }) {
    setUnlockedBy(next);
  }


  const isUnlocked = unlockedBy.connect || unlockedBy.follow;

  const connectHref = withUtm(HENRIK_LINKEDIN, {
    utm_source: "karrierenmin",
    utm_medium: "takk",
    utm_campaign: "linkedin_connect",
  });
  const followHref = withUtm(SELSKAPSANALYSE.companyLinkedinFollowUrl, {
    utm_source: "karrierenmin",
    utm_medium: "takk",
    utm_campaign: "linkedin_follow",
  });

  function handleConnect() {
    if (token) {
      track({ data: { accessToken: token, type: "connect_click" } }).catch(() => {});
    }
    persistUnlock({ ...unlockedBy, connect: true });
  }

  function handleFollow() {
    if (token) {
      track({ data: { accessToken: token, type: "follow_click" } }).catch(() => {});
    }
    persistUnlock({ ...unlockedBy, follow: true });
  }

  function handleDownload() {
    if (token) {
      track({ data: { accessToken: token, type: "download" } }).catch(() => {});
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-2xl w-full px-4 sm:px-6 py-16 sm:py-24">
        {testMode && (
          <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
            <strong>Testmodus aktiv.</strong> LinkedIn-gate-en er automatisk
            låst opp, og du kan se den ferdig-rendrede bekreftelses-e-posten
            uten å vente på kø.
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <a
                href={`${PREVIEW_EMAIL_PATH}?key=${encodeURIComponent(
                  TEST_MODE_KEY
                )}${token ? `&token=${encodeURIComponent(token)}` : ""}`}
                target="_blank"
                rel="noreferrer"
                className="underline font-medium"
              >
                Forhåndsvis bekreftelses-e-post →
              </a>
              {!token && (
                <span className="text-muted-foreground">
                  (uten token: nedlasting krever ekte innsending)
                </span>
              )}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card p-8 sm:p-10">
          <div className="h-12 w-12 rounded-full bg-primary/15 text-primary grid place-items-center mb-5">
            <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path
                fillRule="evenodd"
                d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Takk! Én rask ting før du laster ned.
          </h1>
          <p className="mt-3 text-muted-foreground leading-relaxed">
            Arbeidsgiveranalysen er en gratis Claude-skill fra Karrierenmin.no. For å
            låse opp nedlastingen — koble til Henrik Vaage på LinkedIn eller
            følg Karrierenmin.no. Det er sånn vi holder prosjektet i gang og
            sender ut neste skill.
          </p>

          <div className="mt-8">
            <div className="flex items-center gap-3">
              <StepBadge active={!isUnlocked} done={isUnlocked} number={1} />
              <h2 className="text-lg font-semibold text-foreground">
                Koble til eller følg på LinkedIn
              </h2>
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3">
              <LinkedInAction
                href={connectHref}
                done={unlockedBy.connect}
                label="Koble til Henrik"
                sublabel="Henrik Vaage"
                primary
                onClick={handleConnect}
              />
              <LinkedInAction
                href={followHref}
                done={unlockedBy.follow}
                label="Følg Karrierenmin.no"
                sublabel="Bedriftsside"
                onClick={handleFollow}
              />
            </div>

            {!isUnlocked && (
              <p className="mt-3 text-xs text-muted-foreground">
                Klikk én (eller begge) — nedlastingen låses opp umiddelbart.
              </p>
            )}
          </div>

          <div className="mt-10 border-t border-border pt-8">
            <div className="flex items-center gap-3">
              <StepBadge active={isUnlocked} done={false} number={2} />
              <h2 className="text-lg font-semibold text-foreground">
                Last ned skillen
              </h2>
            </div>

            {isUnlocked && token ? (
              <div className="mt-4 space-y-5">
                <a
                  href={`${DOWNLOAD_PATH}?token=${encodeURIComponent(token)}`}
                  onClick={handleDownload}
                  className="inline-flex h-11 items-center rounded-md bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  Last ned Claude-skillen (.skill)
                </a>

                <p className="text-xs text-muted-foreground">
                  Vi har også sendt deg en e-post med samme lenke og full
                  installasjonsveiledning.
                </p>

                <div className="rounded-lg border border-border bg-muted/30 p-5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Slik installerer du skillen i Claude
                  </h3>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Skills krever en <strong>Claude Pro-, Max-, Team- eller
                    Enterprise-konto</strong> og fungerer i Claude på web og
                    desktop (ikke i mobil-appen).
                  </p>
                  <ol className="mt-3 space-y-2 text-sm text-foreground/90 list-decimal list-inside">
                    <li>
                      Logg inn på{" "}
                      <a
                        href="https://claude.ai"
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        claude.ai
                      </a>
                      .
                    </li>
                    <li>
                      Klikk profilen din nede til venstre →{" "}
                      <strong>Customize</strong> →{" "}
                      <strong>Skills</strong>.
                    </li>
                    <li>
                      Trykk <strong>Upload skill</strong> og velg{" "}
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        employer-analysis.skill
                      </code>
                      . Slå på bryteren slik at skillen er aktiv.
                    </li>
                    <li>
                      Start en ny samtale og skriv f.eks.:{" "}
                      <em>
                        «Bruk Arbeidsgiveranalysen-skillen og lag en rapport om
                        equinor.com i Norge.»
                      </em>
                    </li>
                    <li>
                      Claude spør om domene, land og om du vil ha standard
                      (8–10 sider) eller utvidet rapport (opp mot 25 sider),
                      og leverer en PDF når den er klar.
                    </li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 p-5">
                <p className="text-sm text-muted-foreground">
                  🔒 Nedlastingsknappen dukker opp her så snart du har koblet
                  til eller fulgt over.
                </p>
              </div>
            )}

          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function StepBadge({
  number,
  active,
  done,
}: {
  number: number;
  active: boolean;
  done: boolean;
}) {
  if (done) {
    return (
      <div className="h-7 w-7 shrink-0 rounded-full bg-primary/15 text-primary grid place-items-center">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path
            fillRule="evenodd"
            d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4L8.5 12l6.8-6.7a1 1 0 0 1 1.4 0Z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    );
  }
  return (
    <div
      className={
        "h-7 w-7 shrink-0 rounded-full grid place-items-center text-xs font-semibold " +
        (active
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground")
      }
    >
      {number}
    </div>
  );
}

function LinkedInAction({
  href,
  label,
  sublabel,
  done,
  primary,
  onClick,
}: {
  href: string;
  label: string;
  sublabel: string;
  done: boolean;
  primary?: boolean;
  onClick: () => void;
}) {
  const base =
    "flex items-center justify-between gap-3 rounded-lg px-4 py-3 transition-colors";
  const style = primary
    ? "bg-[#0A66C2] text-white hover:opacity-90"
    : "border border-border bg-card text-foreground hover:bg-accent";
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onClick}
      className={`${base} ${style}`}
    >
      <span className="flex flex-col text-left">
        <span className="text-sm font-semibold">{label}</span>
        <span
          className={
            "text-xs " + (primary ? "text-white/80" : "text-muted-foreground")
          }
        >
          {sublabel}
        </span>
      </span>
      {done ? (
        <span
          className={
            "text-xs font-medium " + (primary ? "text-white" : "text-primary")
          }
          aria-label="Ferdig"
        >
          ✓ Ferdig
        </span>
      ) : (
        <span
          aria-hidden
          className={primary ? "text-white" : "text-muted-foreground"}
        >
          ↗
        </span>
      )}
    </a>
  );
}
