// @ts-nocheck
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Loader2 } from "lucide-react";
import {
  useArchivedCvSources,
  type ArchivedCvSource,
} from "@/lib/queries/cv-archive-sources";
import { fmtDate } from "@/lib/format";

interface Props {
  userId: string;
  busy?: boolean;
  onUse: (source: ArchivedCvSource) => void;
}

export function ArchiveCvPicker({ userId, busy, onUse }: Props) {
  const sources = useArchivedCvSources(userId);
  const [pending, setPending] = useState<string | null>(null);

  if (sources.isLoading) return <Skeleton className="h-24 w-full" />;

  if (sources.isError) {
    return (
      <p className="text-sm text-destructive">
        Kunne ikke sjekke CV-arkivet:{" "}
        {sources.error instanceof Error ? sources.error.message : "ukjent årsak"}. Det betyr
        ikke at arkivet er tomt.
      </p>
    );
  }

  if (!sources.data?.length) return null;

  const groups = sources.data.reduce<Record<string, ArchivedCvSource[]>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium">Bruk en CV du allerede har lagret</p>
        <p className="text-xs text-muted-foreground">
          Vi fant {sources.data.length} CV-fil{sources.data.length === 1 ? "" : "er"} i arkivet
          ditt. Velg én, så kopieres den inn til analyse — arkivfilen blir liggende urørt.
        </p>
      </div>
      <div className="space-y-3">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">{group}</p>
            <ul className="space-y-1.5">
              {items.map((s) => (
                <li
                  key={s.key}
                  className="flex items-center gap-3 rounded-md border bg-background p-2.5"
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{s.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.filename}
                      {s.updatedAt ? ` · ${fmtDate(s.updatedAt)}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setPending(s.key);
                      onUse(s);
                    }}
                  >
                    {busy && pending === s.key && (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    )}
                    Bruk denne
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
