import { Badge } from "@/components/ui/badge";

export function RiskBadges({ flags }: { flags?: string[] | null }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} variant="destructive" className="font-normal">
          {humanize(f)}
        </Badge>
      ))}
    </div>
  );
}

export function DataQualityBadges({ flags }: { flags?: string[] | null }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f} variant="secondary" className="font-normal">
          {humanize(f)}
        </Badge>
      ))}
    </div>
  );
}

export function TypeBadge({ value }: { value?: string | null }) {
  if (!value) return null;
  return (
    <Badge variant="outline" className="font-normal whitespace-nowrap">
      {humanize(value)}
    </Badge>
  );
}

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
