import { getLinkedInRedirectUri } from "@/lib/oauth-redirects";

/** Legacy app id; override with `VITE_LINKEDIN_CLIENT_ID` in each deployment. */
const FALLBACK_LINKEDIN_CLIENT_ID = "781n4fqm3ek4gz";

export function getLinkedInClientId(): string {
  const v = import.meta.env.VITE_LINKEDIN_CLIENT_ID as string | undefined;
  return (v?.trim() || FALLBACK_LINKEDIN_CLIENT_ID).trim();
}

export function buildLinkedInAuthorizeUrl(opts?: { state?: string }): string {
  const redirect = getLinkedInRedirectUri();
  if (!redirect) {
    throw new Error("Mangler LinkedIn redirect URI (sett VITE_LINKEDIN_REDIRECT_URI eller bruk appen på et vanlig domene).");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getLinkedInClientId(),
    redirect_uri: redirect,
    scope: "openid profile email",
  });
  if (opts?.state) params.set("state", opts.state);
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

/** Start LinkedIn OAuth in the top window (avoids iframe X-Frame issues). */
export function startLinkedInOAuth(opts?: { state?: string }) {
  const url = buildLinkedInAuthorizeUrl(opts);
  if (typeof window !== "undefined" && window.top && window.top !== window.self) {
    window.top.location.href = url;
  } else if (typeof window !== "undefined") {
    window.location.href = url;
  }
}
