// @ts-nocheck
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export function AccountSection({ email, userId }: { email: string; userId: string }) {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const changeEmail = async () => {
    if (!newEmail || !newEmail.includes("@")) {
      toast.error("Skriv inn en gyldig e-post");
      return;
    }
    setSavingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) throw error;
      toast.success("Bekreftelses-e-post sendt til " + newEmail);
      setNewEmail("");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke endre e-post");
    } finally {
      setSavingEmail(false);
    }
  };

  const changePassword = async () => {
    if (pwd.length < 8) {
      toast.error("Passordet må være minst 8 tegn");
      return;
    }
    if (pwd !== pwd2) {
      toast.error("Passordene er ikke like");
      return;
    }
    setSavingPwd(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwd });
      if (error) throw error;
      toast.success("Passord oppdatert");
      setPwd("");
      setPwd2("");
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke oppdatere passord");
    } finally {
      setSavingPwd(false);
    }
  };

  const deleteMyData = async ({ confirmFirst = true }: { confirmFirst?: boolean } = {}) => {
    if (
      confirmFirst &&
      !confirm(
        "Slette ALT innholdet ditt (søknader, dokumenter, leads, kontakter, karriereoversikt og nettverksdata)? Kontoen beholdes. Dette kan ikke angres.",
      )
    )
      return false;
    try {
      const { error } = await supabase.rpc("delete_all_my_data");
      if (error) throw error;

      // Best-effort: rydd opp opplastede CV-filer fra storage (cv-uploads/<userId>/...)
      try {
        const { data: files } = await supabase.storage
          .from("cv-uploads")
          .list(userId, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${userId}/${f.name}`);
          await supabase.storage.from("cv-uploads").remove(paths);
        }
      } catch {
        // ignorer storage-feil
      }

      if (confirmFirst) toast.success("All data slettet");
      return true;
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke slette all data");
      return false;
    }
  };

  const deleteAccount = async () => {
    if (!confirm("Slette kontoen din permanent? All data slettes også. Dette kan ikke angres.")) return;
    setDeleting(true);
    try {
      await deleteMyData({ confirmFirst: false });
      const { error } = await supabase.functions.invoke("delete-account");
      if (error) throw error;
      await signOut();
      toast.success("Konto slettet");
      navigate({ to: "/login" });
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke slette konto. Logg ut og kontakt support.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Konto</CardTitle>
        <CardDescription>
          Innlogget som <strong>{email}</strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Mail className="h-4 w-4" /> Bytt e-post
          </h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              type="email"
              placeholder="ny@epost.no"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Button size="sm" onClick={changeEmail} disabled={savingEmail}>
              {savingEmail ? "Sender…" : "Endre e-post"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Du må bekrefte den nye e-posten via en lenke som sendes til adressen.
          </p>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Bytt passord</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Nytt passord</Label>
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Bekreft passord</Label>
              <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} />
            </div>
          </div>
          <Button size="sm" className="mt-3" onClick={changePassword} disabled={savingPwd}>
            {savingPwd ? "Lagrer…" : "Oppdater passord"}
          </Button>
        </div>

        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-2">Logg ut</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await signOut();
              navigate({ to: "/login" });
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Logg ut
          </Button>
        </div>

        <div className="border-t pt-4 space-y-3">
          <h3 className="text-sm font-semibold text-destructive">Faresone</h3>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={deleteMyData}>
              <Trash2 className="h-4 w-4 mr-2" /> Slett all min data
            </Button>
            <Button variant="destructive" size="sm" onClick={deleteAccount} disabled={deleting}>
              <Trash2 className="h-4 w-4 mr-2" /> {deleting ? "Sletter…" : "Slett konto permanent"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            «Slett all min data» fjerner søknader, dokumenter, leads og kontakter, men beholder kontoen.
            «Slett konto» fjerner alt og logger deg ut.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
