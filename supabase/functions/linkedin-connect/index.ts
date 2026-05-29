import { createClient } from "npm:@supabase/supabase-js@2";

const LINKEDIN_TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const authHeader = req.headers.get("Authorization");
  const { data: { user }, error: authError } = await serviceClient.auth.getUser(
    authHeader?.replace("Bearer ", "") ?? "",
  );
  if (!user || authError) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const code = body.code as string | undefined;
  const fromClient = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
  const configured = Deno.env.get("LINKEDIN_REDIRECT_URI")?.trim();
  const redirectUri = configured ?? fromClient;
  if (!code || !redirectUri) return json({ error: "Mangler code eller redirect_uri" }, 400);
  if (configured && fromClient && fromClient !== configured) {
    return json({ error: "redirect_uri matcher ikke LINKEDIN_REDIRECT_URI" }, 400);
  }

  const tokenRes = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: Deno.env.get("LINKEDIN_CLIENT_ID")!,
      client_secret: Deno.env.get("LINKEDIN_CLIENT_SECRET")!,
    }),
  });

  if (!tokenRes.ok) {
    const detail = await tokenRes.text();
    console.error("LinkedIn token exchange failed:", detail);
    return json({ error: "Token-veksling feilet", detail }, 502);
  }

  const { access_token } = await tokenRes.json();

  const [userInfoRes, meRes] = await Promise.all([
    fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
    fetch("https://api.linkedin.com/v2/me?projection=(id,vanityName,localizedHeadline)", {
      headers: { Authorization: `Bearer ${access_token}` },
    }),
  ]);

  const userInfo = userInfoRes.ok ? await userInfoRes.json() : {};
  const me = meRes.ok ? await meRes.json() : {};

  // Read existing profile so we can fill blank fields without overwriting user edits
  const { data: existing } = await serviceClient
    .from("profiles")
    .select("full_name, given_name, current_role_title")
    .eq("id", user.id)
    .maybeSingle();

  const update: Record<string, unknown> = {
    linkedin_connected_at: new Date().toISOString(),
  };
  if (userInfo.sub) update.linkedin_id = userInfo.sub;
  else if (me.id) update.linkedin_id = String(me.id);
  if (userInfo.picture) update.linkedin_picture_url = userInfo.picture;
  if (typeof userInfo.email_verified === "boolean") update.linkedin_email_verified = userInfo.email_verified;
  if (userInfo.locale) {
    const loc = typeof userInfo.locale === "string"
      ? userInfo.locale
      : [userInfo.locale?.language, userInfo.locale?.country].filter(Boolean).join("_");
    if (loc) update.linkedin_locale = loc;
  }
  if (me.localizedHeadline) update.linkedin_headline = me.localizedHeadline;
  if (me.vanityName) update.linkedin_vanity_url = `https://linkedin.com/in/${me.vanityName}`;

  // Auto-fill blank profile fields from LinkedIn (don't overwrite user-set values)
  if (!existing?.full_name && userInfo.name) update.full_name = userInfo.name;
  if (!existing?.given_name && userInfo.given_name) update.given_name = userInfo.given_name;
  if (!existing?.current_role_title && me.localizedHeadline) update.current_role_title = me.localizedHeadline;

  const { error: updateError } = await serviceClient
    .from("profiles")
    .update(update)
    .eq("id", user.id);

  if (updateError) {
    console.error("Failed to update profile:", updateError);
    return json({ error: "Kunne ikke lagre LinkedIn-data" }, 500);
  }

  return json({ ok: true });
});
