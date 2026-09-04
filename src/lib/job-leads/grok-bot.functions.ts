/**
 * Autentiserte serverfunksjoner for Grok Bot-jobbimport.
 *
 * Innkommende e-post går gjennom eksisterende POST /api/public/inbound/job-email
 * + ingestParsedEmail. Ingen ny offentlig ingest-API.
 *
 * GROK_TEMPLATE_URL (server-only): URL til Grok Bot-malen. Mangler den, brukes
 * DEFAULT_GROK_TEMPLATE_URL. Sett aldri VITE_-prefiks — nøkler og mal-URL
 * skal ikke inn i frontend-bundle.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateInboundAliasToken } from "@/lib/job-leads/ingest";
import {
  deriveGrokSetupStatus,
  formatInboundAlias,
  generateGrokSetupCode,
  GROK_SETUP_TTL_MS,
  inboundMatchesAlias,
  isSetupSessionOpen,
  resolveGrokTemplateUrl,
  type GrokSetupStatus,
  type GrokSetupStatusResult,
} from "@/lib/job-leads/grok-bot";

type AuthContext = {
  supabase: {
    from: (table: string) => any;
  };
  userId: string;
};

type ForwardingSourceRow = {
  id: string;
  inbound_alias_token: string | null;
  is_active: boolean;
  grok_setup_status: string | null;
  verified_at: string | null;
  created_at: string;
};

type SetupSessionRow = {
  id: string;
  setup_code: string;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
};

const FORWARDING_LABEL = "Jobb-videresending";

function grokTemplateUrl(): string {
  return resolveGrokTemplateUrl(process.env["GROK_TEMPLATE_URL"]);
}

async function findForwardingSource(
  supabase: AuthContext["supabase"],
  userId: string,
): Promise<ForwardingSourceRow | null> {
  const { data, error } = await supabase
    .from("email_job_sources")
    .select("id, inbound_alias_token, is_active, grok_setup_status, verified_at, created_at")
    .eq("user_id", userId)
    .eq("intake_mode", "forwarding")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ForwardingSourceRow | null) ?? null;
}

async function persistSourceStatus(
  supabase: AuthContext["supabase"],
  userId: string,
  sourceId: string,
  patch: {
    grok_setup_status?: GrokSetupStatus;
    verified_at?: string | null;
    is_active?: boolean;
    inbound_alias_token?: string;
    last_error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase
    .from("email_job_sources")
    .update(patch)
    .eq("id", sourceId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

async function consumeOpenSessions(
  supabase: AuthContext["supabase"],
  userId: string,
): Promise<void> {
  const { error } = await supabase
    .from("grok_bot_setup_sessions")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("consumed_at", null);
  if (error) throw new Error(error.message);
}

async function latestInboundAt(
  supabase: AuthContext["supabase"],
  userId: string,
  sourceId: string,
  token: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("imported_job_emails")
    .select("received_at, created_at, to_address")
    .eq("user_id", userId)
    .eq("email_job_source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  const match = (data ?? []).find((row: { to_address?: string | null }) =>
    inboundMatchesAlias(row.to_address, token),
  ) as { received_at?: string | null; created_at?: string | null } | undefined;
  return match?.received_at ?? match?.created_at ?? null;
}

async function getOpenSetupSession(
  supabase: AuthContext["supabase"],
  userId: string,
): Promise<SetupSessionRow | null> {
  const { data, error } = await supabase
    .from("grok_bot_setup_sessions")
    .select("id, setup_code, expires_at, consumed_at, created_at")
    .eq("user_id", userId)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(error.message);
  const now = new Date();
  return (
    ((data ?? []) as SetupSessionRow[]).find((row) => isSetupSessionOpen(row, now)) ??
    null
  );
}

async function ensureForwardingSource(
  supabase: AuthContext["supabase"],
  userId: string,
): Promise<ForwardingSourceRow> {
  const existing = await findForwardingSource(supabase, userId);
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (!existing.inbound_alias_token) {
      patch.inbound_alias_token = generateInboundAliasToken();
    }
    if (!existing.is_active) {
      patch.is_active = true;
    }
    const nextToken = (patch.inbound_alias_token as string | undefined) ??
      existing.inbound_alias_token;
    const nextActive = patch.is_active === true ? true : existing.is_active;
    const nextStatus = deriveGrokSetupStatus({
      hasAlias: Boolean(nextToken),
      verifiedAt: existing.verified_at,
      isActive: nextActive,
    });
    if (existing.grok_setup_status !== nextStatus) {
      patch.grok_setup_status = nextStatus;
    }
    if (Object.keys(patch).length > 0) {
      await persistSourceStatus(supabase, userId, existing.id, patch);
      return {
        ...existing,
        inbound_alias_token:
          (patch.inbound_alias_token as string | undefined) ??
          existing.inbound_alias_token,
        is_active: nextActive,
        grok_setup_status: nextStatus,
      };
    }
    return existing;
  }

  const token = generateInboundAliasToken();
  const { data, error } = await supabase
    .from("email_job_sources")
    .insert({
      user_id: userId,
      source_system: "other",
      intake_mode: "forwarding",
      label: FORWARDING_LABEL,
      inbound_alias_token: token,
      is_active: true,
      grok_setup_status: "pending_verify",
    })
    .select("id, inbound_alias_token, is_active, grok_setup_status, verified_at, created_at")
    .single();
  if (error || !data) {
    throw new Error(error?.message ?? "Kunne ikke opprette jobb-adresse");
  }
  return data as ForwardingSourceRow;
}

async function maybePromoteFromInbound(
  supabase: AuthContext["supabase"],
  userId: string,
  source: ForwardingSourceRow,
): Promise<{ source: ForwardingSourceRow; lastInboundAt: string | null }> {
  const token = source.inbound_alias_token;
  if (!token) {
    return { source, lastInboundAt: null };
  }
  const lastInboundAt = await latestInboundAt(supabase, userId, source.id, token);

  if (
    lastInboundAt &&
    source.is_active &&
    !source.verified_at
  ) {
    const verifiedAt = new Date().toISOString();
    await persistSourceStatus(supabase, userId, source.id, {
      grok_setup_status: "active",
      verified_at: verifiedAt,
    });
    await consumeOpenSessions(supabase, userId);
    return {
      source: {
        ...source,
        grok_setup_status: "active",
        verified_at: verifiedAt,
      },
      lastInboundAt,
    };
  }

  return { source, lastInboundAt };
}

function toStatusResult(
  source: ForwardingSourceRow | null,
  session: SetupSessionRow | null,
  lastInboundAt: string | null,
): GrokSetupStatusResult {
  const token = source?.inbound_alias_token ?? null;
  const isActive = source?.is_active ?? false;
  const status = deriveGrokSetupStatus({
    hasAlias: Boolean(token),
    verifiedAt: source?.verified_at ?? null,
    isActive,
  });
  const openSession = session && isSetupSessionOpen(session) ? session : null;
  return {
    alias: token ? formatInboundAlias(token) : null,
    token,
    is_active: isActive,
    last_inbound_at: lastInboundAt,
    verified_at: source?.verified_at ?? null,
    status,
    setup_session: openSession
      ? {
          setup_code: openSession.setup_code,
          expires_at: openSession.expires_at,
          grok_template_url: grokTemplateUrl(),
        }
      : null,
  };
}

export const ensureJobInboundAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    alias: string;
    token: string;
    status: GrokSetupStatus;
  }> => {
    const { supabase, userId } = context as AuthContext;
    const source = await ensureForwardingSource(supabase, userId);
    const token = source.inbound_alias_token;
    if (!token) throw new Error("Mangler innkommende alias");
    const status = deriveGrokSetupStatus({
      hasAlias: true,
      verifiedAt: source.verified_at,
      isActive: source.is_active,
    });
    return {
      alias: formatInboundAlias(token),
      token,
      status,
    };
  });

export const createGrokSetupCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    setup_code: string;
    alias: string;
    expires_at: string;
    grok_template_url: string;
  }> => {
    const { supabase, userId } = context as AuthContext;
    const source = await ensureForwardingSource(supabase, userId);
    const token = source.inbound_alias_token;
    if (!token) throw new Error("Mangler innkommende alias");

    await consumeOpenSessions(supabase, userId);

    const expiresAt = new Date(Date.now() + GROK_SETUP_TTL_MS).toISOString();
    let lastError: string | null = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const setupCode = generateGrokSetupCode();
      const { data, error } = await supabase
        .from("grok_bot_setup_sessions")
        .insert({
          user_id: userId,
          setup_code: setupCode,
          expires_at: expiresAt,
        })
        .select("setup_code, expires_at")
        .single();
      if (!error && data) {
        if (source.grok_setup_status === "pending_alias" || !source.grok_setup_status) {
          await persistSourceStatus(supabase, userId, source.id, {
            grok_setup_status: "pending_verify",
          });
        }
        return {
          setup_code: data.setup_code,
          alias: formatInboundAlias(token),
          expires_at: data.expires_at,
          grok_template_url: grokTemplateUrl(),
        };
      }
      const message =
        typeof error?.message === "string" && error.message.trim()
          ? error.message
          : "unknown";
      lastError = message;
      if (!message.toLowerCase().includes("duplicate") &&
        !message.toLowerCase().includes("unique")) {
        throw new Error(message);
      }
    }
    throw new Error(lastError ?? "Kunne ikke lage oppsettkode");
  });

export const getGrokSetupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GrokSetupStatusResult> => {
    const { supabase, userId } = context as AuthContext;
    const source = await findForwardingSource(supabase, userId);
    if (!source) {
      const session = await getOpenSetupSession(supabase, userId);
      return toStatusResult(null, session, null);
    }
    const promoted = await maybePromoteFromInbound(supabase, userId, source);
    const nextSession = promoted.source.verified_at
      ? null
      : await getOpenSetupSession(supabase, userId);
    return toStatusResult(
      promoted.source,
      nextSession,
      promoted.lastInboundAt,
    );
  });

export const confirmGrokTestReceived = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ force: z.boolean().optional() }).parse(data ?? {}),
  )
  .handler(async ({ context, data }): Promise<{
    ok: boolean;
    reason?: "no_inbound" | "no_alias";
    status: GrokSetupStatus;
    last_inbound_at: string | null;
  }> => {
    const { supabase, userId } = context as AuthContext;
    const source = await findForwardingSource(supabase, userId);
    if (!source?.inbound_alias_token) {
      return { ok: false, reason: "no_alias", status: "pending_alias", last_inbound_at: null };
    }
    const lastInboundAt = await latestInboundAt(
      supabase,
      userId,
      source.id,
      source.inbound_alias_token,
    );

    if (!lastInboundAt && !data.force) {
      return {
        ok: false,
        reason: "no_inbound",
        status: deriveGrokSetupStatus({
          hasAlias: true,
          verifiedAt: source.verified_at,
          isActive: source.is_active,
        }),
        last_inbound_at: null,
      };
    }

    const verifiedAt = source.verified_at ?? new Date().toISOString();
    await persistSourceStatus(supabase, userId, source.id, {
      grok_setup_status: "active",
      verified_at: verifiedAt,
      is_active: true,
    });
    await consumeOpenSessions(supabase, userId);
    return {
      ok: true,
      status: "active",
      last_inbound_at: lastInboundAt,
    };
  });

export const deactivateJobInboundAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true; status: GrokSetupStatus }> => {
    const { supabase, userId } = context as AuthContext;
    const source = await findForwardingSource(supabase, userId);
    if (!source) {
      return { ok: true, status: "pending_alias" };
    }
    await persistSourceStatus(supabase, userId, source.id, {
      is_active: false,
      grok_setup_status: deriveGrokSetupStatus({
        hasAlias: Boolean(source.inbound_alias_token),
        verifiedAt: source.verified_at,
        isActive: false,
      }),
    });
    return { ok: true, status: "pending_verify" };
  });

export const rotateJobInboundAlias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    alias: string;
    token: string;
    status: GrokSetupStatus;
  }> => {
    const { supabase, userId } = context as AuthContext;
    const source = await ensureForwardingSource(supabase, userId);
    const token = generateInboundAliasToken();
    await persistSourceStatus(supabase, userId, source.id, {
      inbound_alias_token: token,
      grok_setup_status: "pending_verify",
      verified_at: null,
      is_active: true,
      last_error: null,
    });
    await consumeOpenSessions(supabase, userId);
    return {
      alias: formatInboundAlias(token),
      token,
      status: "pending_verify",
    };
  });
