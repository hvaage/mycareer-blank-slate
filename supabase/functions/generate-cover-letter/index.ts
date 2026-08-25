// deno-lint-ignore-file no-explicit-any
// Generate a tailored cover letter + structured company analysis via the configured AI provider.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "claude-sonnet-4-6";

type Payload = {
  language: "no" | "en";
  length: "kort" | "medium" | "lang";
  letter_type: "standard" | "motivasjon" | "kort_intro" | "oppfolging";
  focus?: string;
  guidance?: string;
  application_id?: string | null;
  job: {
    company_name?: string | null;
    role_title?: string | null;
    location?: string | null;
    job_url?: string | null;
    company_website?: string | null;
    ad_text?: string | null;
    about_role?: string | null;
    about_company?: string | null;
    ideal_candidate?: string | null;
    key_requirements?: string[] | null;
    must_have_keywords?: string[] | null;
    contact_name?: string | null;
    recruiter_name?: string | null;
  };
  profile: Record<string, unknown>;
};

const SYSTEM_PROMPT = `You are a senior career coach and company research analyst. For each request, you produce a structured five-block response that includes job analysis, web-researched company assessment, a structured rating JSON, a match assessment, and a tailored cover letter.

LANGUAGE RULE: Write JOB ANALYSIS, COMPANY RESEARCH, MATCH ASSESSMENT and ai_rating_notes in Norwegian (bokmål) by default. ONLY switch to English if the user explicitly requests language=en. The COVER LETTER follows the user-requested language. The block labels themselves (JOB ANALYSIS, COMPANY RESEARCH, COMPANY_RATING_JSON, MATCH ASSESSMENT, COVER LETTER) MUST always be written in English exactly as listed — do not translate them.

You have access to web search. Use it to research the company across these dimensions: culture and values, leadership quality, work environment, career development, financial stability, and mission/purpose. Cite source URLs inline.

FINANCIAL STABILITY — NORWEGIAN COMPANIES: For companies registered in Norway, you MUST consult proff.no (e.g. https://www.proff.no/selskap/<navn>) and/or proff.no's regnskapstall to assess financial stability (revenue trend, profit/EBITDA, equity ratio, payment remarks). Cite the exact proff.no URL used. Supplement with brreg.no when relevant.

Return EXACTLY these five blocks in order, each preceded by its label on its own line. Use clean Markdown formatting inside each block (headings ##, lists, bold). Never wrap a block in code fences.

1. JOB ANALYSIS
Markdown with subsections: **Rolle og ansvar**, **Må-krav**, **Bør-krav**, **Signaler om selskapets prioriteringer**.

2. COMPANY RESEARCH
Markdown profile with one short paragraph or bullet list per dimension (Kultur, Ledelse, Arbeidsmiljø, Karriereutvikling, Finansiell stabilitet, Formål). Cite source URLs inline as Markdown links.

3. COMPANY_RATING_JSON
A single JSON object (no surrounding prose, no markdown fences) with this exact structure:

{
  "ai_culture_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_leadership_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_work_environment_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_career_development_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_financial_stability_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_mission_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_candidate_fit_score": <number 1.0-5.0 in 0.5 increments>,
  "ai_overall_score": <mean of the six company-level scores above, excluding candidate_fit>,
  "ai_rating_notes": "<rationale, max 300 words, in Norwegian unless language=en>",
  "sources": ["<url1>", "<url2>"]
}

Scale: 1.0 = significant concern or no evidence, 3.0 = average, 5.0 = strong and well-evidenced.

4. MATCH ASSESSMENT
Structured Markdown — use these exact level-2 headings in this order:

## Helhetsvurdering
1–2 setninger: hvor god er matchen totalt, og hvorfor.

## Matchscore
En tabell:
| Område | Score (1–5) | Kommentar |
| --- | --- | --- |
(Inkluder rader for: Erfaring, Kompetanse/skills, Bransje, Lederskap/seniority, Geografi/arbeidsform, Motivasjon/verdier.)

## Sterke sider som matcher
Punktliste — hvert punkt knytter en konkret CV/profil-styrke til et konkret krav i annonsen.

## Gap og risiko
Punktliste over reelle gap, manglende kvalifikasjoner eller røde flagg.

## Tiltak og posisjonering
Punktliste — hvordan du bør håndtere gapene og hva du bør løfte frem i søknad og intervju.

## Anbefaling
Én tydelig anbefaling: Søk / Søk med forbehold / Ikke søk — med kort begrunnelse.

5. COVER LETTER
The final cover letter in clean Markdown — no preamble, no explanation, no code fences. Use the candidate's display_name as signature when available. Address the recruiter/contact by name when present. Follow the user-requested language for this block.

When writing in English: use consistent British or American English depending on the target company's location, or the company's origin if unknown.`;

