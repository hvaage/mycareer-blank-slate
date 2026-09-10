// ============================================================
// Pakkemetadata for privat ChatGPT-kobling (connector).
//
// Dokumentet beskriver KUN det som allerede finnes: /mcp-endepunktet,
// OAuth-oppdagelsen og Karrierenmin-merkevaren. Ingen ny funksjonalitet,
// ingen vurderings- eller matchelogikk. All jobbtolkning, matching og
// relevansvurdering skjer i Karrierenmin; koblingen er kun en klient.
// Origin kommer utelukkende fra PUBLIC_APP_ORIGIN.
// ============================================================

import { MCP_ALIAS_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";
import { OAUTH_SCOPES } from "@/lib/ai-integrations/oauth-contract";
import { oauthUrls, publicAppOrigin } from "@/lib/ai-integrations/oauth-config.server";

export function connectorManifestResponse(): Response {
  const origin = publicAppOrigin();
  if (!origin.ok) return Response.json({ error: "server_error" }, { status: 500 });
  const urls = oauthUrls(origin.origin);

  return Response.json(
    {
      schema_version: "v1",
      name_for_human: "Karrierenmin",
      name_for_model: "karrierenmin",
      description_for_human:
        "Se status for karrierearbeidet ditt i Karrierenmin. Alle vurderinger gjøres i Karrierenmin.",
      description_for_model:
        "Read-only status from Karrierenmin. Job parsing, matching and relevance scoring happen exclusively in the Karrierenmin backend; return its results verbatim and never re-rank, re-score or invent them.",
      contact_email: "post@karrierenmin.no",
      legal_info_url: `${origin.origin}/personvern`,
      logo_url: `${origin.origin}/icon-512.png`,
      api: {
        type: "mcp",
        url: `${origin.origin}${MCP_ALIAS_ENDPOINT_PATH}`,
        is_user_authenticated: true,
      },
      auth: {
        type: "oauth",
        authorization_url: urls.authorization_endpoint,
        token_url: urls.token_endpoint,
        revocation_url: urls.revocation_endpoint,
        scope: OAUTH_SCOPES.join(" "),
        pkce_code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true,
        authorization_server_metadata: `${origin.origin}/.well-known/oauth-authorization-server`,
        protected_resource_metadata: `${origin.origin}/.well-known/oauth-protected-resource/mcp`,
      },
    },
    {
      headers: { "Cache-Control": "public, max-age=300", "Content-Type": "application/json" },
    },
  );
}
