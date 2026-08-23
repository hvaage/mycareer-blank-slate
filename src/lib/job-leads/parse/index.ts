/**
 * Unified parser for job advertisement emails. Produces a structured,
 * source-agnostic representation that can be persisted to job_leads regardless
 * of whether the mail came from Finn.no, LinkedIn, or another board.
 */

export type ParsedLead = {
  source_system: "finn" | "linkedin" | "other";
  title: string | null;
  company: string | null;
  location: string | null;
  work_type: string | null;
  employment_type: string | null;
  salary: string | null;
  job_url: string | null;
  application_due: string | null; // ISO timestamp
  raw_text: string;
  raw_html: string | null;
  confidence: number; // 0–1
  reason: string | null;
};

export type ParseResult =
  | { ok: true; lead: ParsedLead; rejectReason?: never }
  | { ok: false; lead?: never; rejectReason: string };

export type EmailInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  receivedAt: string;
};

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeText(input: string, html?: string | null): string {
  const base = html ? stripHtmlTags(html) : input;
  return base
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function extractUrlFromText(text: string): string | null {
  // Match URLs that look like job listings. Keep it conservative.
  const matches = [
    ...text.matchAll(
      /https?:\/\/(?:www\.)?(?:finn\.no|linkedin\.com|jobs\.linkedin\.com)\/[^\s<>"')\]]+/gi,
    ),
  ];
  if (matches.length === 0) return null;
  return matches[0][0];
}

export function looksLikeJobEmail(input: EmailInput): boolean {
  const subject = input.subject.toLowerCase();
  const text = (input.text || "").toLowerCase();
  const from = input.from.toLowerCase();
  const jobKeywords = [
    "jobb",
    "stilling",
    "ledig stilling",
    "søknadsfrist",
    "apply",
    "job posting",
    "new job",
    "recommended job",
    "stillingsannonse",
  ];
  if (jobKeywords.some((k) => subject.includes(k))) return true;
  if (jobKeywords.some((k) => text.includes(k))) return true;
  if (from.includes("linkedin.com") || from.includes("finn.no")) return true;
  return false;
}

export function parseApplicationDeadline(text: string): string | null {
  const norsk = [
    /søknadsfrist[:\s]+(\d{1,2}\.\d{1,2}\.\d{4})/i,
    /søknadsfrist[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /søknadsfrist[:\s]+(\d{1,2}\.\d{1,2}\.\d{2})/i,
    /frist[:\s]+(\d{1,2}\.\d{1,2}\.\d{4})/i,
  ];
  const english = [
    /apply by[:\s]+(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
    /application deadline[:\s]+(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i,
  ];

  for (const re of [...norsk, ...english]) {
    const m = text.match(re);
    if (m) {
      const iso = normalizeDateString(m[1]);
      if (iso) return iso;
    }
  }
  return null;
}

function normalizeDateString(value: string): string | null {
  const parts = value.split(/[\.\/\-]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  let [a, b, c] = parts;
  let day: string;
  let month: string;
  let year: string;
  if (a.length === 4) {
    year = a;
    month = b.padStart(2, "0");
    day = c.padStart(2, "0");
  } else {
    if (c.length === 2) {
      year = "20" + c;
    } else {
      year = c;
    }
    day = a.padStart(2, "0");
    month = b.padStart(2, "0");
  }
  const dt = new Date(`${year}-${month}-${day}T23:59:00Z`);
  if (isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

export function parseEmail(input: EmailInput): ParseResult {
  if (!looksLikeJobEmail(input)) {
    return { ok: false, rejectReason: "not_job_email" };
  }

  const from = input.from.toLowerCase();
  const subject = input.subject;
  const text = normalizeText(input.text, input.html);

  if (from.includes("finn.no") || text.includes("finn.no") || subject.includes("finn")) {
    return parseFinn(input, text);
  }
  if (
    from.includes("linkedin.com") ||
    text.includes("linkedin.com/jobs") ||
    subject.includes("linkedin")
  ) {
    return parseLinkedIn(input, text);
  }

  // Fallback: generic job board email
  return parseGeneric(input, text);
}

function parseFinn(input: EmailInput, text: string): ParseResult {
  const title =
    matchFirst(/(?:stilling|jobb)[–\-:\s]+(.+?)(?:\n| hos | på |\$)/i, text) ||
    matchFirst(/^(.+?)\n?\s*(?:hos|på)/im, text) ||
    cleanTitle(input.subject);

  const company =
    matchFirst(/(?:bedrift|arbeidsgiver|firma|company)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:hos|på)\s+(.+?)(?:\n|søker|–|\-)/i, text);

  const location =
    matchFirst(/(?:sted|lokasjon|location|arbeidssted)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:i|in)\s+([A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+(?:,\s*[A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+)?)/, text);

  const work_type =
    matchFirst(/(?:stillingsprosent|omfang|engagement|work type)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    inferExtentFromText(text);

  const employment_type =
    matchFirst(/(?:ansettelsesform|type|engagement type)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    inferEngagementFromText(text);

  const salary = matchFirst(/(?:lønn|lønnsnivå|salary|compensation)[:\s]+(.+?)(?:\n|\r|$)/i, text);

  const job_url =
    extractUrlFromText(text) ||
    (input.html ? extractUrlFromText(input.html) : null);

  const application_due = parseApplicationDeadline(text);

  const lead: ParsedLead = {
    source_system: "finn",
    title,
    company,
    location,
    work_type,
    employment_type,
    salary,
    job_url,
    application_due,
    raw_text: text,
    raw_html: input.html,
    confidence: scoreConfidence(title, company, job_url),
    reason: "parsed_by_finn_rules",
  };

  return { ok: true, lead };
}

function parseLinkedIn(input: EmailInput, text: string): ParseResult {
  // LinkedIn alert emails often contain the job title in the subject line.
  const title =
    matchFirst(/(?:new job posted|new position|job alert)[:\s]+(.+?)(?:\n|\r| at | hos | på |\$)/i, text) ||
    matchFirst(/(?:role|position|title)[:\s]+(.+?)(?:\n|\r| at | hos | på |\$)/i, text) ||
    cleanTitle(input.subject);

  const company =
    matchFirst(/(?:company|bedrift|arbeidsgiver)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:at|hos|på)\s+([A-ZÆØÅ][A-ZÆØÅa-zæøå\-&.,\s]+?)(?:\n|\r|·|\||is hiring)/i, text);

  const location =
    matchFirst(/(?:location|sted|arbeidssted)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:\n|\r|^)([A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+(?:,\s*[A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+){0,2})\s*(?:\n|\r|·|\|)/, text);

  const work_type =
    matchFirst(/(?:work type|stillingsprosent|omfang)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    inferExtentFromText(text);

  const employment_type =
    matchFirst(/(?:employment type|employment|job type)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    inferEngagementFromText(text);

  const salary = matchFirst(/(?:salary|compensation|pay)[:\s]+(.+?)(?:\n|\r|$)/i, text);

  const job_url =
    extractUrlFromText(text) ||
    (input.html ? extractUrlFromText(input.html) : null);

  const application_due = parseApplicationDeadline(text);

  const lead: ParsedLead = {
    source_system: "linkedin",
    title,
    company,
    location,
    work_type,
    employment_type,
    salary,
    job_url,
    application_due,
    raw_text: text,
    raw_html: input.html,
    confidence: scoreConfidence(title, company, job_url),
    reason: "parsed_by_linkedin_rules",
  };

  return { ok: true, lead };
}

function parseGeneric(input: EmailInput, text: string): ParseResult {
  const title = cleanTitle(input.subject);
  const company =
    matchFirst(/(?:company|bedrift|arbeidsgiver|employer)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:at|hos|på)\s+([A-ZÆØÅ][A-ZÆØÅa-zæøå\-&.,\s]+?)(?:\n|\r|is hiring)/i, text);
  const location =
    matchFirst(/(?:location|sted|arbeidssted)[:\s]+(.+?)(?:\n|\r|$)/i, text) ||
    matchFirst(/(?:\n|\r|^)([A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+(?:,\s*[A-ZÆØÅ][A-ZÆØÅa-zæøå\-]+){0,2})\s*(?:\n|\r|·)/, text);
  const work_type = inferExtentFromText(text);
  const employment_type = inferEngagementFromText(text);
  const salary = matchFirst(/(?:salary|lønn|compensation)[:\s]+(.+?)(?:\n|\r|$)/i, text);
  const job_url = extractUrlFromText(text) || (input.html ? extractUrlFromText(input.html) : null);
  const application_due = parseApplicationDeadline(text);

  return {
    ok: true,
    lead: {
      source_system: "other",
      title,
      company,
      location,
      work_type,
      employment_type,
      salary,
      job_url,
      application_due,
      raw_text: text,
      raw_html: input.html,
      confidence: scoreConfidence(title, company, job_url) * 0.8,
      reason: "parsed_by_generic_rules",
    },
  };
}

function cleanTitle(subject: string): string | null {
  const s = subject.trim();
  if (!s) return null;
  // Remove common newsletter prefixes
  const prefixes = [
    /^re:\s*/i,
    /^fwd?:\s*/i,
    /^jobb[–\-:]\s*/i,
    /^job alert[:\s]*/i,
    /^new job[:\s]*/i,
    /^stillingsannonse[:\s]*/i,
  ];
  let out = s;
  for (const p of prefixes) out = out.replace(p, "");
  return out.trim() || s;
}

function matchFirst(pattern: RegExp, text: string): string | null {
  const m = text.match(pattern);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

function inferExtentFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("heltid") || t.includes("full-time") || t.includes("full time")) return "heltid";
  if (t.includes("deltid") || t.includes("part-time") || t.includes("part time")) return "deltid";
  return null;
}

function inferEngagementFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("fast") || t.includes("permanent") || t.includes("permanent position")) return "fast";
  if (t.includes("midlertidig") || t.includes("temporary")) return "midlertidig";
  if (t.includes("prosjekt") || t.includes("project") || t.includes("engagement")) return "prosjekt";
  if (t.includes("vikariat") || t.includes("substitute")) return "vikariat";
  return null;
}

function scoreConfidence(
  title: string | null,
  company: string | null,
  job_url: string | null,
): number {
  let score = 0.2;
  if (title && title.length > 2) score += 0.25;
  if (company && company.length > 2) score += 0.25;
  if (job_url && job_url.startsWith("http")) score += 0.3;
  return Math.min(1, Math.max(0.1, score));
}

export const ParseRejectReason = {
  NOT_JOB_EMAIL: "not_job_email",
  MISSING_TITLE: "missing_title",
  LOW_CONFIDENCE: "low_confidence",
} as const;
