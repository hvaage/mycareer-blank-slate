import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SKILL_BASE64, SKILL_FILENAME } from "@/server/skill-bundle";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export const Route = createFileRoute("/api/public/selskapsanalyse/download")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";

        if (!UUID_RE.test(token)) {
          return new Response("Ugyldig eller manglende token.", {
            status: 400,
          });
        }

        const { data: lead, error } = await supabaseAdmin
          .from("leads")
          .select("id, connect_clicked_at, follow_clicked_at")
          .eq("access_token", token)
          .maybeSingle();

        if (error || !lead) {
          return new Response("Token er ikke gyldig.", { status: 404 });
        }

        if (!lead.connect_clicked_at && !lead.follow_clicked_at) {
          return new Response(
            "Du må koble til Henrik eller følge Karrierenmin.no på LinkedIn først.",
            { status: 403 }
          );
        }

        // Record download (fire-and-forget — don't block response on logging)
        const now = new Date().toISOString();
        try {
          await supabaseAdmin
            .from("leads")
            .update({ downloaded_at: now })
            .eq("id", lead.id);
          await supabaseAdmin.from("lead_events").insert({
            lead_id: lead.id,
            event_type: "download",
            event_meta: { via: "server_route" },
          });
        } catch (e) {
          console.warn("[skill-download] log failed", (e as Error).message);
        }

        const bytes = decodeBase64ToBytes(SKILL_BASE64);
        return new Response(bytes.buffer as ArrayBuffer, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${SKILL_FILENAME}"`,
            "Content-Length": String(bytes.byteLength),
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
