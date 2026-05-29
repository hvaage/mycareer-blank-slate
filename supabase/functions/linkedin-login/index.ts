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
    const configured = Deno.env.get("LINKEDIN_REDIRECT_URI")?.trim();
    const redirectUri = configured ?? fromClient;
    if (!code || !redirectUri) return json({ error: "Mangler code eller redirect_uri" }, 400);
    if (configured && fromClient && fromClient !== configured) {
      return json({ error: "redirect_uri matcher ikke LINKEDIN_REDIRECT_URI" }, 400);
    }

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
    const userInfoRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userInfoRes.ok) {
      return json({ error: "Kunne ikke hente LinkedIn-profil" }, 502);
    }

    const userInfo = await userInfoRes.json();
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

    // Update profile with LinkedIn data
    await admin.from("profiles").update({
      linkedin_connected_at: new Date().toISOString(),
      linkedin_id: userInfo.sub,
      linkedin_picture_url: userInfo.picture,
    }).eq("id", user!.id);

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
