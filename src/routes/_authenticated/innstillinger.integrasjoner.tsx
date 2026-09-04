// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";

export const Route = createFileRoute("/_authenticated/innstillinger/integrasjoner")({
  validateSearch: (search: Record<string, unknown>): { intent?: string } => ({
    intent: typeof search.intent === "string" ? search.intent : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Integrasjoner — Innstillinger | Karrierenmin" },
      {
        name: "description",
        content:
          "Koble til e-post, LinkedIn og jobbportaler slik at karrieredataene dine oppdateres automatisk.",
      },
      { property: "og:title", content: "Integrasjoner — Innstillinger | Karrierenmin" },
      {
        property: "og:description",
        content: "Koble til e-post, LinkedIn og jobbportaler i Karrierenmin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsIntegrationsPage,
});

function SettingsIntegrationsPage() {
  const { user } = useAuth();
  const { intent } = Route.useSearch();
  if (!user) return null;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrasjoner</h1>
        <p className="text-sm text-muted-foreground">
          Koble til tjenester for å hente data automatisk.
        </p>
      </div>
      <IntegrationsPanel userId={user.id} autoEnsureGrok={intent === "grok"} />
    </div>
  );
}
