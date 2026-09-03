// Gjenbrukbar velger for standardisert yrkesbetegnelse (ESCO).
//
// Komponenten er uavhengig av profilsiden og kan senere gjenbrukes av
// «Gap mot målrolle». Den lagrer ingenting selv — den rapporterer valget
// oppover via onChange. Brukeren bekrefter alltid selv, også KI-forslag.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Sparkles, X } from "lucide-react";
import { supabase as marketSupabase, type EscoSearchResult } from "@/lib/market";
import { suggestOccupationMatch } from "@/lib/occupation-suggest.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";

export type OccupationSelection = {
  uri: string;
  title: string;
  source: "search" | "ai_suggestion";
};

type Props = {
  value: OccupationSelection | null;
  onChange: (value: OccupationSelection | null) => void;
  label?: string;
  description?: string;
  /** Valgfri kontekst som gjør KI-forslagene mer treffsikre. */
  industryHint?: string | null;
  backgroundHint?: string | null;
};

function escoTitle(row: EscoSearchResult): string {
  return (row.title_no || row.title || row.title_en || "").trim();
}

export function OccupationPicker({
  value,
  onChange,
  label = "Nåværende stilling",
  description = "Søk opp en standardisert betegnelse, eller be om KI-forslag. Du bekrefter selv.",
  industryHint = null,
  backgroundHint = null,
}: Props) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [aiItems, setAiItems] = useState<{ uri: string; title: string; reasonNb: string }[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const askAi = useServerFn(suggestOccupationMatch);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useQuery({
    queryKey: ["occupation-picker-esco", debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: async (): Promise<EscoSearchResult[]> => {
      const { data, error } = await marketSupabase.rpc("search_esco_occupations", {
        search_text: debounced,
        filter_industry_slugs: null,
        result_limit: 8,
      });
      if (error) throw new Error("Søket feilet. Prøv igjen om litt.");
      return (data ?? []) as EscoSearchResult[];
    },
  });

  const results = useMemo(
    () => (searchQuery.data ?? []).filter((r) => escoTitle(r).length > 0),
    [searchQuery.data],
  );

  async function handleAi() {
    setAiError(null);
    setAiLoading(true);
    setAiItems(null);
    try {
      const res = await askAi({
        data: {
          freeText: query.trim(),
          industryHint: industryHint ?? null,
          backgroundHint: backgroundHint ?? null,
        },
      });
      if (!res.ok) {
        setAiError("KI-forslag er ikke tilgjengelig akkurat nå. Bruk søket.");
      } else if (res.items.length === 0) {
        setAiError("Fant ingen passende betegnelser. Prøv andre ord i søket.");
      } else {
        setAiItems(res.items);
      }
    } catch {
      setAiError("KI-forslag feilet. Bruk søket.");
    } finally {
      setAiLoading(false);
    }
  }

  if (value) {
    return (
      <div className="space-y-2">
        <Label>{label}</Label>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{value.title}</p>
            <p className="text-xs text-muted-foreground">
              Standardisert betegnelse (ESCO)
              {value.source === "ai_suggestion" ? " · valgt fra KI-forslag" : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange(null);
              setAiItems(null);
              setQuery("");
            }}
          >
            <X className="mr-1 h-4 w-4" />
            Endre
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="occupation-search">{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="occupation-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="F.eks. salgssjef, prosjektleder, sykepleier"
            className="pl-9"
            autoComplete="off"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleAi}
          disabled={aiLoading || query.trim().length < 2}
        >
          {aiLoading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
          KI-forslag
        </Button>
      </div>

      {searchQuery.isError ? (
        <p className="text-xs text-destructive">Søket feilet. Prøv igjen om litt.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="divide-y rounded-md border border-border">
          {results.map((row) => (
            <li key={row.uri}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => onChange({ uri: row.uri, title: escoTitle(row), source: "search" })}
              >
                {escoTitle(row)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {aiError ? <p className="text-xs text-muted-foreground">{aiError}</p> : null}

      {aiItems && aiItems.length > 0 ? (
        <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[11px]">KI-forslag</Badge>
            <span className="text-xs text-muted-foreground">Du velger selv hva som lagres.</span>
          </div>
          <ul className="space-y-2">
            {aiItems.map((item) => (
              <li key={item.uri}>
                <button
                  type="button"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-left hover:bg-muted"
                  onClick={() => onChange({ uri: item.uri, title: item.title, source: "ai_suggestion" })}
                >
                  <span className="block text-sm font-medium text-foreground">{item.title}</span>
                  {item.reasonNb ? (
                    <span className="block text-xs text-muted-foreground">{item.reasonNb}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
