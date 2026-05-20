import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { getAdminDashboard, type AdminDashboardRow } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Admin · Dashboard — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminDashboard,
});

type Segment = AdminDashboardRow["segment"] | "alle";

const SEGMENT_LABELS: Record<AdminDashboardRow["segment"], string> = {
  abonnent: "Abonnent",
  engangsbruker: "Engangsbruker",
  nedlasting: "Kun nedlasting",
  gjest: "Gjest",
};

const SEGMENT_DESCRIPTIONS: Record<AdminDashboardRow["segment"], string> = {
  abonnent: "Har konto + samtykket til nyhetsbrev",
  engangsbruker: "Har registrert konto, men ikke nyhetsbrev",
  nedlasting: "Har lastet ned skill, men ingen konto",
  gjest: "Registrerte lead, ingen nedlasting eller konto",
};

const SKILL_LABELS: Record<string, string> = {
  selskapsanalyse: "Arbeidsgiveranalysen",
  "direct-signup": "Direkte registrering",
};

function skillLabel(s: string) {
  return SKILL_LABELS[s] ?? s;
}

function AdminDashboard() {
  const fetchDash = useServerFn(getAdminDashboard);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: () => fetchDash(),
  });

  const [segment, setSegment] = useState<Segment>("alle");
  const [skill, setSkill] = useState<string>("alle");
  const [search, setSearch] = useState("");

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const bySkill = data?.bySkill ?? [];

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (segment !== "alle" && r.segment !== segment) return false;
      if (skill !== "alle" && r.source !== skill) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !r.email.toLowerCase().includes(q) &&
          !r.first_name.toLowerCase().includes(q) &&
          !(r.role ?? "").toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [rows, segment, skill, search]);

  function exportCsv() {
    const headers = [
      "created_at",
      "first_name",
      "email",
      "role",
      "source",
      "segment",
      "has_account",
      "consent_marketing",
      "downloaded_at",
      "account_created_at",
      "last_sign_in_at",
    ];
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(",")]
      .concat(
        filtered.map((r) =>
          headers
            .map((h) => esc((r as unknown as Record<string, unknown>)[h]))
            .join(",")
        )
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `karrierenmin-brukere-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const errMessage = error ? (error as Error).message : null;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 py-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Admin dashboard
            </h1>
            <p className="text-sm text-muted-foreground">
              Oversikt over alle registrerte brukere på karrierenmin.no
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/_authenticated/admin/leads"
              className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent"
            >
              Detaljert leads-visning
            </Link>
            <button
              onClick={exportCsv}
              disabled={!filtered.length}
              className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Eksporter CSV
            </button>
          </div>
        </div>

        {isLoading && <p className="mt-8 text-muted-foreground">Laster…</p>}

        {errMessage && (
          <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
            {errMessage}
            {errMessage.includes("Forbidden") && (
              <p className="mt-2 text-xs">
                Brukeren din mangler admin-rollen i <code>user_roles</code>.
              </p>
            )}
          </div>
        )}

        {!isLoading && !errMessage && totals && (
          <>
            {/* Segment cards */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
              <SegmentCard
                label="Totalt"
                count={totals.total}
                active={segment === "alle"}
                onClick={() => setSegment("alle")}
                description="Alle registreringer"
              />
              {(
                ["abonnent", "engangsbruker", "nedlasting", "gjest"] as const
              ).map((s) => (
                <SegmentCard
                  key={s}
                  label={SEGMENT_LABELS[s]}
                  count={totals[s]}
                  active={segment === s}
                  onClick={() => setSegment(s)}
                  description={SEGMENT_DESCRIPTIONS[s]}
                />
              ))}
            </div>

            {/* Per-skill breakdown */}
            <section className="mt-10">
              <h2 className="text-lg font-semibold text-foreground">
                Per skill
              </h2>
              <p className="text-sm text-muted-foreground">
                Brukere per skill / kilde
              </p>
              <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <Th>Skill</Th>
                      <Th>Totalt</Th>
                      <Th>Abonnent</Th>
                      <Th>Engangsbruker</Th>
                      <Th>Nedlasting</Th>
                      <Th>Gjest</Th>
                      <Th>Nedlastet</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {bySkill.map((s) => (
                      <tr key={s.skill} className="text-foreground">
                        <Td className="font-medium">{skillLabel(s.skill)}</Td>
                        <Td>{s.total}</Td>
                        <Td>{s.abonnent}</Td>
                        <Td>{s.engangsbruker}</Td>
                        <Td>{s.nedlasting}</Td>
                        <Td>{s.gjest}</Td>
                        <Td>{s.downloaded}</Td>
                        <Td>
                          <button
                            onClick={() => setSkill(s.skill)}
                            className="text-xs text-primary hover:underline"
                          >
                            Filtrer
                          </button>
                        </Td>
                      </tr>
                    ))}
                    {!bySkill.length && (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-6 text-center text-muted-foreground"
                        >
                          Ingen data.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Filters */}
            <section className="mt-10">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <h2 className="text-lg font-semibold text-foreground">
                  Brukere ({filtered.length})
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={skill}
                    onChange={(e) => setSkill(e.target.value)}
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                  >
                    <option value="alle">Alle skills</option>
                    {bySkill.map((s) => (
                      <option key={s.skill} value={s.skill}>
                        {skillLabel(s.skill)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={segment}
                    onChange={(e) => setSegment(e.target.value as Segment)}
                    className="h-9 rounded-md border border-border bg-card px-2 text-sm"
                  >
                    <option value="alle">Alle segmenter</option>
                    {(
                      [
                        "abonnent",
                        "engangsbruker",
                        "nedlasting",
                        "gjest",
                      ] as const
                    ).map((s) => (
                      <option key={s} value={s}>
                        {SEGMENT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Søk e-post eller navn"
                    className="h-9 rounded-md border border-border bg-card px-3 text-sm w-56"
                  />
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-card">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <Th>Registrert</Th>
                      <Th>Navn</Th>
                      <Th>E-post</Th>
                      <Th>Rolle</Th>
                      <Th>Skill</Th>
                      <Th>Segment</Th>
                      <Th>Konto</Th>
                      <Th>Nyhetsbrev</Th>
                      <Th>Nedlastet</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filtered.map((r) => (
                      <tr key={r.id} className="text-foreground">
                        <Td>
                          {new Date(r.created_at).toLocaleString("no-NO")}
                        </Td>
                        <Td>{r.first_name || "—"}</Td>
                        <Td className="font-mono text-xs">{r.email}</Td>
                        <Td>{r.role || "—"}</Td>
                        <Td className="text-xs">{skillLabel(r.source)}</Td>
                        <Td>
                          <SegmentBadge segment={r.segment} />
                        </Td>
                        <Td className="text-xs">
                          {r.has_account ? (
                            <span className="text-emerald-600">Ja</span>
                          ) : (
                            <span className="text-muted-foreground">Nei</span>
                          )}
                        </Td>
                        <Td className="text-xs">
                          {r.consent_marketing ? "Ja" : "Nei"}
                        </Td>
                        <Td className="text-xs">
                          {r.downloaded_at
                            ? new Date(r.downloaded_at).toLocaleDateString(
                                "no-NO"
                              )
                            : "—"}
                        </Td>
                      </tr>
                    ))}
                    {!filtered.length && (
                      <tr>
                        <td
                          colSpan={9}
                          className="p-8 text-center text-muted-foreground"
                        >
                          Ingen brukere matcher filteret.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

function SegmentCard({
  label,
  count,
  description,
  active,
  onClick,
}: {
  label: string;
  count: number;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-4 transition ${
        active
          ? "border-primary bg-primary/5"
          : "border-border bg-card hover:bg-accent"
      }`}
    >
      <div className="text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{count}</div>
      <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
        {description}
      </div>
    </button>
  );
}

function SegmentBadge({
  segment,
}: {
  segment: AdminDashboardRow["segment"];
}) {
  const cls: Record<AdminDashboardRow["segment"], string> = {
    abonnent: "bg-emerald-500/15 text-emerald-700",
    engangsbruker: "bg-blue-500/15 text-blue-700",
    nedlasting: "bg-amber-500/15 text-amber-700",
    gjest: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls[segment]}`}
    >
      {SEGMENT_LABELS[segment]}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
      {children}
    </th>
  );
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
