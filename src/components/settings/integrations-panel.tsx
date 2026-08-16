// @ts-nocheck
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Linkedin, Globe2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { EmailConnections } from "@/components/email-connections";
import { startLinkedInOAuth } from "@/lib/linkedin-oauth";

export function IntegrationsPanel({ userId }: { userId: string }) {
  const { data: profile } = useQuery({
    queryKey: ["profile-integrations", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select(
          "linkedin_connected_at, linkedin_picture_url, linkedin_headline, linkedin_vanity_url",
        )
        .eq("id", userId)
        .maybeSingle();
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <EmailConnections />
      <LinkedInConnection profile={profile} />
      <JobBoardIntegrations />
    </div>
  );
}

function LinkedInConnection({ profile }: { profile: any }) {
  const connected = !!profile?.linkedin_connected_at;

  const handleConnect = () => {
    try {
      startLinkedInOAuth();
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke åpne LinkedIn");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Linkedin className="h-5 w-5" /> LinkedIn
        </CardTitle>
        <CardDescription>
          Koble til LinkedIn for å hente profildata (navn, headline, profilbilde).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected ? (
          <div className="flex items-start gap-3">
            {profile.linkedin_picture_url && (
              <img
                src={profile.linkedin_picture_url}
                alt=""
                className="h-14 w-14 rounded-full object-cover ring-2 ring-border shrink-0"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide bg-primary/10 text-primary px-2 py-0.5 rounded">
                  Tilkoblet
                </span>
                <span className="text-muted-foreground">
                  {new Date(profile.linkedin_connected_at).toLocaleDateString("nb-NO")}
                </span>
              </div>
              {profile.linkedin_headline && (
                <p className="text-sm text-foreground">{profile.linkedin_headline}</p>
              )}
              {profile.linkedin_vanity_url && (
                <a
                  href={profile.linkedin_vanity_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-primary hover:underline break-all"
                >
                  {profile.linkedin_vanity_url}
                </a>
              )}
              <Button variant="outline" size="sm" onClick={handleConnect}>
                Oppdater tilkobling
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={handleConnect}>
            <Linkedin className="h-4 w-4 mr-2" /> Koble til LinkedIn
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function JobBoardIntegrations() {
  const boards = [
    { key: "finn", name: "Finn.no", desc: "Hent stillingsannonser fra Finn.no" },
    { key: "dn", name: "DN Jobb", desc: "Stillinger fra Dagens Næringsliv" },
    { key: "fn", name: "FN-jobb", desc: "FN og internasjonale organisasjoner" },
    { key: "nav", name: "NAV / arbeidsplassen", desc: "Offentlig stillingsdatabase" },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jobbportaler</CardTitle>
        <CardDescription>
          Koble til stillingsportaler for automatisk synk av leads og annonser. Kommer snart.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid sm:grid-cols-2 gap-3">
          {boards.map((b) => (
            <div key={b.key} className="flex items-start gap-3 p-3 border rounded-lg bg-muted/20">
              <Globe2 className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">{b.name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    Kommer
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{b.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
