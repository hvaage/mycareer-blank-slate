// @ts-nocheck
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Plus, Loader2 } from "lucide-react";
import { searchPlaces, type PlaceResult } from "@/lib/place-search.functions";

interface Props {
  onSelect: (label: string) => void;
  existing: string[];
}

export function LocationCombobox({ onSelect, existing }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const search = useServerFn(searchPlaces);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await search({ data: { query: query.trim() } });
        if (!cancelled) setResults(r);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, search]);

  const existingLower = existing.map((e) => e.toLowerCase());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1">
          <Plus className="h-3.5 w-3.5" />
          Legg til by eller område
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Søk etter by, tettsted, kommune…"
          />
          <CommandList>
            {loading && (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> Søker…
              </div>
            )}
            {!loading && query.trim().length >= 2 && results.length === 0 && (
              <CommandEmpty>Ingen treff. Prøv et annet navn.</CommandEmpty>
            )}
            {!loading && query.trim().length < 2 && (
              <div className="py-4 text-center text-xs text-muted-foreground">
                Skriv minst 2 tegn for å søke.
              </div>
            )}
            {results.length > 0 && (
              <CommandGroup heading="Forslag fra Kartverket">
                {results.map((r) => {
                  const dup = existingLower.includes(r.displayLabel.toLowerCase());
                  return (
                    <CommandItem
                      key={r.displayLabel}
                      value={r.displayLabel}
                      disabled={dup}
                      onSelect={() => {
                        if (dup) return;
                        onSelect(r.displayLabel);
                        setQuery("");
                        setResults([]);
                        setOpen(false);
                      }}
                    >
                      <span>{r.displayLabel}</span>
                      {dup && (
                        <span className="ml-auto text-[10px] text-muted-foreground">
                          allerede valgt
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
