const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function parseAllowlist(): string[] {
  const raw = Deno.env.get("LINKEDIN_REDIRECT_URI_ALLOWLIST") ?? "";
  const fromList = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const fallback = Deno.env.get("LINKEDIN_REDIRECT_URI")?.trim();
  if (fallback && !fromList.includes(fallback)) fromList.push(fallback);
  return fromList;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
    const state = typeof body.state === "string" ? body.state.trim() : "";

    if (!redirectUri || !state) {
      return json({ error: "Mangler redirect_uri eller state" }, 400);
    }

    const allowlist = parseAllowlist();
    if (allowlist.length === 0) {
      return json({ error: "Allowlist ikke konfigurert (LINKEDIN_REDIRECT_URI_ALLOWLIST)" }, 500);
    }
    if (!allowlist.includes(redirectUri)) {
      return json({ error: "redirect_uri ikke i allowlist", redirect_uri: redirectUri }, 400);
    }

    const clientId = Deno.env.get("LINKEDIN_CLIENT_ID");
    if (!clientId) return json({ error: "LINKEDIN_CLIENT_ID ikke konfigurert" }, 500);

    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: "openid profile email",
    });

    return json({
      authorization_url: `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`,
      redirect_uri: redirectUri,
    });
  } catch (e) {
    console.error("linkedin-start error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
