import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ARBEIDSGIVER_TYPER, FYLKER } from "@/lib/employers/no-regions";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export type FilterValues = {
  // Primært tekstsøk
  kommuneQuery?: string;
  bransjeQuery?: string;
  // Avanserte kodefilter
  fylke?: string;
  kommune?: string;
  nace?: string;
  ansatteMin?: number;
  ansatteMaks?: number;
  omsMin?: number;
  omsMaks?: number;
  type?: string;
};

export function FilterPanel({
  values,
  onChange,
  onReset,
}: {
  values: FilterValues;
  onChange: (patch: Partial<FilterValues>) => void;
  onReset: () => void;
}) {
  const [advanced, setAdvanced] = useState<boolean>(
    Boolean(values.fylke || values.kommune || values.nace),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Kommune</Label>
          <Input
            value={values.kommuneQuery ?? ""}
            onChange={(e) => onChange({ kommuneQuery: e.target.value || undefined })}
            placeholder="f.eks. Oslo, Stavanger, Bergen"
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Bransje</Label>
          <Input
            value={values.bransjeQuery ?? ""}
            onChange={(e) => onChange({ bransjeQuery: e.target.value || undefined })}
            placeholder="f.eks. IT, bygg, helse, konsulent"
            className="h-9"
          />
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Arbeidsgivertype</Label>
          <Select
            value={values.type ?? "__all"}
            onValueChange={(v) => onChange({ type: v === "__all" ? undefined : v })}
          >
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Alle typer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Alle typer</SelectItem>
              {ARBEIDSGIVER_TYPER.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Ansatte</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              value={values.ansatteMin ?? ""}
              onChange={(e) => onChange({ ansatteMin: parseNum(e.target.value) })}
              placeholder="Min"
              className="h-9"
            />
            <Input
              type="number"
              min={0}
              value={values.ansatteMaks ?? ""}
              onChange={(e) => onChange({ ansatteMaks: parseNum(e.target.value) })}
              placeholder="Maks"
              className="h-9"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Omsetning (NOK)</Label>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              value={values.omsMin ?? ""}
              onChange={(e) => onChange({ omsMin: parseNum(e.target.value) })}
              placeholder="Min"
              className="h-9"
            />
            <Input
              type="number"
              min={0}
              value={values.omsMaks ?? ""}
              onChange={(e) => onChange({ omsMaks: parseNum(e.target.value) })}
              placeholder="Maks"
              className="h-9"
            />
          </div>
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setAdvanced((a) => !a)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Avansert: kodefilter (fylke, kommunenummer, NACE)
        </button>
        {advanced && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Fylke</Label>
              <Select
                value={values.fylke ?? "__all"}
                onValueChange={(v) =>
                  onChange({ fylke: v === "__all" ? undefined : v, kommune: undefined })
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Alle fylker" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Alle fylker</SelectItem>
                  {FYLKER.map((f) => (
                    <SelectItem key={f.nummer} value={f.nummer}>
                      {f.nummer} {f.navn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Kommunenummer</Label>
              <Input
                value={values.kommune ?? ""}
                onChange={(e) => onChange({ kommune: e.target.value || undefined })}
                placeholder="f.eks. 0301"
                className="h-9"
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">NACE-prefiks</Label>
              <Input
                value={values.nace ?? ""}
                onChange={(e) => onChange({ nace: e.target.value || undefined })}
                placeholder="f.eks. 62 eller 62.01"
                className="h-9"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={onReset}>
          Nullstill filtre
        </Button>
      </div>
    </div>
  );
}

function parseNum(v: string): number | undefined {
  if (v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
