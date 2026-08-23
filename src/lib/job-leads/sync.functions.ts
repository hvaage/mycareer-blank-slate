import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ingestParsedEmail } from "@/lib/job-leads/ingest";

export const syncEmailConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }) => {
    const { connectionId } = (data ?? {}) as { connectionId?: string };
    if (!connectionId) {
      throw new Error("connectionId is required");
    }

    const { data: conn } = await context.supabase
      .from("email_connections")
      .select("*")
      .eq("id", connectionId)
      .eq("user_id", context.userId)
      .single();

    if (!conn) {
      throw new Error("Email connection not found");
    }
    if (conn.provider !== "google" && conn.provider !== "microsoft") {
      throw new Error("Unsupported provider for mailbox sync");
    }
    if (!conn.access_token) {
      throw new Error("Missing access token; re-authenticate the connection");
    }

    // Server-only import: providers touch tokens and Node crypto imports.
    const { getMailboxProvider } = await import("@/lib/job-leads/providers/index.server");
    const provider = getMailboxProvider(conn.provider);

    const result = await provider.sync({
      accessToken: conn.access_token,
      refreshToken: conn.refresh_token,
      emailAddress: conn.email_address,
      lastSyncedInternalDate: conn.last_synced_internal_date
        ? new Date(conn.last_synced_internal_date).toISOString()
        : null,
    });

    let accepted = 0;
    let skipped = 0;
    for (const msg of result.messages) {
      const { lead, error } = await ingestParsedEmail({
        supabase: context.supabase,
        userId: context.userId,
        sourceSystem: conn.provider === "google" ? "gmail" : "outlook",
        sourceEmailFrom: msg.from,
        sourceEmailTo: msg.to,
        subject: msg.subject,
        textBody: msg.text,
        htmlBody: msg.html,
        receivedAt: msg.providerInternalDate,
        providerMessageId: msg.providerMessageId,
      });
      if (error) {
        console.warn("[syncEmailConnection] ingest failed", error);
        skipped++;
        continue;
      }
      if (lead) accepted++;
      else skipped++;
    }

    const lastSync = result.nextInternalDate ?? new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      last_sync_at: new Date().toISOString(),
      last_synced_internal_date: new Date(lastSync).getTime(),
      last_error: null,
    };
    if (result.tokenRefreshed && result.newAccessToken) {
      updatePayload.access_token = result.newAccessToken;
      if (result.newTokenExpiresAt) {
        updatePayload.token_expires_at = result.newTokenExpiresAt;
      }
    }

    const { error: updateErr } = await context.supabase
      .from("email_connections")
      .update(updatePayload)
      .eq("id", connectionId)
      .eq("user_id", context.userId);

    if (updateErr) {
      console.error("[syncEmailConnection] failed to update connection", updateErr);
    }

    return { accepted, skipped, nextInternalDate: result.nextInternalDate };
  });
