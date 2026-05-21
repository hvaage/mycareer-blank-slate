/**
 * Normaliserer et selskaps-domene til en kanonisk form for
 * historikk-aggregering: lowercase, fjerner protokoll, www-prefiks,
 * path, query, og trailing slash.
 */
export function normalizeDomain(input: string | null | undefined): string {
  if (!input) return "";
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "");
  d = d.replace(/^www\./, "");
  d = d.split("/")[0];
  d = d.split("?")[0];
  d = d.replace(/\.+$/, "");
  return d;
}
