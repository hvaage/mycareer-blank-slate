// Serveronly: hvitlistet felt-mapping fra LinkedIn-CSV til domenestaging.
// Ingen rå CSV-rad lagres; kun navngitte felt per record_kind.

import type { LinkedInStagingDomain } from "./contract";
import { normalizeText, parseLinkedInDate } from "./normalize.server";
import { normalizeLinkedInProfileUrl } from "./reconciliation/v2/contract.server";


export const DOMAIN_TABLES: Record<LinkedInStagingDomain, string> = {
  profile: "linkedin_profile_staging",
  career: "linkedin_career_staging",
  recommendation: "linkedin_recommendation_staging",
  network: "linkedin_network_staging",
  job: "linkedin_job_staging",
  learning: "linkedin_learning_staging",
  content: "linkedin_content_staging",
};

type Row = Record<string, string>;
const pick = (row: Row, ...keys: string[]) => {
  for (const k of keys) {
    const hit = Object.keys(row).find((h) => h.toLowerCase() === k.toLowerCase());
    if (hit) {
      const v = normalizeText(row[hit]);
      if (v) return v;
    }
  }
  return null;
};

/** Returnerer verdien kun når den er en gyldig absolutt http/https-URL. */
export function httpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

export type NetworkObjectKind =
  | "person_contact"
  | "invitation"
  | "company_observation"
  | "network_event"
  | "network_preference_signal"
  | "other";

export type MappedRecord = {
  domainFields: Record<string, unknown>;
  /** Felter som inngår i identitetshashen. */
  identityFields: Record<string, string | null>;
  sourceEventAt: string | null;
  /** Objektklasse for nettverkskilder. Udefinert for andre domener. */
  objectKind?: NetworkObjectKind;
  /** Sant når kilden har en stabil identitet (personkilder: normalisert URL). */
  hasStableIdentity?: boolean;
};


