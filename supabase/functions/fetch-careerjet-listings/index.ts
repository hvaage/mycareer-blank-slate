import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MAX_AGE_DAYS = 60;
const MATCH_LIMIT = 200;
const SCORE_LIMIT = 40;

// Per-bruker henting mot speilet. Ingen eksterne API-kall og ingen skriving til
// source_postings / canonical_opportunities — speil-jobbene forblir eneste skriver
// mot identitetslaget. Denne funksjonen kobler kun ferske, aktive muligheter
// (Careerjet + NAV, publisert siste 60 dager) til brukeren og KI-scorer nye rader.
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

  const { data: profile } = await serviceClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

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
  const newIds = Array.isArray(result.new_ids) ? (result.new_ids as string[]) : [];

  // 2) KI-scoring via den kanoniske V2-screeningen (score-pending-opportunities).
  // Den skriver screening_status + match_score_version, som er det Jobb-leads krever
  // for å vise en vurdering. Maks SCORE_LIMIT per klikk, i batcher på 20.
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
        body: JSON.stringify({ source: "all", mode: "pending", limit: 20 }),
      });
      if (!res.ok) {
        console.error(
          "[fetch-careerjet] score-pending-opportunities",
          res.status,
          await res.text(),
        );
        break;
      }
      const body = await res.json() as Record<string, unknown>;
      const evaluated = Number(body.evaluated ?? 0);
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

async function scoreUserOpportunitiesWithAi(
  client: ReturnType<typeof createClient>,
  apiKey: string,
  profile: Record<string, unknown>,
  rows: Array<{
    id: string;
    card_title: string | null;
    card_company: string | null;
    card_location: string | null;
    card_salary: string | null;
    card_display_url: string | null;
  }>,
): Promise<number> {
  const items = rows.map((r, i) => ({
    idx: i,
    row_id: r.id,
    title: r.card_title ?? "",
    company: r.card_company ?? "",
    location: r.card_location ?? "",
    salary: r.card_salary ?? "",
    description: "",
  }));
  if (items.length === 0) return 0;

  const profileSlim = {
    target_roles: (profile as any).target_roles,
    target_seniority: (profile as any).target_seniority,
    target_industries: (profile as any).target_industries,
    target_country: (profile as any).target_country,
    target_region: (profile as any).target_region,
    target_city: (profile as any).target_city,
    work_types: (profile as any).work_types,
    skills: (profile as any).skills,
    languages: (profile as any).languages,
    salary_expectation_min: (profile as any).salary_expectation_min,
    salary_expectation_max: (profile as any).salary_expectation_max,
    salary_currency: (profile as any).salary_currency,
    motivation: (profile as any).motivation,
    strengths: (profile as any).strengths,
    deal_breakers: (profile as any).deal_breakers,
    years_experience: (profile as any).years_experience,
  };

  const prompt = `Du scorer jobbannonser mot en kandidatprofil.

KANDIDATPROFIL:
${JSON.stringify(profileSlim, null, 2)}

ANNONSER (idx, tittel, selskap, sted, lønn):
${JSON.stringify(items, null, 2)}

Returner KUN gyldig JSON (ingen markdown):
{
  "scores": [
    { "idx": <number>, "row_id": "<string>", "ai_score": <0-100>,
      "ai_reasoning": "<1-2 setninger på norsk>",
      "ai_match_highlights": "<kort: hva passer (norsk)>",
      "ai_concerns": "<kort: hva passer dårlig (norsk, kan være tom)>" }
  ]
}

Scoring:
- 80-100: sterk match på rolle/seniority + lokasjon/work_type
- 60-79: god match på rolle og 1-2 andre faktorer
- 40-59: delvis match
- 0-39: lite relevant`;

  const res = await fetch(LOVABLE_AI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    console.error("[fetch-careerjet] AI gateway", res.status, await res.text());
    return 0;
  }
  const json = await res.json() as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content ?? "";
  let parsed: { scores?: Array<{ row_id: string; ai_score: number; ai_reasoning?: string; ai_match_highlights?: string; ai_concerns?: string }> };
  try { parsed = JSON.parse(content); } catch {
    console.error("[fetch-careerjet] AI non-JSON:", content.slice(0, 500));
    return 0;
  }
  const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
  const nowIso = new Date().toISOString();
  let n = 0;
  for (const s of scores) {
    if (!s?.row_id) continue;
    const aiScore = typeof s.ai_score === "number" ? Math.max(0, Math.min(100, Math.round(s.ai_score))) : null;
    const { error } = await (client.from("user_opportunities") as any)
      .update({
        ai_score: aiScore,
        ai_reasoning: s.ai_reasoning ?? null,
        ai_match_highlights: s.ai_match_highlights ?? null,
        ai_concerns: s.ai_concerns ?? null,
        ai_scored_at: nowIso,
        relevance_score: aiScore ?? undefined,
        updated_at: nowIso,
      })
      .eq("id", s.row_id);
    if (!error) n++;
  }
  return n;
}
