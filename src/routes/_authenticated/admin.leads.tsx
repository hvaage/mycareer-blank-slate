import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Header } from "@/components/landing/Header";
import { Footer } from "@/components/landing/Footer";
import { getAdminLeads } from "@/lib/admin.functions";
import { ExternalUrlLink } from "@/components/external-url-link";

export const Route = createFileRoute("/_authenticated/admin/leads")({
  head: () => ({
    meta: [
      { title: "Admin · Leads — Karrierenmin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AdminLeadsPage,
});

type LeadRow = {
  id: string;
  created_at: string;
  first_name: string;
  email: string;
  role: string | null;
  linkedin_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  status: string;
  email_sent_at: string | null;
  downloaded_at: string | null;
  connect_clicked_at: string | null;
  follow_clicked_at: string | null;
  consent_marketing: boolean;
};

function AdminLeadsPage() {
  const fetchLeads = useServerFn(getAdminLeads);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-leads"],
    queryFn: () => fetchLeads(),
  });

  const leads = (data?.leads ?? []) as LeadRow[];
  const counts = data?.counts ?? {
    total: 0,
    emailed: 0,
    downloaded: 0,
    connected: 0,
    marketingOptIn: 0,
  };

  function exportCsv() {
    const headers = [
      "created_at",
      "first_name",
      "email",
      "role",
      "linkedin_url",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "status",
      "email_sent_at",
      "downloaded_at",
      "connect_clicked_at",
      "follow_clicked_at",
      "consent_marketing",
    ];
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers.join(",")]
      .concat(
        leads.map((l) =>
          headers
            .map((h) => escape((l as Record<string, unknown>)[h]))
            .join(",")
        )
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `karrierenmin-leads-${new Date()
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
            <h1 className="text-2xl font-bold text-foreground">Leads</h1>
            <p className="text-sm text-muted-foreground">
              {leads.length} av siste 500 vist
            </p>
          </div>
          <button
            onClick={exportCsv}
            disabled={!leads.length}
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Eksporter CSV
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            ["Totalt", counts.total],
            ["E-postet", counts.emailed],
            ["Lastet ned", counts.downloaded],
            ["Klikket LinkedIn", counts.connected],
            ["Nyhetsbrev", counts.marketingOptIn],
          ].map(([label, n]) => (
            <div
              key={label as string}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {label}
              </div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {n}
              </div>
            </div>
          ))}
        </div>

        {isLoading && (
          <p className="mt-8 text-muted-foreground">Laster…</p>
        )}
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

        {!isLoading && !errMessage && (
          <div className="mt-6 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <Th>Opprettet</Th>
                  <Th>Navn</Th>
                  <Th>E-post</Th>
                  <Th>Rolle</Th>
                  <Th>LinkedIn</Th>
                  <Th>UTM</Th>
                  <Th>Status</Th>
                  <Th>Hendelser</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => (
                  <tr key={l.id} className="text-foreground">
                    <Td>{new Date(l.created_at).toLocaleString("no-NO")}</Td>
                    <Td>{l.first_name}</Td>
                    <Td className="font-mono text-xs">{l.email}</Td>
                    <Td>{l.role || "—"}</Td>
                    <Td className="max-w-[200px] truncate text-xs">
                      {l.linkedin_url ? (
                        <ExternalUrlLink
                          href={l.linkedin_url}
                          className="text-primary no-underline hover:underline"
                          showIcon={false}
                        >
                          {l.linkedin_url.replace(
                            /^https?:\/\/(www\.)?linkedin\.com\/in\//,
                            ""
                          )}
                        </ExternalUrlLink>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {[l.utm_source, l.utm_medium, l.utm_campaign]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </Td>
                    <Td>
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs">
                        {l.status}
                      </span>
                    </Td>
                    <Td className="text-xs">
                      {l.email_sent_at && <Badge>e-post</Badge>}
                      {l.downloaded_at && <Badge>nedlast</Badge>}
                      {l.connect_clicked_at && <Badge>connect</Badge>}
                      {l.follow_clicked_at && <Badge>follow</Badge>}
                      {l.consent_marketing && <Badge>opt-in</Badge>}
                    </Td>
                  </tr>
                ))}
                {!leads.length && (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-8 text-center text-muted-foreground"
                    >
                      Ingen leads enda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
      <Footer />
    </div>
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
function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1 inline-block rounded bg-primary/15 text-primary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
      {children}
    </span>
  );
}
