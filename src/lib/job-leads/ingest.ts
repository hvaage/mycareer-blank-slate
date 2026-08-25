import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ParsedLead } from "@/lib/job-leads/parse";
import {
  hashLeadUrl,
  insertJobLeadDeduped,
  registerLeadForUser,
} from "@/lib/job-leads/insert-job-lead.server";

export type EmailSourceRow = {
  id: string;
  user_id: string;
  source_system: string;
  intake_mode: "mailbox" | "forwarding";
  email_connection_id?: string | null;
};

export type IngestResult = {
  importedJobEmailId: string;
  leadsCreated: number;
  leadsDeduped: number;
  qualificationStatus: "pending" | "qualified" | "needs_review" | "rejected";
  rejectReason?: string | null;
};

const CONFIDENCE_THRESHOLD_REVIEW = 0.5;
const CONFIDENCE_THRESHOLD_REJECT = 0.2;

export async function ingestParsedEmail(params: {
  userId: string;
  emailJobSourceId: string;
  sourceSystem: string;
  intakeMode: "mailbox" | "forwarding";
  emailConnectionId?: string | null;
  providerMessageId: string;
  fromAddress: string;
  toAddress: string;
  subject: string;
  receivedAt: string;
  rawText: string;
  rawHtml: string | null;
  sizeBytes: number;
  parsed: ParsedLead;
  parseConfidence: number;
}): Promise<IngestResult> {
  const {
    userId,
    emailJobSourceId,
    sourceSystem,
    intakeMode,
    emailConnectionId,
    providerMessageId,
    fromAddress,
    toAddress,
    subject,
    receivedAt,
    rawText,
    rawHtml,
    sizeBytes,
    parsed,
    parseConfidence,
  } = params;

  // Determine qualification status from parse confidence and required fields.
  let qualificationStatus: "pending" | "qualified" | "needs_review" | "rejected";
  let rejectReason: string | null = null;

  if (!parsed.title || parsed.title.trim().length < 2) {
    qualificationStatus = "rejected";
    rejectReason = "missing_title";
  } else if (parseConfidence < CONFIDENCE_THRESHOLD_REJECT) {
    qualificationStatus = "rejected";
    rejectReason = "low_confidence";
  } else if (parseConfidence < CONFIDENCE_THRESHOLD_REVIEW) {
    qualificationStatus = "needs_review";
  } else {
    qualificationStatus = "qualified";
  }

  // Insert the raw imported email.
  const { data: importedEmail, error: importError } = await supabaseAdmin
    .from("imported_job_emails")
    .insert({
      user_id: userId,
      email_connection_id: emailConnectionId ?? null,
      email_job_source_id: emailJobSourceId,
      source_system: sourceSystem,
      intake_mode: intakeMode,
      provider_message_id: providerMessageId,
      provider_internal_date: receivedAt,
      from_address: fromAddress,
      to_address: toAddress,
      subject: subject,
      received_at: receivedAt,
      raw_text: rawText,
      raw_html: rawHtml,
      size_bytes: sizeBytes,
      parse_status: "parsed",
      parse_confidence: parseConfidence,
      reject_reason: rejectReason,
      parsed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (importError || !importedEmail) {
    throw new Error(
      `Failed to insert imported_job_email: ${importError?.message ?? "unknown"}`,
    );
  }

  // Insert into job_leads via RPC: dedup håndteres deterministisk i databasen
  // (source_url_hash-indeks + COALESCE-kontrakt på job_url/title/company).
  const urlHash = hashLeadUrl(parsed.job_url);

  let leadsCreated = 0;
  let leadsDeduped = 0;

  const { leadId: insertedId, wasInserted } = await insertJobLeadDeduped(
    supabaseAdmin,
    {
      user_id: userId,
      email_connection_id: emailConnectionId ?? null,
      source_message_id: providerMessageId,
      source_email_from: fromAddress,
      source_subject: subject,
      received_at: receivedAt,
      posted_text: parsed.raw_text,
      title: parsed.title,
      company: parsed.company,
      location: parsed.location,
      work_type: parsed.work_type,
      salary_text: parsed.salary,
      job_url: parsed.job_url,
      raw_snippet: parsed.raw_text.slice(0, 2000),
      source_system: parsed.source_system,
      source_url_hash: urlHash,
      source_observed_at: receivedAt,
      qualification_status: qualificationStatus,
      qualification_score: Math.round(parseConfidence * 100),
      qualification_reason: parsed.reason,
      application_due: parsed.application_due,
      raw_payload: parsed as unknown as Record<string, unknown>,
      parse_confidence: parseConfidence,
      reject_reason: rejectReason,
      imported_job_email_id: importedEmail.id,
    },
  );

  const leadId = wasInserted ? insertedId : null;
  if (wasInserted) {
    leadsCreated = 1;
  } else {
    leadsDeduped = 1;
  }

  if (leadId) {
    await registerLeadForUser(supabaseAdmin, {
      userId,
      source: parsed.source_system,
      priority: 1,
      jobUrl: parsed.job_url,
      title: parsed.title,
      company: parsed.company,
      location: parsed.location,
      refId: leadId,
    });
  }


  // Update lead_count on imported_job_email.
  await supabaseAdmin
    .from("imported_job_emails")
    .update({ lead_count: leadsCreated })
    .eq("id", importedEmail.id)
    .eq("user_id", userId);

  return {
    importedJobEmailId: importedEmail.id,
    leadsCreated,
    leadsDeduped,
    qualificationStatus,
    rejectReason,
  };
}

export function generateInboundAliasToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function base32Encode(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

export function providerMessageId(rawMessageId: string): string {
  return createHash("sha256").update(rawMessageId).digest("hex");
}
