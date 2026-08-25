import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_AGE_DAYS = 60;
const MATCH_LIMIT = 200;
const SCORE_LIMIT = 40;

// Per-bruker henting mot speilet. Ingen eksterne API-kall og ingen skriving til
// source_postings / canonical_opportunities — speil-jobbene forblir eneste skriver
// mot identitetslaget. Denne funksjonen kobler kun ferske, aktive muligheter
// (Careerjet + NAV, publisert siste 60 dager) til brukeren og KI-scorer nye rader
// gjennom den kanoniske V2-screeningen.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Ikke innlogget" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const user = userData?.user;
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Ikke innlogget" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* tomt kall er greit */ }
  const requested = Array.isArray(body.sources) ? (body.sources as string[]) : [];
  const filtered = requested.filter((s) => s === "careerjet" || s === "nav");
  const sources = filtered.length > 0 ? filtered : ["careerjet", "nav"];

  // 1) Match mot speilet (SECURITY DEFINER, scoped til auth.uid())
  const { data: matchResult, error: matchErr } = await userClient.rpc(
    "match_user_opportunities_from_mirror",
    { p_sources: sources, p_max_age_days: MAX_AGE_DAYS, p_limit: MATCH_LIMIT },
  );

  if (matchErr) {
    console.error("[fetch-careerjet] match_user_opportunities_from_mirror", matchErr);
    return new Response(JSON.stringify({ error: matchErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const result = (matchResult ?? {}) as Record<string, unknown>;
  const matched = Number(result.matched ?? 0);

  // 2) KI-scoring via den kanoniske V2-screeningen (score-pending-opportunities).
  // Den skriver screening_status + match_score_version, som er det Jobb-leads
  // krever for å vise en vurdering. Maks SCORE_LIMIT per klikk, batcher på 20.
  let aiScored = 0;
  try {
    const batches = Math.max(1, Math.ceil(SCORE_LIMIT / 20));
    for (let i = 0; i < batches; i++) {
      const res = await fetch(`${supabaseUrl}/functions/v1/score-pending-opportunities`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          apikey: anonKey,
          "Content-Type": "application/json",
        },
        // "stale" fanger både nye rader og rader som mangler gjeldende
        // match_score_version (f.eks. gamle V1-score).
        body: JSON.stringify({ source: "all", mode: "stale", limit: 20 }),
      });
      if (!res.ok) {
        console.error(
          "[fetch-careerjet] score-pending-opportunities",
          res.status,
          await res.text(),
        );
        break;
      }
      const scoreBody = await res.json() as Record<string, unknown>;
      const evaluated = Number(scoreBody.evaluated ?? 0);
      aiScored += evaluated;
      if (evaluated < 20) break;
    }
  } catch (e) {
    console.error("[fetch-careerjet] AI scoring error:", e);
  }

  await serviceClient
    .from("profiles")
    .update({ listings_last_fetched_at: new Date().toISOString() })
    .eq("id", user.id);

  return new Response(
    JSON.stringify({
      ok: result.ok !== false,
      reason: result.reason ?? null,
      mode: "mirror_lookup",
      sources,
      max_age_days: MAX_AGE_DAYS,
      matched,
      new_lead_links: matched,
      ai_scored: aiScored,
      keywords: result.keywords ?? [],
      locations: result.locations ?? [],
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
