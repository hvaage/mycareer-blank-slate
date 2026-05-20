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
        "id, created_at, first_name, email, role, linkedin_url, utm_source, utm_medium, utm_campaign, status, email_sent_at, downloaded_at, connect_clicked_at, follow_clicked_at, consent_marketing"
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const rows = leads ?? [];
    const counts = {
      total: rows.length,
      emailed: rows.filter((l) => l.email_sent_at).length,
      downloaded: rows.filter((l) => l.downloaded_at).length,
      connected: rows.filter((l) => l.connect_clicked_at || l.follow_clicked_at).length,
      marketingOptIn: rows.filter((l) => l.consent_marketing).length,
    };

    return { leads: rows, counts };
  });
