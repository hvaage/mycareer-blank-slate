// @ts-nocheck
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Linkedin, Mail, Briefcase, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { startLinkedInOAuth } from "@/lib/linkedin-oauth";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/integrations")({
  component: IntegrationsPage,
});

function IntegrationsPage() {
  const { user } = useAuth();

  const { data: profile } = useQuery({
    queryKey: ["profile-linkedin", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("linkedin_connected_at, linkedin_picture_url, full_name")
        .eq("id", user!.id)
        .maybeSingle();
      return data;
    },
  });

  const linkedInConnected = !!profile?.linkedin_connected_at;

  const handleConnectLinkedIn = () => {
    try {
      startLinkedInOAuth();
    } catch (e: any) {
      toast.error(e?.message ?? "Kunne ikke åpne LinkedIn");
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrasjoner</h1>
        <p className="text-sm text-muted-foreground">
          Koble til tjenester for å hente data automatisk.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Linkedin className="h-5 w-5" /> LinkedIn
          </CardTitle>
          <CardDescription>
            Hent navn, headline og profilbilde fra LinkedIn-profilen din.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <Badge variant={linkedInConnected ? "default" : "secondary"}>
            {linkedInConnected ? "Tilkoblet" : "Ikke tilkoblet"}
          </Badge>
          {!linkedInConnected && (
            <Button size="sm" onClick={handleConnectLinkedIn}>
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> Koble til
            </Button>
          )}
        </CardContent>
      </Card>

      <ComingSoonCard
        icon={<Mail className="h-5 w-5" />}
        title="Gmail"
        description="Hent svar fra arbeidsgivere automatisk inn i søknader."
      />
      <ComingSoonCard
        icon={<Briefcase className="h-5 w-5" />}
        title="Finn.no"
        description="Synk stillingsannonser direkte til jobb-leads."
      />
      <ComingSoonCard
        icon={<Briefcase className="h-5 w-5" />}
        title="DN Jobb"
        description="Synk stillingsannonser direkte til jobb-leads."
      />
    </div>
  );
}

function ComingSoonCard({
  icon, title, description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Card className="opacity-80">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge variant="secondary">Kommer snart</Badge>
      </CardContent>
    </Card>
  );
}
