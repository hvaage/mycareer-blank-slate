// Stillingsbetegnelse mot ESCO — KI-assistert rangering.
//
// Prinsipper:
//   - Modellen kan bare rangere blant faktiske ESCO-treff. Den kan aldri
//     finne på en betegnelse.
//   - Samme KI-infrastruktur som resten av appen: modellprofil fra
//     ai.model_profiles, felles Claude-klient, samme nøkkel. Ny profil
//     `occupation_esco_match_v1` med lavt tokenbudsjett (600).
//   - Brukeren bekrefter alltid selv. Server-funksjonen lagrer ingenting.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TASK_KEY = "occupation_esco_match";

const schema = z.object({
  freeText: z.string().trim().min(2).max(160),
  industryHint: z.string().trim().max(120).nullable().optional(),
  backgroundHint: z.string().trim().max(600).nullable().optional(),
});

export type OccupationSuggestion = {
  uri: string;
  title: string;
  reasonNb: string;
};

const MARKET_FALLBACK_URL = "https://wcaqfupjatnjwbgatzjv.supabase.co";
// Publiserbar anon-nøkkel til markedsprosjektet — samme verdi som klienten
// allerede bruker. Fallback slik at søket virker også der servermiljøet
// ikke har MARKET_SUPABASE_ANON_KEY satt.
const MARKET_FALLBACK_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjYXFmdXBqYXRuandiZ2F0emp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MzY3OTcsImV4cCI6MjA5NTMxMjc5N30.6A869EjBHgXhEBAIkO6r3ojuYiHSpabUjXnsMHJPEoU";

async function searchEsco(query: string): Promise<{ uri: string; title: string }[]> {
  // URL og nøkkel må høre sammen. Er nøkkelen i miljøet ugyldig eller
  // mangler, brukes det kjente publiserbare paret.
  const envKey = process.env["MARKET_SUPABASE_ANON_KEY"] ?? "";
  const envUrl = process.env["MARKET_SUPABASE_URL"] ?? "";
  const useEnv = envKey.includes(".eyJpc3MiOiJzdXBh") && envUrl.length > 0;
  const url = useEnv ? envUrl : MARKET_FALLBACK_URL;
  const key = useEnv ? envKey : MARKET_FALLBACK_KEY;


  const res = await fetch(`${url}/rest/v1/rpc/search_esco_occupations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      search_text: query,
      filter_industry_slugs: null,
      result_limit: 12,
    }),
  });
  const txt = await res.text();
  if (!res.ok) return [];
  const rows = JSON.parse(txt || "[]") as any[];
  return (rows ?? [])
    .map((r) => ({
      uri: String(r.uri ?? ""),
      title: String(r.title_no || r.title || r.title_en || "").trim(),
    }))
    .filter((r) => r.uri && r.title);
}

const SYSTEM_PROMPT = `Du hjelper en norsk jobbsøker å velge riktig standardisert yrkesbetegnelse (ESCO).

Regler:
- Du velger kun blant kandidatene i listen. Du finner aldri på en betegnelse.
- Svar med gyldig JSON: {"forslag":[{"uri":"...","begrunnelse":"..."}]}
- Maks tre forslag, sortert med beste først.
- Begrunnelsen er én kort setning på norsk (bokmål), maks 20 ord.
- Ingen tekst utenfor JSON.`;

export const suggestOccupationMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => schema.parse(input ?? {}))
  .handler(async ({ data }): Promise<{ ok: boolean; errorCode?: string; items: OccupationSuggestion[] }> => {
    // Kun brukerens egne ord i søket. Bransje er kontekst til modellen,
    // ikke en del av søkestrengen — det gir null treff i ESCO-søket.
    const candidates = await searchEsco(data.freeText);

    if (candidates.length === 0) {
      return { ok: true, items: [] };
    }

    const apiKey = process.env["ANTHROPIC" + "_API_KEY"];
    if (!apiKey) return { ok: false, errorCode: "missing_api_key", items: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as unknown as {
      rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
    };

    const { data: profileRow } = await admin.rpc(
      "internal_ai_get_active_profile",
      { p_task_key: TASK_KEY },
    );
    if (!profileRow) return { ok: false, errorCode: "missing_profile", items: [] };


    const p = profileRow as any;
    const profile = {
      profileId: p.profile_id,
      taskKey: TASK_KEY,
      modelId: p.model_id,
      promptVersion: p.prompt_version,
      maxTokens: p.max_tokens,
      requestOptions: p.request_options ?? {},
      capabilities: {
        supportsTemperature: p.capabilities?.supportsTemperature === true,
        supportsTopP: p.capabilities?.supportsTopP === true,
        supportsTopK: p.capabilities?.supportsTopK === true,
        supportsThinking: p.capabilities?.supportsThinking === true,
        supportsPrefill: p.capabilities?.supportsPrefill === true,
      },
    };

    const userMessage = [
      `Brukerens egen tittel: ${data.freeText}`,
      data.industryHint ? `Bransje: ${data.industryHint}` : null,
      data.backgroundHint ? `Kort bakgrunn: ${data.backgroundHint}` : null,
      "",
      "Kandidater:",
      ...candidates.map((c) => `- ${c.uri} | ${c.title}`),
    ]
      .filter(Boolean)
      .join("\n");

    const { callClaude } = await import("../../supabase/functions/_shared/claude/client.ts");
    const result = await callClaude({
      profile,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      correlationId: crypto.randomUUID(),
      runtime: { apiKey },
    });

    if (!result.ok) return { ok: false, errorCode: "model_error", items: [] };


    let parsed: any = null;
    try {
      const text = result.text.trim();
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      parsed = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
    } catch {
      parsed = null;
    }

    const byUri = new Map(candidates.map((c) => [c.uri, c.title]));
    const items: OccupationSuggestion[] = Array.isArray(parsed?.forslag)
      ? parsed.forslag
          .map((f: any) => {
            const uri = typeof f?.uri === "string" ? f.uri : "";
            const title = byUri.get(uri);
            if (!title) return null;
            return {
              uri,
              title,
              reasonNb: typeof f?.begrunnelse === "string" ? f.begrunnelse.slice(0, 200) : "",
            };
          })
          .filter(Boolean)
          .slice(0, 3)
      : [];

    return { ok: true, items };
  });
