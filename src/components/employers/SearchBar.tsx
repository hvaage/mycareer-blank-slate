import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchBar({
  value,
  onChange,
  placeholder = "Søk firmanavn eller organisasjonsnummer",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 pl-9 text-base"
        aria-label="Søk arbeidsgiver"
      />
    </div>
  );
}
