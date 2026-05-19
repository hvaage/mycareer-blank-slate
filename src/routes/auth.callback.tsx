import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/lib/supabase";

interface DebugInfo {
  step: string;
  message?: string;
  href?: string;
  path?: string;
  hasCode?: boolean;
  hasAccessTokenHash?: boolean;
  hash?: string;
  errorMessage?: string;
  errorName?: string;
  exchangeData?: unknown;
  sessionData?: unknown;
  sessionError?: unknown;
}

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();
  const [debug, setDebug] = useState<DebugInfo>({ step: "initializing" });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");

      console.log("AUTH CALLBACK URL", window.location.href);
      console.log("HAS CODE", !!code);
      console.log("HASH PRESENT", !!window.location.hash);

      setDebug({
        step: "initial_check",
        href: window.location.href,
        path: window.location.pathname,
        hasCode: !!code,
        hasAccessTokenHash: window.location.hash.includes("access_token"),
        hash: window.location.hash ? "present" : "missing",
      });

      if (!code) {
        if (cancelled) return;
        setDebug({
          step: "missing_code",
          message: "No ?code= found in callback URL",
          href: window.location.href,
          path: window.location.pathname,
          hasCode: false,
          hasAccessTokenHash: window.location.hash.includes("access_token"),
          hash: window.location.hash ? "present" : "missing",
        });
        return;
      }

      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      console.log("EXCHANGE DATA", data);
      console.error("EXCHANGE ERROR", error);

      if (cancelled) return;

      if (error) {
        setDebug({
          step: "exchange_failed",
          href: window.location.href,
          path: window.location.pathname,
          hasCode: true,
          hasAccessTokenHash: window.location.hash.includes("access_token"),
          hash: window.location.hash ? "present" : "missing",
          errorMessage: error.message,
          errorName: error.name,
          exchangeData: data,
        });
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

      console.log("SESSION AFTER EXCHANGE", sessionData.session);
      console.error("SESSION ERROR", sessionError);

      if (cancelled) return;

      if (!sessionData.session) {
        setDebug({
          step: "session_missing_after_exchange",
          message: "Exchange succeeded but getSession returned null",
          href: window.location.href,
          path: window.location.pathname,
          hasCode: true,
          hasAccessTokenHash: window.location.hash.includes("access_token"),
          hash: window.location.hash ? "present" : "missing",
          exchangeData: data,
          sessionError,
        });
        return;
      }

      setDebug({
        step: "session_found",
        href: window.location.href,
        path: window.location.pathname,
        hasCode: true,
        hasAccessTokenHash: window.location.hash.includes("access_token"),
        hash: window.location.hash ? "present" : "missing",
        exchangeData: data,
        sessionData: sessionData.session,
        sessionError,
      });

      navigate({ to: "/onboarding", replace: true });
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Auth callback debug</p>
          <h1 className="mt-2 text-3xl">OAuth callback</h1>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 text-sm shadow-sm">
          <dl className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">Step</dt>
            <dd>{debug.step}</dd>

            <dt className="text-muted-foreground">Path</dt>
            <dd className="break-all">{debug.path ?? window.location.pathname}</dd>

            <dt className="text-muted-foreground">Has ?code=</dt>
            <dd>{String(debug.hasCode ?? new URL(window.location.href).searchParams.has("code"))}</dd>

            <dt className="text-muted-foreground">Has #access_token=</dt>
            <dd>{String(debug.hasAccessTokenHash ?? window.location.hash.includes("access_token"))}</dd>

            <dt className="text-muted-foreground">Hash</dt>
            <dd>{debug.hash ?? (window.location.hash ? "present" : "missing")}</dd>

            {debug.message && (
              <>
                <dt className="text-muted-foreground">Message</dt>
                <dd>{debug.message}</dd>
              </>
            )}

            {debug.errorMessage && (
              <>
                <dt className="text-muted-foreground">Supabase error</dt>
                <dd>{debug.errorMessage}</dd>
              </>
            )}

            {debug.errorName && (
              <>
                <dt className="text-muted-foreground">Error name</dt>
                <dd>{debug.errorName}</dd>
              </>
            )}
          </dl>
        </div>

        <div className="space-y-4">
          <DebugBlock title="Current URL" value={debug.href ?? window.location.href} />
          <DebugBlock title="exchangeCodeForSession result" value={debug.exchangeData ?? null} />
          <DebugBlock title="getSession after exchange" value={debug.sessionData ?? null} />
          <DebugBlock title="getSession error" value={debug.sessionError ?? null} />
        </div>
      </div>
    </main>
  );
}

function DebugBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-lg border border-border bg-card p-6 shadow-sm">
      <h2 className="text-sm text-muted-foreground">{title}</h2>
      <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
