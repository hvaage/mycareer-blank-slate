// @ts-nocheck
import { cn } from "@/lib/utils";
import {
  STATUS_LABELS,
  STATUS_BADGE_CLASS,
  PRIORITY_LABELS,
  PRIORITY_BADGE_CLASS,
  SENTIMENT_LABELS,
  SENTIMENT_BADGE_CLASS,
  URGENCY_BADGE_CLASS,
} from "@/lib/constants";
import { Star } from "lucide-react";

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_BADGE_CLASS[status] ?? "bg-muted text-foreground",
        className
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority?: string | null }) {
  if (!priority) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        PRIORITY_BADGE_CLASS[priority] ?? "bg-muted"
      )}
    >
      {PRIORITY_LABELS[priority] ?? priority}
    </span>
  );
}

export function SentimentBadge({ sentiment }: { sentiment?: string | null }) {
  if (!sentiment) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        SENTIMENT_BADGE_CLASS[sentiment]
      )}
    >
      {SENTIMENT_LABELS[sentiment]}
    </span>
  );
}

export function UrgencyDot({ level }: { level?: string | null }) {
  if (!level) return null;
  return (
    <span
      className={cn("inline-block h-2.5 w-2.5 rounded-full", URGENCY_BADGE_CLASS[level] ?? "bg-slate-300")}
      title={`Hastenivå: ${level}`}
    />
  );
}

export function StarToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className="text-muted-foreground hover:text-yellow-500 transition-colors"
      aria-label={value ? "Fjern stjerne" : "Sett stjerne"}
    >
      <Star className={cn("h-4 w-4", value && "fill-yellow-400 text-yellow-500")} />
    </button>
  );
}

export function RatingStars({
  value,
  onChange,
  readOnly,
}: {
  value?: number | null;
  onChange?: (v: number) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(n)}
          className="text-muted-foreground hover:text-yellow-500 disabled:cursor-default"
        >
          <Star
            className={cn(
              "h-4 w-4",
              value && n <= value && "fill-yellow-400 text-yellow-500"
            )}
          />
        </button>
      ))}
    </div>
  );
}
