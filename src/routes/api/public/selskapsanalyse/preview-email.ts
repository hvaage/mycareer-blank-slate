import * as React from "react";
import { render } from "@react-email/components";
import { createFileRoute } from "@tanstack/react-router";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { TEST_MODE_KEY } from "@/lib/selskapsanalyse-site";

// Test-mode-only preview of the bekreftelse email.
// Gated by the shared TEST_MODE_KEY — kjent kun for de som har lenken.
export const Route = createFileRoute(
  "/api/public/selskapsanalyse/preview-email"
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        if (key !== TEST_MODE_KEY) {
          return new Response("Not found", { status: 404 });
        }

        const entry = TEMPLATES["selskapsanalyse-bekreftelse"];
        if (!entry) {
          return new Response("Template not found", { status: 500 });
        }

        const token =
          url.searchParams.get("token") ||
          "00000000-0000-0000-0000-000000000000";
        const firstName = url.searchParams.get("firstName") || "Test";

        try {
          const html = await render(
            React.createElement(entry.component, { firstName, token })
          );
          return new Response(html, {
            status: 200,
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
              "X-Robots-Tag": "noindex",
            },
          });
        } catch (err) {
          return new Response(
            `Render failed: ${err instanceof Error ? err.message : String(err)}`,
            { status: 500 }
          );
        }
      },
    },
  },
});
