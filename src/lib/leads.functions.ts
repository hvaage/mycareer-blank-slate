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

export const submitLead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => LeadSchema.parse(data))
  .handler(async ({ data }) => {
    if (data.company_website) {
      return { ok: true };
    }

    const userAgent = getRequestHeader("user-agent") || null;

    const { error } = await supabaseAdmin.from("leads").insert({
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
    });

    if (error) {
      // Duplicate email: treat as success — user already in our list
      if ((error as { code?: string }).code === "23505") {
        return { ok: true, duplicate: true };
      }
      console.error("[submitLead] insert error", error);
      throw new Error("Kunne ikke lagre detaljene dine. Prøv igjen.");
    }

    // Send confirmation + admin notification via Lovable Emails (internal helper —
    // bypasses HTTP roundtrip and JWT auth since this is a public form trigger).
    try {
      const { sendTransactionalInternal } = await import(
        '@/lib/email/send-internal.server'
      );

      await sendTransactionalInternal({
        templateName: 'selskapsanalyse-bekreftelse',
        recipientEmail: data.email,
        idempotencyKey: `selskapsanalyse-bekreftelse-${data.email}`,
        templateData: { firstName: data.firstName },
      });

      await sendTransactionalInternal({
        templateName: 'selskapsanalyse-admin-varsel',
        idempotencyKey: `selskapsanalyse-admin-${data.email}-${Date.now()}`,
        templateData: {
          firstName: data.firstName,
          email: data.email,
          linkedinUrl: data.linkedinUrl,
          role: data.role || null,
        },
      });
    } catch (e) {
      console.warn("[submitLead] email send skipped/failed", (e as Error).message);
    }

    return { ok: true };
  });