const TYPE_LABELS_NO: Record<string, string> = {
  standard: "Standard søknadsbrev",
  motivasjon: "Motivasjonsbrev",
  kort_intro: "Kort introduksjonsbrev (e-post)",
  oppfolging: "Oppfølgingsbrev etter intervju/kontakt",
};
const TYPE_LABELS_EN: Record<string, string> = {
  standard: "Standard cover letter",
  motivasjon: "Motivation letter",
  kort_intro: "Short intro letter (email)",
  oppfolging: "Follow-up letter after interview/contact",
};
const LENGTH_NO: Record<string, string> = {
  kort: "ca. 150-220 ord",
  medium: "ca. 280-380 ord",
  lang: "ca. 450-600 ord",
};
const LENGTH_EN: Record<string, string> = {
  kort: "approx. 150-220 words",
  medium: "approx. 280-380 words",
  lang: "approx. 450-600 words",
};

function buildUserMessage(p: Payload): string {
  const lang = p.language === "en" ? "English" : "norsk (bokmål)";
  const typeLabel = (p.language === "en" ? TYPE_LABELS_EN : TYPE_LABELS_NO)[p.letter_type];
  const lengthLabel = (p.language === "en" ? LENGTH_EN : LENGTH_NO)[p.length];
  const job = p.job;
  const profile = p.profile ?? {};

  const jobBlock = [
    `Company: ${job.company_name ?? "(unknown)"}`,
    `Role: ${job.role_title ?? "(unknown)"}`,
    job.location && `Location: ${job.location}`,
    job.company_website && `Company website: ${job.company_website}`,
    job.job_url && `Job URL: ${job.job_url}`,
    (job.recruiter_name || job.contact_name) && `Contact: ${job.contact_name ?? job.recruiter_name}`,
    job.about_role && `\nAbout the role:\n${job.about_role}`,
    job.about_company && `\nAbout the company:\n${job.about_company}`,
    job.ideal_candidate && `\nIdeal candidate:\n${job.ideal_candidate}`,
    job.key_requirements?.length && `\nKey requirements: ${job.key_requirements.join(", ")}`,
    job.must_have_keywords?.length && `\nMust-have keywords: ${job.must_have_keywords.join(", ")}`,
    job.ad_text && `\n--- Full ad text ---\n${job.ad_text.slice(0, 6000)}`,
  ].filter(Boolean).join("\n");

  const profileBlock = JSON.stringify(profile, null, 2).slice(0, 8000);

  return `Write a **${typeLabel}** in ${lang}, length ${lengthLabel}.

${p.focus ? `Primary focus: ${p.focus}\n` : ""}${p.guidance ? `Additional instructions from the candidate: ${p.guidance}\n` : ""}
=== JOB POSTING ===
${jobBlock}

=== CANDIDATE PROFILE (from About-me page and CV data) ===
${profileBlock}

Now produce all five labeled blocks (JOB ANALYSIS, COMPANY RESEARCH, COMPANY_RATING_JSON, MATCH ASSESSMENT, COVER LETTER) in order. Use web_search to research the company before producing COMPANY RESEARCH and COMPANY_RATING_JSON.`;
}

const LABELS = [
  "JOB ANALYSIS",
  "COMPANY RESEARCH",
  "COMPANY_RATING_JSON",
  "MATCH ASSESSMENT",
  "COVER LETTER",
] as const;

