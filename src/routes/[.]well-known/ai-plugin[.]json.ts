// GET /.well-known/ai-plugin.json — pakkemetadata for privat ChatGPT-kobling.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/.well-known/ai-plugin.json")({
  server: {
    handlers: {
      GET: async () => {
        const { connectorManifestResponse } =
          await import("@/lib/ai-integrations/connector-manifest.server");
        return connectorManifestResponse();
      },
    },
  },
});
