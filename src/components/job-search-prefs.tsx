// @ts-nocheck
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { LocationCombobox } from "@/components/location-combobox";

interface Props {
  keywords: string;
  locations: string[];
  onKeywordsChange: (v: string) => void;
  onLocationsChange: (v: string[]) => void;
  showPreview?: boolean;
}

export function JobSearchPrefs({
  keywords,
  locations,
  onKeywordsChange,
  onLocationsChange,
  showPreview = true,
}: Props) {
  const [kw, setKw] = useState(keywords);

  const addLocation = (label: string) => {
    if (locations.some((l) => l.toLowerCase() === label.toLowerCase())) return;
    onLocationsChange([...locations, label]);
  };
  const removeLocation = (label: string) => {
    onLocationsChange(locations.filter((l) => l !== label));
  };

  const kwList = kw.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 3);
  const locList = locations.slice(0, 3);
  const combos: string[] = [];
  const ks = kwList.length ? kwList : [""];
  const ls = locList.length ? locList : [""];
  for (const k of ks) for (const l of ls) combos.push(`«${k || "alle ord"}» i ${l || "hele Norge"}`);
  const previewCombos = combos.slice(0, 6);

  return (
    <div className="space-y-4">
      <div>
        <Label>Stillingstittel eller søkeord</Label>
        <Input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          onBlur={() => onKeywordsChange(kw)}
          placeholder="Head of Sales, CRO, CCO"
        />
        <p className="text-xs text-muted-foreground mt-1">
          Kommaseparerte søkeord — hvert ord gir et eget søk. Maks 3 brukes.
        </p>
      </div>

      <div>
        <Label className="block mb-2">Byer eller områder du søker jobb i</Label>
        <div className="flex flex-wrap gap-2 mb-2">
          {locations.length === 0 && (
            <span className="text-xs text-muted-foreground">
              Ingen valgt — hele Norge brukes som standard.
            </span>
          )}
          {locations.map((loc) => (
            <span
              key={loc}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-medium border inline-flex items-center gap-1",
                "bg-primary text-primary-foreground border-primary",
              )}
            >
              {loc}
              <button
                type="button"
                onClick={() => removeLocation(loc)}
                className="hover:opacity-80"
                aria-label={`Fjern ${loc}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <LocationCombobox onSelect={addLocation} existing={locations} />
        <p className="text-xs text-muted-foreground mt-2">
          Søk etter sted og bekreft fra forslagslista. Forslag kommer fra Kartverket.
          Maks 3 første brukes i jobbsøket.
        </p>
      </div>

      {showPreview && (
        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          Med disse innstillingene kjøres {previewCombos.length} søk mot Careerjet:
          <br />
          {previewCombos.join(", ")}
        </div>
      )}
    </div>
  );
}
