import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

export const getAdminLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const { data: leads, error } = await supabaseAdmin
      .from("leads")
      .select(
        "id, created_at, first_name, email, role, linkedin_url, source, utm_source, utm_medium, utm_campaign, status, email_sent_at, downloaded_at, connect_clicked_at, follow_clicked_at, consent_marketing"
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    type LeadRow = NonNullable<typeof leads>[number];
    const rows: LeadRow[] = leads ?? [];
    const counts = {
      total: rows.length,
      emailed: rows.filter((l: LeadRow) => l.email_sent_at).length,
      downloaded: rows.filter((l: LeadRow) => l.downloaded_at).length,
      connected: rows.filter(
        (l: LeadRow) => l.connect_clicked_at || l.follow_clicked_at
      ).length,
      marketingOptIn: rows.filter((l: LeadRow) => l.consent_marketing).length,
    };

    return { leads: rows, counts };
  });

export type AdminDashboardRow = {
  id: string;
  created_at: string;
  first_name: string;
  email: string;
  role: string | null;
  source: string;
  consent_marketing: boolean;
  downloaded_at: string | null;
  email_sent_at: string | null;
  has_account: boolean;
  account_created_at: string | null;
  last_sign_in_at: string | null;
  segment: "abonnent" | "engangsbruker" | "nedlasting" | "gjest";
};

export const getAdminDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context as { userId: string };
    await assertAdmin(userId);

    const { data: leads, error } = await supabaseAdmin
      .from("leads")
      .select(
        "id, created_at, first_name, email, role, source, consent_marketing, downloaded_at, email_sent_at"
      )
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    // Pull auth users to determine which leads have a registered account
    const accountByEmail = new Map<
      string,
      { created_at: string; last_sign_in_at: string | null }
    >();
    try {
      let page = 1;
      // Cap to a few pages to avoid runaway loops
      while (page <= 10) {
        const { data, error: authErr } =
          await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        if (authErr) break;
        for (const u of data.users) {
          if (u.email) {
            accountByEmail.set(u.email.toLowerCase(), {
              created_at: u.created_at,
              last_sign_in_at: u.last_sign_in_at ?? null,
            });
          }
        }
        if (data.users.length < 200) break;
        page++;
      }
    } catch (e) {
      console.warn("[getAdminDashboard] listUsers failed", (e as Error).message);
    }

    const rows: AdminDashboardRow[] = (leads ?? []).map((l) => {
      const acct = accountByEmail.get(l.email.toLowerCase()) ?? null;
      const has_account = !!acct;
      let segment: AdminDashboardRow["segment"];
      if (has_account && l.consent_marketing) segment = "abonnent";
      else if (has_account) segment = "engangsbruker";
      else if (l.downloaded_at) segment = "nedlasting";
      else segment = "gjest";

      return {
        id: l.id,
        created_at: l.created_at,
        first_name: l.first_name,
        email: l.email,
        role: l.role,
        source: l.source,
        consent_marketing: l.consent_marketing,
        downloaded_at: l.downloaded_at,
        email_sent_at: l.email_sent_at,
        has_account,
        account_created_at: acct?.created_at ?? null,
        last_sign_in_at: acct?.last_sign_in_at ?? null,
        segment,
      };
    });

    // Account-only users (signed up directly, never registered a lead)
    const leadEmails = new Set(rows.map((r) => r.email.toLowerCase()));
    const accountOnly: AdminDashboardRow[] = [];
    for (const [email, acct] of accountByEmail.entries()) {
      if (!leadEmails.has(email)) {
        accountOnly.push({
          id: `auth:${email}`,
          created_at: acct.created_at,
          first_name: "",
          email,
          role: null,
          source: "direct-signup",
          consent_marketing: false,
          downloaded_at: null,
          email_sent_at: null,
          has_account: true,
          account_created_at: acct.created_at,
          last_sign_in_at: acct.last_sign_in_at,
          segment: "engangsbruker",
        });
      }
    }

    const allRows = [...rows, ...accountOnly].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1
    );

    const totals = {
      total: allRows.length,
      abonnent: allRows.filter((r) => r.segment === "abonnent").length,
      engangsbruker: allRows.filter((r) => r.segment === "engangsbruker").length,
      nedlasting: allRows.filter((r) => r.segment === "nedlasting").length,
      gjest: allRows.filter((r) => r.segment === "gjest").length,
      accounts: allRows.filter((r) => r.has_account).length,
    };

    // Per-skill (source) breakdown
    const bySkillMap = new Map<
      string,
      {
        skill: string;
        total: number;
        abonnent: number;
        engangsbruker: number;
        nedlasting: number;
        gjest: number;
        downloaded: number;
      }
    >();
    for (const r of allRows) {
      const key = r.source || "ukjent";
      const cur =
        bySkillMap.get(key) ?? {
          skill: key,
          total: 0,
          abonnent: 0,
          engangsbruker: 0,
          nedlasting: 0,
          gjest: 0,
          downloaded: 0,
        };
      cur.total++;
      cur[r.segment]++;
      if (r.downloaded_at) cur.downloaded++;
      bySkillMap.set(key, cur);
    }
    const bySkill = Array.from(bySkillMap.values()).sort(
      (a, b) => b.total - a.total
    );

    return { rows: allRows, totals, bySkill };
  });
