type Props = {
  score: number | null;
  size?: "sm" | "md" | "lg";
};

function colorFor(score: number | null) {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 4.0) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (score >= 3.0) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
}

export function ScoreBadge({ score, size = "md" }: Props) {
  const cls = colorFor(score);
  const sizeCls =
    size === "lg"
      ? "text-2xl px-3 py-1.5"
      : size === "sm"
        ? "text-xs px-2 py-0.5"
        : "text-base px-2.5 py-1";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-semibold tabular-nums ${cls} ${sizeCls}`}
    >
      {score == null ? "–" : score.toFixed(1)}
    </span>
  );
}
