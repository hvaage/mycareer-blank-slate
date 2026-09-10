// GET /.well-known/oauth-protected-resource/mcp (RFC 9728 §3.1)
//
// Metadata for alias-stien /mcp. Samme autorisasjonsserver, samme scopes
// og samme tilgangsmodell som den kanoniske ressursen; kun `resource`
// oppgir aliasets eksakte URL, slik at klienten binder tokenet til den
// URL-en den faktisk kaller. Origin kommer kun fra PUBLIC_APP_ORIGIN.

import { createFileRoute } from "@tanstack/react-router";
import { MCP_ALIAS_ENDPOINT_PATH } from "@/lib/ai-integrations/mcp-contract";

export const Route = createFileRoute("/.well-known/oauth-protected-resource/mcp")({
  server: {
    handlers: {
      GET: async () => {
        const { protectedResourceMetadataResponse } =
          await import("@/lib/ai-integrations/oauth-resource-metadata.server");
        return protectedResourceMetadataResponse(MCP_ALIAS_ENDPOINT_PATH);
      },
    },
  },
});
