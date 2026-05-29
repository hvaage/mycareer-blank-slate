// Extract structured job ad info from URL or pasted/PDF text using Lovable AI.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "google/gemini-2.5-flash";

const tool = {
  type: "function",
  function: {
    name: "extract_job_ad",
    description: "Extract structured information about a job posting.",
    parameters: {
      type: "object",
      properties: {
        company_name: { type: "string" },
        role_title: { type: "string" },
        location: { type: "string" },
        work_type: { type: "string", description: "onsite | hybrid | remote" },
        industry: { type: "string" },
        company_size: { type: "string" },
        company_website: { type: "string" },
        company_linkedin: { type: "string" },
        recruiter_name: { type: "string", description: "Navn på rekrutterer/HR ansvarlig hvis nevnt." },
        recruiter_email: { type: "string" },
        recruiter_phone: { type: "string", description: "Telefonnummer til rekrutterer hvis nevnt." },
        contact_name: { type: "string", description: "Kontaktperson for stillingen (f.eks. ansettende leder)." },
        contact_email: { type: "string" },
        contact_phone: { type: "string", description: "Telefonnummer til kontaktperson hvis nevnt." },
        salary_range_min: { type: "number" },
        salary_range_max: { type: "number" },
        salary_currency: { type: "string" },
        application_deadline: { type: "string", description: "ISO date YYYY-MM-DD" },
        must_have_keywords: { type: "array", items: { type: "string" } },
        nice_to_have: { type: "array", items: { type: "string" } },
        key_requirements: { type: "array", items: { type: "string" } },
        summary: { type: "string", description: "Kort norsk oppsummering, 2-4 setninger." },
        about_role: { type: "string", description: "Om rollen: hva jobben går ut på, ansvar og oppgaver. Markdown." },
        about_company: { type: "string", description: "Om selskapet: bakgrunn, visjon, kultur. Markdown." },
        ideal_candidate: { type: "string", description: "Hva slags person de ser etter: ønsket bakgrunn, egenskaper, kompetanse. Markdown." },
        ad_markdown: { type: "string", description: "Selve annonseteksten (primært det som står under 'About the job' / 'Om jobben' / 'Om stillingen') formatert som ren Markdown med overskrifter, lister og avsnitt. Fjern LinkedIn-meny, cookies, footer, navigasjon, språkvalg og lignende." },
      },
    },
  },
};

async function fetchUrlText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "nb-NO,nb;q=0.9,en;q=0.8",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Klarte ikke å hente URL (${res.status}). Lim inn annonseteksten manuelt eller last opp PDF.`);
  }
  const html = await res.text();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 25000);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { url, text } = await req.json();
    let source = (text ?? "").toString().trim();
    if (!source && url) {
      try {
        source = await fetchUrlText(url);
      } catch (e) {
        return new Response(
          JSON.stringify({
            error:
              (e instanceof Error ? e.message : String(e)) +
              " Tips: Annonser bak innlogging (f.eks. LinkedIn) kan ikke hentes automatisk – kopier teksten eller last opp som PDF.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }
    if (!source || source.length < 50) {
      return new Response(
        JSON.stringify({
          error:
            "Fant ingen lesbar annonsetekst. Annonser bak innlogging (LinkedIn m.fl.) kan ikke hentes automatisk – lim inn teksten eller last opp PDF.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY mangler");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "Du trekker ut strukturert informasjon fra norske/engelske stillingsannonser (ofte fra LinkedIn, Finn.no, selskapssider). Fokuser på selve annonseteksten, typisk under overskrifter som 'About the job', 'Om jobben', 'Om stillingen', 'Job description'. Ignorer fullstendig LinkedIn-/sidemenyer, cookie-bannere, språkvelgere, footer og navigasjon. " +
              "Let aktivt etter kontaktinformasjon: navn, e-post (alt som ser ut som ord@domene.tld), telefonnummer (norske formater som '+47 12345678', '123 45 678', '12 34 56 78', eller internasjonale formater), og rolletitler som 'Recruiter', 'Hiring Manager', 'Talent Acquisition', 'For mer informasjon kontakt', 'Spørsmål om stillingen'. Skill mellom rekrutterer (HR/TA) og kontaktperson (ansettende leder/fagperson). " +
              "Fyll ut about_role (Om rollen – hva jobben innebærer), about_company (Om selskapet) og ideal_candidate (Hva slags person de ser etter – bakgrunn, egenskaper, kompetanse) som rene Markdown-seksjoner basert på annonsen. " +
              "Svar bare via verktøykallet. Hopp over felter du ikke finner – ikke gjett.",
          },
          { role: "user", content: source },
        ],
        tools: [tool],
        tool_choice: { type: "function", function: { name: "extract_job_ad" } },
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      const status = res.status === 429 || res.status === 402 ? res.status : 500;
      return new Response(JSON.stringify({ error: t }), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const call = data.choices?.[0]?.message?.tool_calls?.[0];
    const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
    return new Response(JSON.stringify({ extracted: args, raw_text: source }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
