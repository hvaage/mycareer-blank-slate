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
  return qs ? `https://www.careerjet.no/sok/jobber?${qs}` : "https://www.careerjet.no/";
}

/**
 * Card / list URL: prefer a direct non-tracking URL. Careerjet's jobviewtrack
 * URLs can expire/404, so route those to the active Careerjet search page.
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
  const searchUrl = careerjetJobbsoekUrl({ title: opts.title, company: opts.company, location: opts.location });
  if (raw.startsWith("http") && !isJobviewtrackUrl(raw) && !raw.includes("careerjet.no/jobbsoek")) return raw;
  if (disp.startsWith("http") && !isJobviewtrackUrl(disp) && !disp.includes("careerjet.no/jobbsoek")) return disp;
  return searchUrl;
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
  if (sourceUrl && sourceUrl.startsWith("http") && !sourceUrl.includes("careerjet.no/jobbsoek")) return sourceUrl;
  if (sourceUrl && sourceUrl.includes("careerjet.no/jobbsoek")) return careerjetJobbsoekUrl({ title, company, location });
  return null;
}
