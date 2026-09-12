// @ts-nocheck
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type ResultsFilters = {
  respondent_types: string[];
  seniority_levels: string[];
  years_experience: string[];
  sectors: string[];
};

export const EMPTY_FILTERS: ResultsFilters = {
  respondent_types: [],
  seniority_levels: [],
  years_experience: [],
  sectors: [],
};

const GROUPS: Array<{ key: keyof ResultsFilters; title: string }> = [
  { key: "respondent_types", title: "Type respondent" },
  { key: "seniority_levels", title: "Nivå det rekrutteres til" },
  { key: "years_experience", title: "År erfaring med rekruttering" },
  { key: "sectors", title: "Primær sektor" },
];

export function ResultsFilterPanel({
  facets,
  filters,
  onChange,
}: {
  facets: any;
  filters: ResultsFilters;
  onChange: (next: ResultsFilters) => void;
}) {
  const active = Object.values(filters).some((v) => v.length > 0);

  const toggle = (key: keyof ResultsFilters, value: string) => {
    const current = filters[key];
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    onChange({ ...filters, [key]: next });
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Filtrer respondentgruppe
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Velg ett eller flere alternativer. Alternativer innenfor samme gruppe kombineres med
            «eller», og gruppene kombineres med «og».
          </p>
        </div>
        {active && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
            Nullstill
          </Button>
        )}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {GROUPS.map(({ key, title }) => {
          const options = (facets?.[key] ?? []) as Array<{ value: string; count: number }>;
          if (options.length === 0) return null;
          return (
            <div key={key}>
              <p className="text-xs font-medium">{title}</p>
              <div className="mt-2 space-y-2">
                {options.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={filters[key].includes(o.value)}
                      onCheckedChange={() => toggle(key, o.value)}
                    />
                    <span className="flex-1">{o.value}</span>
                    <span className="tabular-nums text-xs text-muted-foreground">{o.count}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
