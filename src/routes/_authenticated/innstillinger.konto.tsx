// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { AccountSection } from "@/components/settings/account-section";

export const Route = createFileRoute("/_authenticated/innstillinger/konto")({
  head: () => ({
    meta: [
      { title: "Konto — Innstillinger | Karrierenmin" },
      {
        name: "description",
        content: "Endre e-post og passord, logg ut, eller slett data og konto i Karrierenmin.",
      },
      { property: "og:title", content: "Konto — Innstillinger | Karrierenmin" },
      {
        property: "og:description",
        content: "Endre e-post og passord, eller slett data og konto i Karrierenmin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SettingsAccountPage,
});

function SettingsAccountPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Konto</h1>
        <p className="text-sm text-muted-foreground">
          Innlogging, passord og sletting av data.
        </p>
      </div>
      <AccountSection email={user.email ?? ""} userId={user.id} />
    </div>
  );
}
