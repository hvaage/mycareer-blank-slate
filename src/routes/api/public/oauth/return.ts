// POST /api/public/oauth/return
//
// Løser opp en signert returtilstand etter innlogging. Ruten returnerer
// BARE en relativ sti som ligger på serverens egen allowliste, slik at
// en manipulert verdi aldri kan bli en åpen videresending.

import { createFileRoute } from "@tanstack/react-router";
import { openReturnState } from "@/lib/ai-integrations/oauth-state.server";

const noStore = { "Cache-Control": "no-store", Pragma: "no-cache" };

export const Route = createFileRoute("/api/public/oauth/return")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { state?: unknown };
        try {
          body = (await request.json()) as { state?: unknown };
        } catch {
          return Response.json({ ok: false }, { status: 400, headers: noStore });
        }
        const path = await openReturnState(body.state);
        if (!path) return Response.json({ ok: false }, { status: 400, headers: noStore });
        return Response.json({ ok: true, path }, { headers: noStore });
      },
    },
  },
});
