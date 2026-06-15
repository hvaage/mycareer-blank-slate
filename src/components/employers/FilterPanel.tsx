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
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Fylke</Label>
          <Select
            value={values.fylke ?? "__all"}
            onValueChange={(v) => onChange({ fylke: v === "__all" ? undefined : v, kommune: undefined })}
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
          <Label className="text-xs">Bransje (NACE-prefiks)</Label>
          <Input
            value={values.nace ?? ""}
            onChange={(e) => onChange({ nace: e.target.value || undefined })}
            placeholder="f.eks. 62 eller 62.01"
            className="h-9"
          />
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
