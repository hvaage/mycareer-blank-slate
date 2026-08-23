import type {
  MailboxProvider,
  MailboxProviderConfig,
  MailboxMessage,
  SyncResult,
} from "@/lib/job-leads/mailbox-provider.server";
import { sanitizeEmailAddress, normalizeInternalDate, cleanEmailBody } from "@/lib/job-leads/mailbox-provider.server";

const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export const gmailProvider: MailboxProvider = {
  name: "google",

  async sync(config: MailboxProviderConfig): Promise<SyncResult> {
    const { accessToken, senderPattern, filterQuery, lastSyncedInternalDate } = config;

    const queryParts: string[] = [];
    if (senderPattern) {
      queryParts.push(`from:(${senderPattern})`);
    } else {
      // Default job-ad sender patterns. Gmail supports OR inside parentheses.
      queryParts.push(
        "from:(jobs-noreply@linkedin.com OR jobs-listings@linkedin.com OR jobbsok@finn.no OR noreply@finn.no)",
      );
    }
    if (filterQuery) queryParts.push(filterQuery);
    if (lastSyncedInternalDate) {
      const afterEpoch = Math.floor(new Date(lastSyncedInternalDate).getTime() / 1000);
      queryParts.push(`after:${afterEpoch}`);
    }

    const query = queryParts.join(" ");
    const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
    listUrl.searchParams.set("q", query);
    listUrl.searchParams.set("maxResults", "100");

    const listRes = await fetch(listUrl.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!listRes.ok) {
      throw new Error(`Gmail list failed: ${listRes.status} ${await listRes.text()}`);
    }
    const listData = (await listRes.json()) as {
      messages?: Array<{ id: string; threadId: string }>;
      resultSizeEstimate?: number;
    };

    const messages: MailboxMessage[] = [];
    let nextInternalDate: string | null = null;

    for (const msg of listData.messages ?? []) {
      const detail = await fetchMessage(accessToken, msg.id);
      if (!detail) continue;
      messages.push(detail);
      if (!nextInternalDate || detail.providerInternalDate > nextInternalDate) {
        nextInternalDate = detail.providerInternalDate;
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

async function fetchMessage(accessToken: string, messageId: string): Promise<MailboxMessage | null> {
  const url = new URL(`${GMAIL_API_BASE}/messages/${messageId}`);
  url.searchParams.set("format", "full");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    // Best-effort: skip messages we cannot read.
    console.warn(`[gmail] skipped message ${messageId}: ${res.status}`);
    return null;
  }

  const payload = (await res.json()) as GmailMessage;
  const headers = payload.payload?.headers ?? [];

  const getHeader = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

  const from = getHeader("from");
  const to = getHeader("to");
  const subject = getHeader("subject");
  const internalDate = normalizeInternalDate(payload.internalDate ?? "0");

  const { text, html } = extractBody(payload.payload);
  const sizeEstimate = payload.sizeEstimate ?? 0;

  return {
    providerMessageId: payload.id,
    providerInternalDate: internalDate,
    from: sanitizeEmailAddress(from),
    to: sanitizeEmailAddress(to || configPlaceholder(to, "to")),
    subject,
    text: cleanEmailBody(text),
    html,
    sizeEstimate,
  };
}

// Extract plain text and html from Gmail payload recursively.
function extractBody(payload?: GmailPayload): { text: string; html: string | null } {
  if (!payload) return { text: "", html: null };

  const textParts: string[] = [];
  const htmlParts: string[] = [];

  const walk = (part: GmailPayload) => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      textParts.push(decodeBase64Url(part.body.data));
    } else if (part.mimeType === "text/html" && part.body?.data) {
      htmlParts.push(decodeBase64Url(part.body.data));
    } else if (part.parts) {
      for (const child of part.parts) walk(child);
    }
  };

  walk(payload);
  return {
    text: textParts.join("\n"),
    html: htmlParts.length ? htmlParts.join("\n") : null,
  };
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function configPlaceholder(value: string, _field: string): string {
  return value || "unknown@example.com";
}

type GmailHeader = { name: string; value: string };

type GmailBody = {
  data?: string;
  size?: number;
};

type GmailPayload = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPayload[];
};

type GmailMessage = {
  id: string;
  threadId: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPayload;
};
