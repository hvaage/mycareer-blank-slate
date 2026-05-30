// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import { applicationsListQuery } from "@/lib/queries";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { DOCUMENT_TYPE_LABELS } from "@/lib/constants";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const search = z.object({ application_id: z.string().optional() });

export const Route = createFileRoute("/_authenticated/documents/new")({
  validateSearch: (s) => search.parse(s),
  component: NewDocument,
});

function NewDocument() {
  const { application_id } = Route.useSearch();
  const { user } = useAuth();
  const navigate = useNavigate();
  const appsQ = useQuery(applicationsListQuery());
  const [title, setTitle] = useState("");
  const [type, setType] = useState("cv");
  const [isBase, setIsBase] = useState(false);
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [appId, setAppId] = useState<string>(application_id ?? "none");
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      let file_path: string | null = null;
      let file_name: string | null = null;
      let file_size_bytes: number | null = null;
      let mime_type: string | null = null;

      if (file) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("job-documents")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) throw upErr;
        file_path = path;
        file_name = file.name;
        file_size_bytes = file.size;
        mime_type = file.type || null;
      }

      const linkedAppId = appId !== "none" ? appId : null;
      const linkedApp = appsQ.data?.find((a: any) => a.id === linkedAppId);
      const finalCompany =
        companyName.trim() || (linkedApp?.company_name ?? null);

      const { data, error } = await supabase
        .from("documents")
        .insert({
          user_id: user.id,
          title: title || file?.name || "Uten tittel",
          document_type: type as any,
          is_base_version: isBase,
          content_text: content || null,
          application_id: linkedAppId,
          company_name: finalCompany,
          file_path,
          file_name,
          file_size_bytes,
          mime_type,
        } as any)
        .select()
        .single();
      if (error) throw error;
      navigate({ to: "/documents/$id", params: { id: data.id } });
    } catch (err: any) {
      toast.error(err.message ?? "Kunne ikke opprette dokument");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-2xl mx-auto space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/documents"><ArrowLeft className="h-4 w-4 mr-2" /> Tilbake</Link>
      </Button>
      <Card>
        <CardHeader><CardTitle>Nytt dokument</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Tittel</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="f.eks. CV – mai 2026" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Knytt til søknad (valgfritt)</Label>
              <Select value={appId} onValueChange={setAppId}>
                <SelectTrigger><SelectValue placeholder="Ingen" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen</SelectItem>
                  {(appsQ.data ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.company_name}{a.role_title ? ` – ${a.role_title}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Selskap (for arkivering)</Label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Hentes fra søknad hvis tom"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isBase} onCheckedChange={(v) => setIsBase(!!v)} /> Base-versjon
            </label>
            <div>
              <Label>Last opp fil (PDF, Word, m.m.)</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.txt,.rtf,.odt,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {file && <p className="text-xs text-muted-foreground mt-1">{file.name} ({Math.round(file.size / 1024)} KB)</p>}
            </div>
            <div>
              <Label>Tekstinnhold (valgfritt – brukes for sammenligning)</Label>
              <Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={loading}>{loading ? "Lagrer…" : "Opprett"}</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
