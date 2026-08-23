import type {
  MailboxProvider,
  MailboxProviderConfig,
  MailboxMessage,
  SyncResult,
} from "@/lib/job-leads/mailbox-provider.server";
import { sanitizeEmailAddress, normalizeInternalDate, cleanEmailBody } from "@/lib/job-leads/mailbox-provider.server";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0/me";

export const outlookProvider: MailboxProvider = {
  name: "microsoft",

  async sync(config: MailboxProviderConfig): Promise<SyncResult> {
    const { accessToken, senderPattern, filterQuery, lastSyncedInternalDate } = config;

    const filters: string[] = [];
    if (senderPattern) {
      filters.push(`from/emailAddress/address eq '${senderPattern.replace(/'/g, "''")}'`);
    } else {
      // Default job-ad sender domains. Outlook Graph filter is stricter than Gmail; use contains on address.
      filters.push(
        "(contains(from/emailAddress/address,'linkedin.com') or contains(from/emailAddress/address,'finn.no'))",
      );
    }
    if (filterQuery) {
      // Graph does not support free-text query; only accept simple subject filters here.
      if (filterQuery.toLowerCase().startsWith("subject:")) {
        filters.push(`contains(subject,'${filterQuery.slice(8).replace(/'/g, "''")}')`);
      }
    }
    if (lastSyncedInternalDate) {
      const iso = new Date(lastSyncedInternalDate).toISOString();
      filters.push(`receivedDateTime ge ${iso}`);
    }

    const filter = filters.join(" and ");
    const url = new URL(`${GRAPH_BASE}/messages`);
    url.searchParams.set("$select", "id,receivedDateTime,from,toRecipients,subject,bodyPreview,body");
    url.searchParams.set("$top", "100");
    url.searchParams.set("$filter", filter);
    url.searchParams.set("$orderby", "receivedDateTime asc");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`Outlook list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      value?: OutlookMessage[];
      "@odata.nextLink"?: string;
    };

    const messages: MailboxMessage[] = [];
    let nextInternalDate: string | null = null;

    for (const msg of data.value ?? []) {
      const from = msg.from?.emailAddress?.address ?? "";
      const to = msg.toRecipients?.map((r) => r.emailAddress?.address).filter(Boolean).join(", ") ?? "";
      const internalDate = normalizeInternalDate(msg.receivedDateTime);

      messages.push({
        providerMessageId: msg.id,
        providerInternalDate: internalDate,
        from: sanitizeEmailAddress(from),
        to: sanitizeEmailAddress(to),
        subject: msg.subject ?? "",
        text: cleanEmailBody(msg.body?.contentType === "text" ? (msg.body?.content ?? "") : (msg.bodyPreview ?? "")),
        html: msg.body?.contentType === "html" ? (msg.body?.content ?? null) : null,
        sizeEstimate: (msg.body?.content ?? "").length,
      });

      if (!nextInternalDate || internalDate > nextInternalDate) {
        nextInternalDate = internalDate;
      }
    }

    return {
      messages,
      nextInternalDate,
      tokenRefreshed: false,
      newAccessToken: null,
      newTokenExpiresAt: null,
    };
  },
};

type OutlookAddress = {
  emailAddress?: { address?: string; name?: string } | null;
};

type OutlookMessage = {
  id: string;
  receivedDateTime: string;
  subject?: string;
  from?: OutlookAddress | null;
  toRecipients?: OutlookAddress[] | null;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string } | null;
};
