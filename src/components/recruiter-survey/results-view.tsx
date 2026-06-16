// @ts-nocheck
import { Card } from "@/components/ui/card";

type Result =
  | {
      question_id: string;
      question_text: string;
      category: string | null;
      type: "single_choice" | "multi_choice" | "ranked_choice";
      total: number;
      max_choices?: number | null;
      counts: Record<string, number>;
      option_total: number;
    }
  | {
      question_id: string;
      question_text: string;
      category: string | null;
      type: "scale";
      total: number;
      average: number | null;
      scale_min: number;
      scale_max: number;
      scale_min_label?: string;
      scale_mid_label?: string;
      scale_max_label?: string;
      distribution: Record<string, number>;
    }
  | {
      question_id: string;
      question_text: string;
      category: string | null;
      type: "open_text";
      total: number;
      quotes: string[];
    };

export function ResultsView({
  profile, results, mode,
}: { profile: any; results: Result[]; mode: "public" | "full" }) {
  return (
    <div className="space-y-6">
      <ProfileCard profile={profile} />
      {results.map((r) => (
        <ResultCard key={r.question_id} r={r} />
      ))}
      {mode === "public" && (
        <p className="pt-4 text-xs text-muted-foreground">
          Full versjon viser flere spørsmål, åpne sitater og filtrering. Be om tilsendt
          tilgangslenke for tilgang.
        </p>
      )}
    </div>
  );
}

function ProfileCard({ profile }: { profile: any }) {
  if (!profile) return null;
  return (
    <Card className="p-5 sm:p-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Respondenter
      </p>
      <p className="mt-2 text-3xl font-semibold">{profile.total}</p>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
        <DistList title="Type respondent" data={profile.respondent_type} />
        <DistList title="Bransjer" data={profile.industries} />
        <DistList title="Senioritetsnivå" data={profile.seniority_levels} />
        <DistList title="Fokus" data={profile.candidate_focus} />
      </div>
    </Card>
  );
}

function DistList({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data ?? {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="mt-2 space-y-1.5">
        {entries.map(([k, v]) => {
          const pct = total ? Math.round((v / total) * 100) : 0;
          return (
            <div key={k}>
              <div className="flex items-center justify-between text-xs">
                <span className="truncate">{k}</span>
                <span className="tabular-nums text-muted-foreground">{v} ({pct}%)</span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ResultCard({ r }: { r: Result }) {
  return (
    <Card className="p-5 sm:p-6">
      {r.category && (
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {r.category}
        </p>
      )}
      <h3 className="mt-2 text-base font-semibold leading-snug sm:text-lg">{r.question_text}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{r.total} svar</p>

      <div className="mt-4">
        {r.type === "single_choice" || r.type === "multi_choice" || r.type === "ranked_choice" ? (
          <BarChart
            counts={r.counts}
            total={r.type === "single_choice" ? r.total : r.option_total}
          />
        ) : r.type === "scale" ? (
          <ScaleView r={r as any} />
        ) : (
          <QuoteList quotes={r.quotes} />
        )}
      </div>
    </Card>
  );
}

function BarChart({ counts, total }: { counts: Record<string, number>; total: number }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v]) => {
        const pct = total ? Math.round((v / total) * 100) : 0;
        return (
          <div key={k}>
            <div className="flex items-center justify-between text-xs">
              <span className="truncate pr-2">{k}</span>
              <span className="tabular-nums text-muted-foreground">{v} ({pct}%)</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScaleView({ r }: { r: any }) {
  const max = Math.max(1, ...Object.values<number>(r.distribution));
  const nums = Array.from(
    { length: (r.scale_max ?? 10) - (r.scale_min ?? 1) + 1 },
    (_, i) => i + (r.scale_min ?? 1),
  );
  return (
    <div>
      <p className="text-sm">
        Snitt: <span className="font-semibold">{r.average ?? "–"}</span> / {r.scale_max}
      </p>
      <div className="mt-4 flex items-end gap-1.5">
        {nums.map((n) => {
          const v = r.distribution?.[String(n)] ?? 0;
          const h = Math.max(4, Math.round((v / max) * 80));
          return (
            <div key={n} className="flex flex-1 flex-col items-center gap-1">
              <div className="w-full rounded-sm bg-foreground/80" style={{ height: `${h}px` }} />
              <span className="text-[10px] text-muted-foreground tabular-nums">{n}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
        <span>{r.scale_min_label}</span>
        <span>{r.scale_max_label}</span>
      </div>
    </div>
  );
}

function QuoteList({ quotes }: { quotes: string[] }) {
  if (!quotes || quotes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Ingen sitater er godkjent for visning ennå.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {quotes.map((q, i) => (
        <li key={i} className="border-l-2 border-foreground/30 pl-3 text-sm italic">
          {q}
        </li>
      ))}
    </ul>
  );
}
