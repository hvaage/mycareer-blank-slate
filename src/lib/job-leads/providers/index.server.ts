import { gmailProvider } from "@/lib/job-leads/providers/gmail.server";
import { outlookProvider } from "@/lib/job-leads/providers/outlook.server";
import type { MailboxProvider } from "@/lib/job-leads/mailbox-provider.server";

export function getMailboxProvider(provider: "google" | "microsoft"): MailboxProvider {
  switch (provider) {
    case "google":
      return gmailProvider;
    case "microsoft":
      return outlookProvider;
    default:
      throw new Error(`Unsupported email provider: ${provider}`);
  }
}
