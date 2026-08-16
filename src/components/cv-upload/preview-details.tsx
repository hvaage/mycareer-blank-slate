// @ts-nocheck
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildPreviewGroups,
  flattenItems,
  type PreviewItem,
} from "@/lib/cv-preview-items";
import {
  statusFor,
  useExistingCvSignatures,
  type ItemStatus,
} from "@/lib/queries/existing-cv-signatures";

const STATUS_LABEL: Record<ItemStatus, { label: string; className: string }> = {
  ny: { label: "Ny", className: "bg-green-600 hover:bg-green-600 text-white" },
  finnes: { label: "Finnes fra før", className: "bg-muted text-muted-foreground hover:bg-muted" },
  endret: { label: "Endret", className: "bg-amber-500 hover:bg-amber-500 text-white" },
};

interface Props {
  userId: string;
  raw: any;
  selected: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  onSetMany: (keys: string[], checked: boolean) => void;
}

export function PreviewDetails({ userId, raw, selected, onToggle, onSetMany }: Props) {
  const groups = useMemo(() => buildPreviewGroups(raw), [raw]);
  const existing = useExistingCvSignatures(userId);
  const allItems = useMemo(() => flattenItems(groups), [groups]);

  const counts = useMemo(() => {
    const c = { ny: 0, finnes: 0, endret: 0 };
    for (const it of allItems) c[statusFor(it, existing.data)] += 1;
    return c;
  }, [allItems, existing.data]);

  const selectedCount = allItems.filter((i) => selected.has(i.key)).length;

  const renderItem = (item: PreviewItem, nested = false) => {
    const status = statusFor(item, existing.data);
    const badge = STATUS_LABEL[status];
    const parentKey = nested ? item.key.split(":bullet:")[0] : null;
    const parentOff = parentKey ? !selected.has(parentKey) : false;
    return (
      <li key={item.key} className={nested ? "pl-7" : ""}>
        <label className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50">
          <Checkbox
            className="mt-0.5"
            checked={selected.has(item.key) && !parentOff}
            disabled={parentOff}
            onCheckedChange={(v) => onToggle(item.key, v === true)}
          />
          <span className="min-w-0 flex-1">
            <span className={`block text-sm ${parentOff ? "text-muted-foreground line-through" : ""}`}>
              {item.label}
            </span>
            {item.detail && (
              <span className="block text-xs text-muted-foreground">{item.detail}</span>
            )}
          </span>
          {!existing.isLoading && (
            <Badge className={`shrink-0 text-[10px] ${badge.className}`}>{badge.label}</Badge>
          )}
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 p-3 space-y-2">
        <p className="text-sm">
          Vi fant <strong>{allItems.length}</strong> elementer. Alt er huket av på forhånd —
          fjern haken på det du ikke vil lagre. Ingenting lagres før du trykker «Bekreft og lagre».
        </p>
        {existing.isLoading ? (
          <Skeleton className="h-4 w-56" />
        ) : existing.isError ? (
          <p className="text-xs text-destructive">
            Kunne ikke sammenligne med det du har fra før:{" "}
            {existing.error instanceof Error ? existing.error.message : "ukjent årsak"}. Merkingen
            «Ny / Finnes fra før / Endret» er derfor ikke vist.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {counts.ny} nye · {counts.endret} endret · {counts.finnes} finnes fra før
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => onSetMany(allItems.map((i) => i.key), true)}>
            Velg alle
          </Button>
          <Button size="sm" variant="outline" onClick={() => onSetMany(allItems.map((i) => i.key), false)}>
            Fjern alle
          </Button>
          {!existing.isError && counts.finnes > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                onSetMany(
                  allItems.filter((i) => statusFor(i, existing.data) === "finnes").map((i) => i.key),
                  false,
                )
              }
            >
              Fjern det som finnes fra før
            </Button>
          )}
          <span className="ml-auto self-center text-xs text-muted-foreground">
            {selectedCount} av {allItems.length} valgt
          </span>
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.id} className="rounded-md border p-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h4 className="text-sm font-semibold">
              {g.title}{" "}
              <span className="font-normal text-muted-foreground">({g.items.length})</span>
            </h4>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{g.hint}</p>
          <ul className="space-y-1">
            {g.items.map((item) => (
              <li key={item.key}>
                <ul className="space-y-1">
                  {renderItem(item)}
                  {(item.children ?? []).map((child) => renderItem(child, true))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
