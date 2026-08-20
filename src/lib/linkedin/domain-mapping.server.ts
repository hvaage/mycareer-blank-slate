// Serveronly: hvitlistet felt-mapping fra LinkedIn-CSV til domenestaging.
// Ingen rå CSV-rad lagres; kun navngitte felt per record_kind.

import type { LinkedInStagingDomain } from "./contract";
import { normalizeText, parseLinkedInDate } from "./normalize.server";

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

export type MappedRecord = {
  domainFields: Record<string, unknown>;
  /** Felter som inngår i identitetshashen. */
  identityFields: Record<string, string | null>;
  sourceEventAt: string | null;
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
      const f = {
        entry_kind: recordKind === "certification" ? "certification" : recordKind,
        organization_name: pick(row, "Company Name", "School Name", "Authority", "Company / Organization"),
        title: pick(row, "Title", "Degree Name", "Name", "Role", "Language"),
        location: pick(row, "Location"),
        description: pick(row, "Description", "Notes", "Proficiency", "Cause"),
        started_on: started?.value ?? null,
        finished_on: finished?.value ?? null,
        date_precision: started?.precision ?? finished?.precision ?? null,
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "recommendation_received":
    case "recommendation_given":
    case "endorsement_received":
    case "endorsement_given": {
      const f = {
        direction: recordKind.endsWith("received") ? "received" : "given",
        counterpart_name: [pick(row, "First Name"), pick(row, "Last Name")].filter(Boolean).join(" ") || null,
        counterpart_headline: pick(row, "Company", "Job Title", "Skill Name"),
        recommendation_text: pick(row, "Text"),
        status: pick(row, "Status", "Endorsement Status"),
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
    }
    case "connection":
    case "invitation":
    case "company_follow":
    case "event":
    case "hashtag_follow":
    case "member_follow":
    case "saved_item": {
      const f = {
        full_name:
          [pick(row, "First Name"), pick(row, "Last Name")].filter(Boolean).join(" ") ||
          pick(row, "From", "To", "Organization", "Name", "HashTag", "Event Name"),
        company: pick(row, "Company", "Organization"),
        position: pick(row, "Position", "Title"),
        connected_on: parseLinkedInDate(pick(row, "Connected On", "Sent At", "Date"))?.value ?? null,
        profile_url: pick(row, "URL", "Link", "profileUrl"),
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
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
      const f = {
        course_title: pick(row, "Content Title", "Title"),
        provider: pick(row, "Content Provider", "Provider"),
        completed_on: parseLinkedInDate(pick(row, "Content Last Watched Date", "Completed Date"))?.value ?? null,
        content_url: pick(row, "Content Description", "Content URL", "URL"),
        progress_label: pick(row, "Content Completed At (if completed)", "Notes"),
      };
      return { domainFields: f, identityFields: stringFields(f), sourceEventAt: null };
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
