// Stedsøk mot Kartverket (åpen API, ingen autentisering).
// https://ws.geonorge.no/stedsnavn/v1/navn
import { createServerFn } from "@tanstack/react-start";

export type PlaceResult = {
  /** Visning og lagring: "Oslo (Oslo)" eller "Lillehammer (Innlandet)". */
  displayLabel: string;
  /** Stedsnavn for fri tekst (kompat). */
  description: string;
  main_text?: string;
  secondary_text?: string;
  place_id?: string;
};

export type PlaceSuggestion = PlaceResult;

type KartverketNavn = {
  skrivemåte?: string;
  navneobjekttype?: string;
  kommuner?: Array<{ kommunenavn?: string; fylkesnavn?: string }>;
  fylker?: Array<{ fylkesnavn?: string }>;
  stedsnummer?: number | string;
};

const RELEVANT_TYPES = new Set([
  "by", "tettsted", "tettbebyggelse", "bydel", "grend", "bygd",
  "kommune", "fylke", "landsdel", "øy", "boligfelt",
]);

function pickKommune(n: KartverketNavn): { kommune?: string; fylke?: string } {
  const k = n.kommuner?.[0];
  const f = n.fylker?.[0];
  return {
    kommune: k?.kommunenavn,
    fylke: k?.fylkesnavn ?? f?.fylkesnavn,
  };
}

function buildResult(n: KartverketNavn): PlaceResult | null {
  const navn = (n.skrivemåte ?? "").trim();
  if (!navn) return null;
  const { kommune, fylke } = pickKommune(n);
  const secondary = [kommune && kommune !== navn ? kommune : null, fylke]
    .filter(Boolean)
    .join(", ");
  const displayLabel = secondary ? `${navn} (${secondary})` : navn;
  return {
    displayLabel,
    description: displayLabel,
    main_text: navn,
    secondary_text: secondary || undefined,
    place_id: n.stedsnummer != null ? String(n.stedsnummer) : undefined,
  };
}

async function fetchPlaces(query: string): Promise<PlaceResult[]> {
  const sok = query.trim();
  if (sok.length < 2) return [];
  const url = new URL("https://ws.geonorge.no/stedsnavn/v1/navn");
  url.searchParams.set("sok", sok.endsWith("*") ? sok : `${sok}*`);
  url.searchParams.set("fuzzy", "true");
  url.searchParams.set("utkoordsys", "4258");
  url.searchParams.set("treffPerSide", "25");
  url.searchParams.set("side", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "User-Agent": "karrierenmin.no/1.0" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { navn?: KartverketNavn[] };
  const all = Array.isArray(data?.navn) ? data.navn : [];

  // Foretrekk relevante typer, men ikke filtrer hardt bort hvis det er få treff.
  const relevant = all.filter((n) =>
    n.navneobjekttype ? RELEVANT_TYPES.has(n.navneobjekttype.toLowerCase()) : true,
  );
  const source = relevant.length > 0 ? relevant : all;

  const seen = new Set<string>();
  const out: PlaceResult[] = [];
  for (const n of source) {
    const r = buildResult(n);
    if (!r) continue;
    const key = r.displayLabel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
    if (out.length >= 12) break;
  }
  return out;
}

export const searchPlaces = createServerFn({ method: "POST" })
  .inputValidator((input: { query: string; types?: string }) => input)
  .handler(async ({ data }): Promise<PlaceResult[]> => {
    try {
      return await fetchPlaces(String(data?.query ?? ""));
    } catch {
      return [];
    }
  });
