// @ts-nocheck
import { requireAdmin } from "@/lib/admin-guard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/admin/cv-test")({
  beforeLoad: () => requireAdmin(),
  component: CvTestPage,
});

type SourceFormat = "pdf" | "docx";

function CvTestPage() {
  const { user } = useAuth();
  const userId = user?.id;
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [loadingAtoms, setLoadingAtoms] = useState(false);

  const [filePath, setFilePath] = useState<string | null>(null);
  const [sourceFormat, setSourceFormat] = useState<SourceFormat | null>(null);
  const [importId, setImportId] = useState<string | null>(null);

  const [parseResp, setParseResp] = useState<unknown>(null);
  const [commitResp, setCommitResp] = useState<unknown>(null);
  const [atoms, setAtoms] = useState<any[]>([]);

  const handleUpload = async (file: File) => {
    if (!userId) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const fmt: SourceFormat | null =
        ext === "pdf" ? "pdf" : (ext === "docx" || ext === "doc") ? "docx" : null;
      if (!fmt) {
        toast.error("Bare PDF eller DOCX støttes");
        return;
      }
      const path = `${userId}/cv-test-${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from("cv-uploads")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      setFilePath(path);
      setSourceFormat(fmt);
      setImportId(null);
      setParseResp(null);
      setCommitResp(null);
      toast.success(`Lastet opp: ${path}`);
    } catch (e: any) {
      toast.error(e.message ?? "Opplasting feilet");
    } finally {
      setUploading(false);
    }
  };

  const handleParse = async () => {
    if (!filePath || !sourceFormat) return;
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-uploaded-cv", {
        body: { file_path: filePath, source_format: sourceFormat },
      });
      setParseResp(error ? { error: error.message, data } : data);
      const id = (data as any)?.import_id;
      if (id) setImportId(id);
      if (error) toast.error(error.message);
      else toast.success("Parse fullført");
    } catch (e: any) {
      setParseResp({ error: e.message });
      toast.error(e.message);
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    if (!importId) return;
    setCommitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("commit-cv-import", {
        body: { import_id: importId },
      });
      setCommitResp(error ? { error: error.message, data } : data);
      if (error) toast.error(error.message);
      else toast.success("Commit fullført");
      await loadAtoms();
    } catch (e: any) {
      setCommitResp({ error: e.message });
      toast.error(e.message);
    } finally {
      setCommitting(false);
    }
  };

  const handleDeleteAllAtoms = async () => {
    if (!userId) return;
    if (!confirm("Slette ALLE dine atoms? Dette kan ikke angres.")) return;
    try {
      const { error, count } = await (supabase as any)
        .from("cv_evidence_atoms")
        .delete({ count: "exact" })
        .eq("user_id", userId);
      if (error) throw error;
      toast.success(`Slettet ${count ?? 0} atoms`);
      await loadAtoms();
    } catch (e: any) {
      toast.error(e.message ?? "Sletting feilet");
    }
  };

  const loadAtoms = async () => {
    if (!userId) return;
    setLoadingAtoms(true);
    try {
      const { data, error } = await (supabase as any)
        .from("cv_evidence_atoms")
        .select("id, atom_type, content_no, content_en, confidence, source_type, parent_atom_id, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      setAtoms(data ?? []);
    } catch (e: any) {
      toast.error(e.message ?? "Kunne ikke hente atoms");
    } finally {
      setLoadingAtoms(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">CV-pipeline test</h1>
        <p className="text-sm text-muted-foreground">
          Midlertidig debug-side. Last opp CV → parse → commit → se atoms.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Last opp CV (PDF eller DOCX)</CardTitle>
          <CardDescription>Lastes opp til cv-uploads-bucket</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Input
            type="file"
            accept=".pdf,.docx,.doc,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          {filePath && (
            <p className="text-xs text-muted-foreground break-all">
              Path: <code>{filePath}</code> ({sourceFormat})
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Parse CV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={handleParse} disabled={!filePath || parsing}>
            {parsing ? "Parser…" : "Parse CV"}
          </Button>
          {importId && (
            <p className="text-xs text-muted-foreground">
              import_id: <code>{importId}</code>
            </p>
          )}
          {parseResp != null && (
            <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-80">
              {JSON.stringify(parseResp, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Commit CV</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Button onClick={handleCommit} disabled={!importId || committing}>
            {committing ? "Committer…" : "Commit CV"}
          </Button>
          {commitResp != null && (() => {
            const r = commitResp as any;
            const log: any[] = Array.isArray(r?.merge_log) ? r.merge_log : [];
            const skipped: any[] = Array.isArray(r?.skipped_log) ? r.skipped_log : [];
            return (
              <div className="space-y-3">
                {(r?.atoms_created != null || r?.atoms_merged != null) && (
                  <div className="text-sm flex gap-4">
                    <span>✅ Opprettet: <strong>{r.atoms_created ?? 0}</strong></span>
                    <span>🔁 Merged: <strong>{r.atoms_merged ?? 0}</strong></span>
                    <span>📊 Totalt nå: <strong>{r.atoms_total_now ?? "?"}</strong></span>
                  </div>
                )}
                {log.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Merge-detaljer ({log.length})</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Innkommende</TableHead>
                          <TableHead>Slått sammen med</TableHead>
                          <TableHead>Grunn</TableHead>
                          <TableHead>Conf.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {log.map((m, i) => {
                          const c = Number(m.confidence ?? 0);
                          const color = c >= 0.9
                            ? "bg-green-100 text-green-900"
                            : c >= 0.7
                              ? "bg-yellow-100 text-yellow-900"
                              : "bg-red-100 text-red-900";
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-xs">{m.atom_type}</TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate" title={m.incoming_summary}>
                                {m.incoming_summary}
                              </TableCell>
                              <TableCell className="text-xs max-w-[200px] truncate" title={m.existing_summary}>
                                {m.existing_summary}
                              </TableCell>
                              <TableCell className="text-xs max-w-[200px]" title={m.reason}>
                                {m.reason}
                              </TableCell>
                              <TableCell>
                                <span className={`text-xs px-2 py-0.5 rounded ${color}`}>
                                  {c.toFixed(2)}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {skipped.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Filtrert/flyttet ({skipped.length})</h4>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Grunn</TableHead>
                          <TableHead>Kontekst</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {skipped.map((s, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs max-w-[280px]" title={s.reason}>{s.reason}</TableCell>
                            <TableCell className="text-xs max-w-[400px]" title={s.context}>{s.context}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <details>
                  <summary className="text-xs text-muted-foreground cursor-pointer">Rå JSON-respons</summary>
                  <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-80 mt-2">
                    {JSON.stringify(commitResp, null, 2)}
                  </pre>
                </details>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Mine atoms</CardTitle>
          <CardDescription>{atoms.length} stk</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadAtoms} disabled={loadingAtoms}>
              {loadingAtoms ? "Henter…" : "Oppdater"}
            </Button>
            <Button variant="destructive" onClick={handleDeleteAllAtoms}>
              Slett alle mine atoms
            </Button>
          </div>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Innhold (NO)</TableHead>
                  <TableHead>Innhold (EN)</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Parent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {atoms.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs">{a.atom_type}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={a.content_no ?? ""}>
                      {a.content_no}
                    </TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={a.content_en ?? ""}>
                      {a.content_en}
                    </TableCell>
                    <TableCell className="text-xs">{a.confidence}</TableCell>
                    <TableCell className="text-xs">{a.source_type}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {a.parent_atom_id ? a.parent_atom_id.slice(0, 8) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {atoms.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground text-xs">
                      Ingen atoms ennå
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
