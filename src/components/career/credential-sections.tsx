// @ts-nocheck
/**
 * Språk, førerkort, sertifiseringer, vitnemål og verktøy — vist som egne
 * seksjoner. Dette er ikke løse erfaringer: de kan graderes og dokumenteres,
 * og derfor får de gradering og opplasting her.
 */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Loader2, Paperclip, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth-context";
import {
  CREDENTIAL_DOCUMENTABLE,
  CREDENTIAL_DOC_HINT,
  CREDENTIAL_KIND_LABEL,
  CREDENTIAL_KIND_SINGULAR,
  CREDENTIAL_SECTION_ID,
  CREDENTIAL_KIND_ORDER,
  DRIVING_LICENSE_CLASSES,
  LANGUAGE_LEVELS,
  LANGUAGE_LEVEL_SHORT,
  credentialDocuments,
  type CredentialKind,
} from "@/lib/credential-kinds";
import {
  credentialAtomsQuery,
  invalidateCredentialAtoms,
  openCredentialDocument,
  removeCredentialDocument,
  setLanguageLevel,
  setLicenseClasses,
  uploadCredentialDocument,
  type CredentialAtomRow,
} from "@/lib/queries/credential-atoms";

const NO_LEVEL = "__ingen__";

function sd(row: CredentialAtomRow): Record<string, any> {
  const v = row.structured_data;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function DocumentList({
  row,
  userId,
  onChanged,
}: {
  row: CredentialAtomRow;
  userId: string;
  onChanged: () => void;
}) {
  const docs = credentialDocuments(row.structured_data);
  if (docs.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {docs.map((doc) => (
        <li key={doc.path} className="flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]">
          <Paperclip className="h-3 w-3 text-muted-foreground" />
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={async () => {
              try {
                window.open(await openCredentialDocument(doc), "_blank");
              } catch (e: any) {
                toast.error(e?.message ?? "Kunne ikke åpne filen");
              }
            }}
          >
            {doc.name}
          </button>
          <button
            type="button"
            aria-label="Fjern dokumentasjon"
            className="text-muted-foreground hover:text-destructive"
            onClick={async () => {
              try {
                await removeCredentialDocument(userId, row.id, doc);
                toast.success("Dokumentasjonen er fjernet.");
                onChanged();
              } catch (e: any) {
                toast.error(e?.message ?? "Kunne ikke fjerne filen");
              }
            }}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function UploadButton({
  row,
  kind,
  userId,
  onChanged,
}: {
  row: CredentialAtomRow;
  kind: CredentialKind;
  userId: string;
  onChanged: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await uploadCredentialDocument({
              userId,
              atomId: row.id,
              title: row.content_no ?? CREDENTIAL_KIND_SINGULAR[kind],
              kindLabel: CREDENTIAL_KIND_SINGULAR[kind],
              file,
            });
            toast.success("Dokumentasjonen er lastet opp og ligger i Min dokumentasjon.");
            onChanged();
          } catch (err: any) {
            toast.error(err?.message ?? "Opplasting feilet");
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <FileUp className="mr-1 h-3 w-3" />
        )}
        Last opp
      </Button>
    </>
  );
}

function LanguageLevelPicker({
  row,
  userId,
  onChanged,
}: {
  row: CredentialAtomRow;
  userId: string;
  onChanged: () => void;
}) {
  const level = sd(row).sprak_niva ?? null;
  const save = useMutation({
    mutationFn: (value: string | null) => setLanguageLevel(userId, row.id, value),
    onSuccess: () => {
      toast.success("Nivået er lagret.");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Select
      value={level ?? NO_LEVEL}
      onValueChange={(v) => save.mutate(v === NO_LEVEL ? null : v)}
    >
      <SelectTrigger className="h-7 w-[230px] text-[11px]">
        <SelectValue placeholder="Velg nivå" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_LEVEL}>Nivå ikke satt</SelectItem>
        {LANGUAGE_LEVELS.map((l) => (
          <SelectItem key={l.value} value={l.value}>
            {l.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LicenseClassPicker({
  row,
  userId,
  onChanged,
}: {
  row: CredentialAtomRow;
  userId: string;
  onChanged: () => void;
}) {
  const selected: string[] = Array.isArray(sd(row).forerkort_klasser)
    ? sd(row).forerkort_klasser
    : [];
  const save = useMutation({
    mutationFn: (next: string[]) => setLicenseClasses(userId, row.id, next),
    onSuccess: onChanged,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex flex-wrap gap-1">
      {DRIVING_LICENSE_CLASSES.map((c) => {
        const on = selected.includes(c.value);
        return (
          <button
            key={c.value}
            type="button"
            title={c.label}
            onClick={() =>
              save.mutate(on ? selected.filter((v) => v !== c.value) : [...selected, c.value])
            }
            className={
              "rounded border px-1.5 py-0.5 text-[11px] " +
              (on ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground")
            }
          >
            {c.value}
          </button>
        );
      })}
    </div>
  );
}

function CredentialRow({
  row,
  kind,
  userId,
  onChanged,
}: {
  row: CredentialAtomRow;
  kind: CredentialKind;
  userId: string;
  onChanged: () => void;
}) {
  const data = sd(row);
  const docs = credentialDocuments(row.structured_data);
  const level = data.sprak_niva as string | undefined;
  const classes: string[] = Array.isArray(data.forerkort_klasser) ? data.forerkort_klasser : [];

  return (
    <li className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="min-w-0 flex-1 basis-48 text-sm leading-snug">
          {row.content_no ?? "(uten tekst)"}
        </span>
        {kind === "sprak" && level ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
            {LANGUAGE_LEVEL_SHORT[level] ?? level}
          </Badge>
        ) : null}
        {kind === "forerkort" && classes.length > 0 ? (
          <Badge variant="secondary" className="h-5 px-1.5 text-[11px] font-normal">
            Klasse {classes.join(", ")}
          </Badge>
        ) : null}
        {CREDENTIAL_DOCUMENTABLE[kind] ? (
          <Badge
            variant="outline"
            className={
              "h-5 px-1.5 text-[11px] font-normal " +
              (docs.length > 0 ? "" : "border-amber-500/50 text-amber-700 dark:text-amber-400")
            }
          >
            {docs.length > 0 ? `${docs.length} dokument${docs.length === 1 ? "" : "er"}` : "Ikke dokumentert"}
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {kind === "sprak" && <LanguageLevelPicker row={row} userId={userId} onChanged={onChanged} />}
        {kind === "forerkort" && (
          <LicenseClassPicker row={row} userId={userId} onChanged={onChanged} />
        )}
        {CREDENTIAL_DOCUMENTABLE[kind] && (
          <UploadButton row={row} kind={kind} userId={userId} onChanged={onChanged} />
        )}
        <DocumentList row={row} userId={userId} onChanged={onChanged} />
      </div>
    </li>
  );
}

export function useCredentialAtoms() {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const query = useQuery(credentialAtomsQuery(userId));
  const qc = useQueryClient();
  return {
    userId,
    ...query,
    refresh: () => invalidateCredentialAtoms(qc, userId),
  };
}

/** Én seksjon per art, i fast rekkefølge. */
export function CredentialSections({ kinds }: { kinds?: CredentialKind[] }) {
  const { userId, data, isLoading, isError, error, refresh } = useCredentialAtoms();
  const order = kinds ?? CREDENTIAL_KIND_ORDER;

  if (!userId || isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) {
    return (
      <p className="text-sm text-destructive">
        Kunne ikke laste kvalifikasjonene: {(error as Error)?.message ?? "ukjent feil"}
      </p>
    );
  }

  return (
    <>
      {order.map((kind) => {
        const rows = data?.[kind] ?? [];
        return (
          <section key={kind} id={CREDENTIAL_SECTION_ID[kind]} className="scroll-mt-20">
            <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-border pb-1.5">
              <h2 className="text-sm font-semibold uppercase tracking-wide">
                {CREDENTIAL_KIND_LABEL[kind]}
              </h2>
              <span className="text-xs text-muted-foreground">({rows.length})</span>
              <span className="text-xs text-muted-foreground">{CREDENTIAL_DOC_HINT[kind]}</span>
            </div>
            {rows.length === 0 ? (
              <p className="py-1 text-sm text-muted-foreground">Ingen registrert.</p>
            ) : (
              <ul className="divide-y divide-border/60 lg:columns-2 lg:gap-x-8 [&>li]:break-inside-avoid">
                {rows.map((row) => (
                  <CredentialRow
                    key={row.id}
                    row={row}
                    kind={kind}
                    userId={userId}
                    onChanged={refresh}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
