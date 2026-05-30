// @ts-nocheck
/** Align with SQL `normalize_lead_key` URL branch (host+path only, no query/fragment). */
export function normalizeListingUrlForDedupe(raw: string): string {
  let u = raw.trim().toLowerCase();
  u = u.replace(/^https?:\/\//, "");
  u = u.replace(/[?#].*$/, "");
  u = u.replace(/\/+$/, "");
  u = u.replace(/^www\./, "");
  return u;
}

export function isJobviewtrackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
    return h.includes("jobviewtrack.com");
  } catch {
    return /jobviewtrack\.com/i.test(url);
  }
}

/** Stable careerjet.no search URL from title / company / location (no track URLs). */
export function careerjetJobbsoekUrl(opts: {
  title: string | null | undefined;
  company: string | null | undefined;
  location: string | null | undefined;
}): string {
  const params = new URLSearchParams();
  const keywords = [opts.title, opts.company].filter(Boolean).join(" ").trim();
  if (keywords) params.set("s", keywords);
  if (opts.location) params.set("l", opts.location.split(",")[0].trim());
  const qs = params.toString();
  return qs ? `https://www.careerjet.no/jobbsoek?${qs}` : "https://www.careerjet.no/";
}

/**
 * Card / list URL: never surface jobviewtrack as the primary link when a public jobbsøk URL
 * can be built from title+company+location. Preserves raw separately via callers.
 */
export function effectiveCareerjetCardUrl(opts: {
  raw_url: string | null | undefined;
  display_url: string | null | undefined;
  title: string | null | undefined;
  company: string | null | undefined;
  location: string | null | undefined;
}): string {
  const raw = (opts.raw_url ?? "").trim();
  const disp = (opts.display_url ?? "").trim();
  if (isJobviewtrackUrl(raw) || isJobviewtrackUrl(disp)) {
    return careerjetJobbsoekUrl(opts);
  }
  if (disp.startsWith("http")) return disp;
  if (raw.startsWith("http")) return raw;
  return careerjetJobbsoekUrl(opts);
}

/** Prefer a stable Careerjet search link when the API only gives a brittle redirect URL. */
export function preferredCareerjetBrowseUrl(opts: {
  sourceUrl: string | null | undefined;
  title: string | null | undefined;
  company: string | null | undefined;
  location: string | null | undefined;
}): string | null {
  const { sourceUrl, title, company, location } = opts;
  if (isJobviewtrackUrl(sourceUrl ?? undefined)) {
    return careerjetJobbsoekUrl({ title, company, location });
  }
  if (sourceUrl && sourceUrl.startsWith("http")) return sourceUrl;
  return null;
}
