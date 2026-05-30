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

  try {
    const body = await req.json().catch(() => ({}));
    const code = body.code as string | undefined;
    const fromClient = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : "";
    if (!code || !fromClient) return json({ error: "Mangler code eller redirect_uri" }, 400);

    const allowlistRaw = Deno.env.get("LINKEDIN_REDIRECT_URI_ALLOWLIST") ?? "";
    const allowlist = allowlistRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const fallback = Deno.env.get("LINKEDIN_REDIRECT_URI")?.trim();
    if (fallback && !allowlist.includes(fallback)) allowlist.push(fallback);

    if (allowlist.length === 0) {
      return json({ error: "Allowlist ikke konfigurert (LINKEDIN_REDIRECT_URI_ALLOWLIST)" }, 500);
    }
    if (!allowlist.includes(fromClient)) {
      return json({ error: "redirect_uri ikke i allowlist", redirect_uri: fromClient }, 400);
    }
    const redirectUri = fromClient;

    // Exchange authorization code for access token
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

    // Fetch user info from LinkedIn
    // Fetch userinfo + /v2/me in parallel for full profile data
    const [userInfoRes, meRes] = await Promise.all([
      fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
      fetch("https://api.linkedin.com/v2/me?projection=(id,vanityName,localizedHeadline)", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    ]);

    if (!userInfoRes.ok) {
      return json({ error: "Kunne ikke hente LinkedIn-profil" }, 502);
    }

    const userInfo = await userInfoRes.json();
    const me = meRes.ok ? await meRes.json() : {};
    const email = userInfo.email;
    const name = userInfo.name;

    if (!email) {
      return json({ error: "LinkedIn ga ingen e-postadresse" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Find or create user
    const { data: existing } = await admin.auth.admin.listUsers();
    let user = existing?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    if (!user) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { display_name: name, linkedin_id: userInfo.sub },
      });
      if (createErr) {
        console.error("Create user failed:", createErr);
        return json({ error: "Kunne ikke opprette bruker" }, 500);
      }
      user = created.user;
    }

    // Generate magic link for sign-in
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    if (linkErr || !linkData) {
      console.error("Magic link failed:", linkErr);
      return json({ error: "Kunne ikke generere innloggingslink" }, 500);
    }

    // Read existing profile so we don't overwrite user-edited fields
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("full_name, given_name, current_role_title")
      .eq("id", user!.id)
      .maybeSingle();

    const update: Record<string, unknown> = {
      linkedin_connected_at: new Date().toISOString(),
    };
    if (userInfo.sub) update.linkedin_id = userInfo.sub;
    else if (me.id) update.linkedin_id = String(me.id);
    if (userInfo.picture) update.linkedin_picture_url = userInfo.picture;
    if (typeof userInfo.email_verified === "boolean") {
      update.linkedin_email_verified = userInfo.email_verified;
    }
    if (userInfo.locale) {
      const loc = typeof userInfo.locale === "string"
        ? userInfo.locale
        : [userInfo.locale?.language, userInfo.locale?.country].filter(Boolean).join("_");
      if (loc) update.linkedin_locale = loc;
    }
    if (me.localizedHeadline) update.linkedin_headline = me.localizedHeadline;
    if (me.vanityName) update.linkedin_vanity_url = `https://linkedin.com/in/${me.vanityName}`;

    // Auto-fill only when profile field is empty — never overwrite user edits
    if (!existingProfile?.full_name && userInfo.name) update.full_name = userInfo.name;
    if (!existingProfile?.given_name && userInfo.given_name) update.given_name = userInfo.given_name;
    if (!existingProfile?.current_role_title && me.localizedHeadline) {
      update.current_role_title = me.localizedHeadline;
    }

    const { error: updateError } = await admin
      .from("profiles")
      .update(update)
      .eq("id", user!.id);
    if (updateError) {
      console.error("Failed to update profile:", updateError);
    }

    return json({
      action_link: linkData.properties?.action_link,
      hashed_token: linkData.properties?.hashed_token,
      email,
    });
  } catch (e) {
    console.error("linkedin-login error:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
