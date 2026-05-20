import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const LeadSchema = z.object({
  firstName: z.string().trim().min(1, "Fornavn er påkrevd").max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Oppgi en gyldig e-postadresse")
    .max(255),
  linkedinUrl: z
    .string()
    .trim()
    .min(1, "LinkedIn-URL er påkrevd")
    .max(300)
    .refine(
      (v) => /^https?:\/\/(www\.)?linkedin\.com\//i.test(v),
      "Må være en LinkedIn-URL"
    ),
  role: z.string().trim().max(120).optional().or(z.literal("")),
  consentPrivacy: z.literal(true, {
    errorMap: () => ({ message: "Du må godta personvernerklæringen" }),
  }),
  consentMarketing: z.boolean().default(false),
  utm: z
    .object({
      utm_source: z.string().max(120).optional(),
      utm_medium: z.string().max(120).optional(),
      utm_campaign: z.string().max(120).optional(),
      utm_content: z.string().max(120).optional(),
      utm_term: z.string().max(120).optional(),
    })
    .partial()
    .optional(),
  // Honeypot
  company_website: z.string().max(0).optional().or(z.literal("")),
});

export type SubmitLeadInput = z.input<typeof LeadSchema>;

async function sendLeadEmails(opts: {
  firstName: string;
  email: string;
  linkedinUrl: string;
  role: string | null;
  accessToken: string;
}) {
  try {
    const { sendTransactionalInternal } = await import(
      "@/lib/email/send-internal.server"
    );

    await sendTransactionalInternal({
      templateName: "selskapsanalyse-bekreftelse",
      recipientEmail: opts.email,
      idempotencyKey: `selskapsanalyse-bekreftelse-${opts.email}`,
      templateData: { firstName: opts.firstName, token: opts.accessToken },
    });

    await sendTransactionalInternal({
      templateName: "selskapsanalyse-admin-varsel",
      idempotencyKey: `selskapsanalyse-admin-${opts.email}-${Date.now()}`,
      templateData: {
        firstName: opts.firstName,
        email: opts.email,
        linkedinUrl: opts.linkedinUrl,
        role: opts.role,
      },
    });
  } catch (e) {
    console.warn("[submitLead] email send skipped/failed", (e as Error).message);
  }
}


export const submitLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LeadSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.company_website) {
      return { ok: true, accessToken: null as string | null };
    }

    const userAgent = getRequestHeader("user-agent") || null;

    const { data: inserted, error } = await supabaseAdmin
      .from("leads")
      .insert({
        first_name: data.firstName,
        email: data.email,
        linkedin_url: data.linkedinUrl,
        role: data.role || null,
        consent_privacy: data.consentPrivacy,
        consent_marketing: data.consentMarketing,
        source: "selskapsanalyse",
        utm_source: data.utm?.utm_source || null,
        utm_medium: data.utm?.utm_medium || null,
        utm_campaign: data.utm?.utm_campaign || null,
        utm_content: data.utm?.utm_content || null,
        utm_term: data.utm?.utm_term || null,
        metadata: { user_agent: userAgent },
        status: "new",
      })
      .select("id, access_token, email, first_name, linkedin_url, role")
      .single();

    if (error) {
      // Duplicate email: return the existing access_token so the user can still unlock the download
      if ((error as { code?: string }).code === "23505") {
        const { data: existing } = await supabaseAdmin
          .from("leads")
          .select("id, access_token, email, first_name, linkedin_url, role, email_sent_at")
          .eq("email", data.email)
          .maybeSingle();
        if (existing) {
          if (!existing.email_sent_at) {
            await sendLeadEmails({
              firstName: existing.first_name,
              email: existing.email,
              linkedinUrl: existing.linkedin_url,
              role: existing.role,
              accessToken: existing.access_token as string,
            });

            await supabaseAdmin
              .from("leads")
              .update({ email_sent_at: new Date().toISOString(), status: "emailed" })
              .eq("id", existing.id);
          }
          return { ok: true, accessToken: existing.access_token as string };
        }
      }
      console.error("[submitLead] insert error", error);
      throw new Error("Kunne ikke lagre detaljene dine. Prøv igjen.");
    }

    await sendLeadEmails({
      firstName: inserted.first_name,
      email: inserted.email,
      linkedinUrl: inserted.linkedin_url,
      role: inserted.role,
      accessToken: inserted.access_token as string,
    });

    await supabaseAdmin
      .from("leads")
      .update({ email_sent_at: new Date().toISOString(), status: "emailed" })
      .eq("id", inserted.id);

    return { ok: true, accessToken: inserted.access_token as string };
  });

const TrackSchema = z.object({
  accessToken: z.string().uuid(),
  type: z.enum(["connect_click", "follow_click", "download"]),
});

export const trackLeadEvent = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => TrackSchema.parse(data))
  .handler(async ({ data }) => {
    const { data: lead } = await supabaseAdmin
      .from("leads")
      .select("id")
      .eq("access_token", data.accessToken)
      .maybeSingle();
    if (!lead) return { ok: false };

    await supabaseAdmin.from("lead_events").insert({
      lead_id: lead.id,
      event_type: data.type,
      event_meta: {},
    });

    const now = new Date().toISOString();
    const patch: Record<string, string> = {};
    if (data.type === "connect_click") patch.connect_clicked_at = now;
    else if (data.type === "follow_click") patch.follow_clicked_at = now;
    else if (data.type === "download") patch.downloaded_at = now;

    if (Object.keys(patch).length) {
      await supabaseAdmin.from("leads").update(patch).eq("id", lead.id);
    }
    return { ok: true };
  });