export function mapRow(recordKind: string, row: Row): MappedRecord | null {
  switch (recordKind) {
    case "profile_row":
    case "profile_summary": {
      const f = {
        first_name: pick(row, "First Name"),
        last_name: pick(row, "Last Name"),
        headline: pick(row, "Headline"),
        summary: pick(row, "Summary"),
        industry: pick(row, "Industry"),
        geo_location: pick(row, "Geo Location", "Location"),
        websites: null,
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "cause": {
      const f = { headline: pick(row, "Causes you care about", "Cause") };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "position":
    case "education":
    case "certification":
    case "language":
    case "skill":
    case "volunteer": {
      const started = parseLinkedInDate(pick(row, "Started On", "Start Date"));
      const finished = parseLinkedInDate(pick(row, "Finished On", "End Date"));
      const isCertification = recordKind === "certification";
      const f = {
        entry_kind: isCertification ? "certification" : recordKind,
        organization_name: pick(row, "Company Name", "School Name", "Authority", "Company / Organization"),
        title: pick(row, "Title", "Degree Name", "Name", "Role", "Language"),
        location: pick(row, "Location"),
        description: pick(row, "Description", "Notes", "Proficiency", "Cause"),
        started_on: started?.value ?? null,
        // For sertifiseringer er «Finished On» utløpsdato når den finnes.
        finished_on: finished?.value ?? null,
        date_precision: started?.precision ?? finished?.precision ?? null,
        credential_id: isCertification ? pick(row, "License Number", "Credential ID") : null,
        credential_url: isCertification
          ? httpUrl(pick(row, "Url", "URL", "Credential URL"))
          : null,
      };

      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "recommendation_received":
    case "recommendation_given": {
      const direction = recordKind.endsWith("received") ? "received" : "given";
      const recommendedOn = parseLinkedInDate(pick(row, "Created On", "Date", "Recommendation Date"))?.value ?? null;
      const f = {
        direction,
        counterpart_name: [pick(row, "First Name"), pick(row, "Last Name")].filter(Boolean).join(" ") || null,
        counterpart_profile_url: pick(row, "URL", "Link", "profileUrl"),
        counterpart_headline: pick(row, "Company", "Job Title"),
        recommendation_text: pick(row, "Text"),
        status: pick(row, "Status", "Endorsement Status"),
        recommended_on: recommendedOn,
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: recommendedOn };
    }
    case "endorsement_received":
    case "endorsement_given": {
      const direction = recordKind.endsWith("received") ? "received" : "given";
      const skillSourceLabel = pick(row, "Skill Name");
      const f = {
        direction,
        skill_source_label: skillSourceLabel,
        skill_canonical_key: skillSourceLabel ? skillSourceLabel.toLowerCase() : null,
        endorser_identity_hash: null,
        observed_at: null,
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "connection":
    case "invitation":
    case "member_follow": {
      // Personkilder. Kun normalisert LinkedIn-URL er stabil personidentitet.
      // Navn uten URL gir en mulig person uten stabil identitet.
      // Selskap, stilling eller kombinasjonen av dem er ALDRI personidentitet.
      const f = {
        full_name:
          [pick(row, "First Name"), pick(row, "Last Name")].filter(Boolean).join(" ") ||
          pick(row, "From", "To", "Name"),
        company: pick(row, "Company", "Organization"),
        position: pick(row, "Position", "Title"),
        connected_on: parseLinkedInDate(pick(row, "Connected On", "Sent At", "Date"))?.value ?? null,
        profile_url: pick(row, "URL", "Link", "profileUrl"),
      };
      const urlKey = normalizeLinkedInProfileUrl(f.profile_url);
      return {
        domainFields: f,
        // Identiteten er URL-en når den finnes; ellers navnet alene.
        identityFields: urlKey
          ? { profile_url: urlKey, full_name: null }
          : { profile_url: null, full_name: f.full_name },
        sourceEventAt: null,
        objectKind: recordKind === "invitation" ? "invitation" : "person_contact",
        hasStableIdentity: Boolean(urlKey),
      };
    }
    case "company_follow":
    case "event":
    case "hashtag_follow":
    case "saved_item": {
      // Ikke-personobjekter. Kan aldri bli kontakter.
      const f = {
        full_name: pick(row, "Organization", "Company", "Name", "HashTag", "Event Name"),
        company: pick(row, "Company", "Organization"),
        position: null,
        connected_on: parseLinkedInDate(pick(row, "Date", "Connected On"))?.value ?? null,
        profile_url: pick(row, "URL", "Link"),
      };
      const objectKind =
        recordKind === "company_follow"
          ? "company_observation"
          : recordKind === "event"
            ? "network_event"
            : recordKind === "hashtag_follow"
              ? "network_preference_signal"
              : "other";
      return {
        domainFields: f,
        identityFields: { full_name: f.full_name, profile_url: f.profile_url },
        sourceEventAt: null,
        objectKind,
        hasStableIdentity: Boolean(f.full_name || f.profile_url),
      };
    }

    case "application":
    case "saved_job":
    case "online_job_posting":
    case "job_alert":
    case "job_seeker_preference": {
      const kind =
        recordKind === "application"
          ? "application"
          : recordKind === "job_alert"
            ? "job_alert"
            : recordKind === "job_seeker_preference"
              ? "job_seeker_preference"
              : "saved_job";
      const f = {
        entry_kind: kind,
        company_name: pick(row, "Company Name", "Company"),
        job_title: pick(row, "Job Title", "Title", "Job Titles"),
        job_url: pick(row, "Job Url", "Job URL", "URL"),
        application_state: pick(row, "Application Status", "Status"),
        event_label: pick(row, "Application Date", "Saved Date", "Location", "Locations"),
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "course": {
      // Rå kildeverdier, kun for statusutledning – aldri lagret rått.
      const rawCompleted = absentAsNull(
        pick(row, "Content Completed At (if completed)", "Completed Date", "Completed On"),
      );
      const rawLastWatched = absentAsNull(
        pick(
          row,
          "Content Last Watched Date (if viewed)",
          "Content Last Watched Date",
          "Last Watched Date",
        ),
      );
      // «Content Description» er aldri URL-kilde.
      const rawUrl = pick(row, "Content URL", "Content Url", "URL", "Url", "Link");

      const completedOn = parseLearningDate(rawCompleted);
      const lastWatchedOn = parseLearningDate(rawLastWatched);

      // Fullført = en faktisk PARSEBAR fullførtdato. «Last Watched» er aldri
      // fullføring, og en ugyldig dato gir ikke fullført status.
      const isCompleted = completedOn != null;
      const codes: string[] = [];
      if (rawCompleted && !completedOn) codes.push("invalid_completion_date");
      if (rawLastWatched && !lastWatchedOn) codes.push("invalid_last_watched_date");
      if (rawUrl && !httpUrl(rawUrl)) codes.push("non_http_url_ignored");
      if (!rawCompleted && !rawLastWatched) codes.push("no_date_in_source");


      const completionStatus = isCompleted
        ? "completed"
        : rawCompleted
          ? "invalid_date"
          : lastWatchedOn
            ? "in_progress"
            : rawLastWatched
              ? "invalid_date"
              : "missing_date";

      const f = {
        content_type: "course",
        course_title: pick(row, "Content Title", "Title"),
        provider: pick(row, "Content Provider", "Provider"),
        completed_on: completedOn,
        last_watched_on: lastWatchedOn,
        is_completed: isCompleted,
        completion_status: completionStatus,
        data_quality_codes: codes,
        // Kun ekte URL-kolonner, og kun når verdien er en gyldig http(s)-URL.
        // «Content Description» brukes aldri som URL-fallback.
        content_url: httpUrl(rawUrl),
        progress_label: isCompleted ? "Fullført" : null,
      };
      return {
        domainFields: f,
        identityFields: {
          course_title: f.course_title,
          provider: f.provider,
          content_url: f.content_url,
        },
        sourceEventAt: null,
      };
    }


    case "rich_media":
    case "article": {
      const f = {
        entry_kind: recordKind === "article" ? "article" : "rich_media",
        title: pick(row, "Title", "Media Caption"),
        content_url: pick(row, "Media Link", "URL", "Link"),
        published_at: parseLinkedInDate(pick(row, "Date", "Published Date"))?.value ?? null,
        media_kind: pick(row, "Media Type", "Type"),
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    default:
      return null;
  }
}

function stringFields(f: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === "string" ? v : null;
  return out;
}

/** «N/A», «-» og tomt betyr fravær av verdi, ikke ugyldig verdi. */
export function absentAsNull(value: string | null): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || /^(n\/?a|na|-|—|none|null)$/i.test(v)) return null;
  return v;
}

/**
 * Learning-datoer kan være «2022-04-05 14:10 UTC» i tillegg til de vanlige
 * LinkedIn-formatene. Returnerer ISO-dato (YYYY-MM-DD) eller null.
 */
export function parseLearningDate(value: string | null): string | null {
  const v = absentAsNull(value);
  if (!v) return null;
  const ts = /^(\d{4})-(\d{2})-(\d{2})[ T]\d{2}:\d{2}/.exec(v);
  if (ts) return `${ts[1]}-${ts[2]}-${ts[3]}`;
  return parseLinkedInDate(v)?.value ?? null;
}