function parseBlocks(fullText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const positions: { label: string; start: number; afterLabel: number }[] = [];
  for (const label of LABELS) {
    const re = new RegExp(`(^|\\n)\\s*(?:#+\\s*)?(?:\\d+\\.\\s*)?\\*{0,2}${label}\\*{0,2}\\s*:?\\s*(?=\\n|$)`, "i");
    const m = fullText.match(re);
    if (m && m.index !== undefined) {
      const start = m.index + m[1].length;
      positions.push({ label, start, afterLabel: start + (m[0].length - m[1].length) });
    }
  }
  positions.sort((a, b) => a.start - b.start);
  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const end = next ? next.start : fullText.length;
    out[cur.label] = fullText.slice(cur.afterLabel, end).trim();
  }
  return out;
}

function extractJson(text: string): any | null {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = url.startsWith("http") ? new URL(url) : new URL(`https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function extractHelhetsvurdering(match: string): string | null {
  const m = match.match(/##\s*Helhetsvurdering\s*\n+([\s\S]+?)(?=\n##\s|$)/i);
  const t = m?.[1]?.trim();
  return t ? t.slice(0, 2500) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY mangler");

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    const { data: { user }, error: userErr } = await serviceClient.auth.getUser(
      authHeader?.replace("Bearer ", "") ?? "",
    );
    if (!user || userErr) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    const payload = (await req.json()) as Payload;
    const userMessage = buildUserMessage(payload);

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("generate-cover-letter AI HTTP error", aiRes.status, t);
      const status = aiRes.status === 429 ? 429 : aiRes.status === 402 ? 402 : 500;
      const message =
        aiRes.status === 429
          ? "AI-tjenesten er midlertidig opptatt. Prøv igjen om litt."
          : aiRes.status === 402
            ? "AI-kvoten er brukt opp eller krever oppmerksomhet. Kontakt support om problemet vedvarer."
            : "AI-generering av søknadsbrev kunne ikke fullføres akkurat nå. Prøv igjen om litt.";
      return new Response(
        JSON.stringify({
          error: status === 429 ? "ai_rate_limited" : status === 402 ? "ai_payment_required" : "ai_error",
          message,
        }),
        {
          status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const aiJson = await aiRes.json();
    const contentBlocks = Array.isArray(aiJson?.content) ? aiJson.content : [];
    const fullText = contentBlocks
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    // Collect URLs from web_search tool results + inline citations
    const webSourceSet = new Set<string>();
    for (const block of contentBlocks) {
      if (block?.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r?.url) webSourceSet.add(r.url);
        }
      }
      if (block?.type === "text" && Array.isArray(block.citations)) {
        for (const c of block.citations) {
          if (c?.url) webSourceSet.add(c.url);
        }
      }
    }

    const blocks = parseBlocks(fullText);
    const letter = blocks["COVER LETTER"] ?? "";
    const job_analysis = blocks["JOB ANALYSIS"] ?? "";
    const company_research = blocks["COMPANY RESEARCH"] ?? "";
    const match_assessment = blocks["MATCH ASSESSMENT"] ?? "";
    const company_rating = extractJson(blocks["COMPANY_RATING_JSON"] ?? "") ?? null;
    if (company_rating?.sources && Array.isArray(company_rating.sources)) {
      for (const s of company_rating.sources) if (typeof s === "string") webSourceSet.add(s);
    }

    let company_id: string | null = null;
    let company_scores_updated = false;
    let company_existed_already = false;

    const companyName = payload.job.company_name?.trim() || null;
    let domain = extractDomain(payload.job.company_website ?? payload.job.job_url ?? null);
    if (domain && /jobviewtrack\.com$/i.test(domain)) domain = null;

    if (companyName) {
      try {
        let existingRow: any = null;

        if (domain) {
          const { data } = await serviceClient
            .from("companies")
            .select("id, ai_rated_at, research_log")
            .ilike("domain", domain)
            .limit(1)
            .maybeSingle();
          if (data) existingRow = data;
        }
        if (!existingRow) {
          const { data } = await serviceClient
            .from("companies")
            .select("id, ai_rated_at, research_log")
            .ilike("name", companyName)
            .limit(1)
            .maybeSingle();
          if (data) existingRow = data;
        }
        if (!existingRow) {
          const insertRow: Record<string, unknown> = { name: companyName };
          if (domain) insertRow.domain = domain;
          let created = await serviceClient
            .from("companies")
            .insert(insertRow)
            .select("id, ai_rated_at, research_log")
            .single();
          if (created.error && domain) {
            created = await serviceClient
              .from("companies")
              .insert({ name: companyName })
              .select("id, ai_rated_at, research_log")
              .single();
          }
          if (created.error) throw created.error;
          existingRow = created.data;
        } else {
          company_existed_already = true;
        }
        company_id = existingRow.id;

        const now = new Date().toISOString();
        const existingLog = Array.isArray(existingRow?.research_log) ? existingRow.research_log : [];

        if (company_rating) {
          const THREE_MONTHS_AGO = new Date();
          THREE_MONTHS_AGO.setMonth(THREE_MONTHS_AGO.getMonth() - 3);
          const lastRated = existingRow?.ai_rated_at ? new Date(existingRow.ai_rated_at) : null;
          const needsAiUpdate = !lastRated || lastRated < THREE_MONTHS_AGO;

          const cappedLog = [
            ...existingLog,
            { at: now, by: user_id, sources: company_rating.sources ?? [], via: "cover-letter" },
          ].slice(-20);

          const updatePayload: Record<string, unknown> = {
            research_log: cappedLog,
            updated_at: now,
          };
          if (needsAiUpdate) {
            updatePayload.ai_culture_score = company_rating.ai_culture_score;
            updatePayload.ai_leadership_score = company_rating.ai_leadership_score;
            updatePayload.ai_work_environment_score = company_rating.ai_work_environment_score;
            updatePayload.ai_career_development_score = company_rating.ai_career_development_score;
            updatePayload.ai_financial_stability_score = company_rating.ai_financial_stability_score;
            updatePayload.ai_mission_score = company_rating.ai_mission_score;
            updatePayload.ai_overall_score = company_rating.ai_overall_score;
            updatePayload.ai_rating_notes = company_rating.ai_rating_notes;
            updatePayload.ai_rated_at = now;
            company_scores_updated = true;
          }

          const { error: updErr } = await serviceClient
            .from("companies")
            .update(updatePayload)
            .eq("id", company_id);
          if (updErr) {
            console.error("companies update (with rating) failed:", updErr);
            const { error: touchErr } = await serviceClient
              .from("companies")
              .update({ updated_at: now })
              .eq("id", company_id);
            if (touchErr) console.error("companies touch update failed:", touchErr);
          }

          if (typeof company_rating.ai_candidate_fit_score === "number") {
            const fitReason = extractHelhetsvurdering(match_assessment);
            const { error: upsertErr } = await serviceClient
              .from("user_company_ratings")
              .upsert(
                {
                  user_id,
                  company_id,
                  ai_candidate_fit_score: company_rating.ai_candidate_fit_score,
                  ai_candidate_fit_reasoning: fitReason,
                  updated_at: now,
                },
                { onConflict: "user_id,company_id" },
              );
            if (upsertErr) console.error("user_company_ratings upsert error:", upsertErr);
          }
        } else {
          const { error: touchErr } = await serviceClient
            .from("companies")
            .update({ updated_at: now })
            .eq("id", company_id);
          if (touchErr) console.error("companies touch update failed:", touchErr);
        }

        if (payload.application_id) {
          await serviceClient
            .from("applications")
            .update({ company_id })
            .eq("id", payload.application_id)
            .eq("user_id", user_id)
            .is("company_id", null);
        }
      } catch (dbErr) {
        console.error("DB integration error (non-fatal):", dbErr);
      }
    }

    const web_sources = Array.from(webSourceSet);
    return new Response(
      JSON.stringify({
        letter,
        job_analysis,
        company_research,
        match_assessment,
        company_rating,
        company_id,
        company_scores_updated,
        company_existed_already,
        web_sources,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("generate-cover-letter error:", e);
    return new Response(
      JSON.stringify({
        error: "ai_error",
        message: "AI-generering av søknadsbrev kunne ikke fullføres akkurat nå. Prøv igjen om litt.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
