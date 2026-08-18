// @ts-nocheck
/**
 * Kvalifikasjoner som kan dokumenteres (språk, førerkort, sertifiseringer,
 * vitnemål, verktøy) leses fra samme grunnlag som resten: `career_atoms`.
 * Gradering og opplastet dokumentasjon lagres på atomet, ikke i en egen kopi.
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  classifyCredential,
  credentialDocuments,
  type CredentialKind,
  type CredentialDocument,
} from "@/lib/credential-kinds";

const db = supabase as any;
const BUCKET = "job-documents";

export type CredentialAtomRow = {
  id: string;
  content_no: string | null;
  atom_type: string | null;
  atom_class: string | null;
  structured_data: Record<string, unknown> | null;
  attestation: string | null;
  source_type: string | null;
  user_confirmed: boolean | null;
  created_at: string | null;
};

export const credentialAtomKeys = {
  all: (userId: string) => ["credential-atoms", userId] as const,
};

export function invalidateCredentialAtoms(qc: QueryClient, userId: string) {
  void qc.invalidateQueries({ queryKey: credentialAtomKeys.all(userId) });
  void qc.invalidateQueries({ queryKey: ["career-atoms"] });
  void qc.invalidateQueries({ queryKey: ["documentation"] });
}

export const credentialAtomsQuery = (userId: string) =>
  queryOptions({
    queryKey: credentialAtomKeys.all(userId),
    enabled: Boolean(userId),
    staleTime: 30_000,
    queryFn: async (): Promise<Record<CredentialKind, CredentialAtomRow[]>> => {
      const { data, error } = await db
        .from("career_atoms")
        .select(
          "id, content_no, atom_type, atom_class, structured_data, attestation, source_type, user_confirmed, created_at",
        )
        .eq("user_id", userId)
        .eq("atom_kind", "evidens")
        .eq("is_active", true)
        .in("atom_type", ["language", "certification", "education", "tool"])
        .order("content_no", { ascending: true });
      if (error) throw error;

      const grouped: Record<CredentialKind, CredentialAtomRow[]> = {
        sprak: [],
        forerkort: [],
        sertifisering: [],
        vitnemal: [],
        verktoy: [],
      };
      for (const row of (data ?? []) as CredentialAtomRow[]) {
        const kind = classifyCredential({
          atomType: row.atom_type,
          text: row.content_no,
          structured: row.structured_data,
        });
        if (kind) grouped[kind].push(row);
      }
      return grouped;
    },
  });

async function patchStructured(
  userId: string,
  atomId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data, error } = await db
    .from("career_atoms")
    .select("structured_data")
    .eq("id", atomId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const current =
    data?.structured_data && typeof data.structured_data === "object" && !Array.isArray(data.structured_data)
      ? (data.structured_data as Record<string, unknown>)
      : {};
  const { error: updErr } = await db
    .from("career_atoms")
    .update({ structured_data: { ...current, ...patch } })
    .eq("id", atomId)
    .eq("user_id", userId);
  if (updErr) throw updErr;
}

export function setLanguageLevel(userId: string, atomId: string, level: string | null) {
  return patchStructured(userId, atomId, { sprak_niva: level });
}

export function setLicenseClasses(userId: string, atomId: string, classes: string[]) {
  return patchStructured(userId, atomId, { forerkort_klasser: classes });
}

export function setCredentialKind(userId: string, atomId: string, kind: CredentialKind) {
  return patchStructured(userId, atomId, { credential_kind: kind });
}

/** Laster opp en fil, arkiverer den i Min dokumentasjon og fester den på atomet. */
export async function uploadCredentialDocument(args: {
  userId: string;
  atomId: string;
  title: string;
  kindLabel: string;
  file: File;
}): Promise<void> {
  const { userId, atomId, title, kindLabel, file } = args;
  const safeName = file.name.replace(/[^\w.\-æøåÆØÅ ]+/g, "_");
  const path = `${userId}/dokumentasjon/${atomId}/${Date.now()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw upErr;

  let documentId: string | null = null;
  const { data: doc, error: docErr } = await db
    .from("documents")
    .insert({
      user_id: userId,
      title: `${kindLabel}: ${title}`,
      document_type: "annet",
      file_path: path,
      file_name: file.name,
      file_size_bytes: file.size,
      mime_type: file.type || null,
      documentation_category: "Kvalifikasjonsdokumentasjon",
      documentation_subcategory: kindLabel,
      source_context: "credential_upload",
      atom_ids: [atomId],
    })
    .select("id")
    .single();
  if (docErr) throw docErr;
  documentId = doc?.id ?? null;

  const { data: atom, error: readErr } = await db
    .from("career_atoms")
    .select("structured_data")
    .eq("id", atomId)
    .eq("user_id", userId)
    .single();
  if (readErr) throw readErr;

  const current =
    atom?.structured_data && typeof atom.structured_data === "object" && !Array.isArray(atom.structured_data)
      ? (atom.structured_data as Record<string, unknown>)
      : {};
  const entry: CredentialDocument = {
    document_id: documentId,
    path,
    name: file.name,
    uploaded_at: new Date().toISOString(),
  };
  const next = [...credentialDocuments(current), entry];

  const { error: updErr } = await db
    .from("career_atoms")
    .update({ structured_data: { ...current, dokumentasjon: next } })
    .eq("id", atomId)
    .eq("user_id", userId);
  if (updErr) throw updErr;
}

export async function removeCredentialDocument(
  userId: string,
  atomId: string,
  doc: CredentialDocument,
): Promise<void> {
  await supabase.storage.from(BUCKET).remove([doc.path]);
  if (doc.document_id) {
    await db
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", doc.document_id)
      .eq("user_id", userId);
  }
  const { data: atom, error } = await db
    .from("career_atoms")
    .select("structured_data")
    .eq("id", atomId)
    .eq("user_id", userId)
    .single();
  if (error) throw error;
  const current =
    atom?.structured_data && typeof atom.structured_data === "object" && !Array.isArray(atom.structured_data)
      ? (atom.structured_data as Record<string, unknown>)
      : {};
  const next = credentialDocuments(current).filter((d) => d.path !== doc.path);
  const { error: updErr } = await db
    .from("career_atoms")
    .update({ structured_data: { ...current, dokumentasjon: next } })
    .eq("id", atomId)
    .eq("user_id", userId);
  if (updErr) throw updErr;
}

export async function openCredentialDocument(doc: CredentialDocument): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, 60);
  if (error || !data) throw error ?? new Error("Kunne ikke åpne filen");
  return data.signedUrl;
}
