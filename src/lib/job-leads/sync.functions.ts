import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseEmail } from "@/lib/job-leads/parse";
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

    // Ensure an email_job_sources row exists for this user + connection.
    let sourceId: string;
    const { data: existingSource } = await context.supabase
      .from("email_job_sources")
      .select("id")
      .eq("user_id", context.userId)
      .eq("email_connection_id", connectionId)
      .maybeSingle();

    if (existingSource?.id) {
      sourceId = existingSource.id;
    } else {
      const { data: inserted, error: insertErr } = await context.supabase
        .from("email_job_sources")
        .insert({
          user_id: context.userId,
          email_connection_id: connectionId,
          source_system: "other",
          intake_mode: "mailbox",
          status: "active",
          is_forwarding_address: false,
        })
        .select("id")
        .single();
      if (insertErr || !inserted) {
        throw new Error(insertErr?.message ?? "Failed to create email job source");
      }
      sourceId = inserted.id;
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
      const parseResult = parseEmail({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        receivedAt: msg.providerInternalDate,
      });
      if (!parseResult.ok) {
        skipped++;
        continue;
      }

      const sourceSystem =
        conn.provider === "google" ? "gmail" : conn.provider === "microsoft" ? "outlook" : "other";

      try {
        const ingestResult = await ingestParsedEmail({
          userId: context.userId,
          emailJobSourceId: sourceId,
          sourceSystem,
          intakeMode: "mailbox",
          emailConnectionId: connectionId,
          providerMessageId: msg.providerMessageId,
          fromAddress: msg.from,
          toAddress: msg.to,
          subject: msg.subject,
          receivedAt: msg.providerInternalDate,
          rawText: msg.text,
          rawHtml: msg.html,
          sizeBytes: msg.sizeEstimate,
          parsed: parseResult.lead,
          parseConfidence: parseResult.lead.confidence,
        });
        accepted += ingestResult.leadsCreated;
        skipped += ingestResult.leadsDeduped;
      } catch (err) {
        console.warn("[syncEmailConnection] ingest failed", err);
        skipped++;
      }
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
