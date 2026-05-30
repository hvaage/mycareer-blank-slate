// @ts-nocheck
import { format, formatDistanceToNow, parseISO, isValid } from "date-fns";
import { nb } from "date-fns/locale";

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  if (!isValid(date)) return "—";
  return format(date, "dd.MM.yyyy", { locale: nb });
}

export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  if (!isValid(date)) return "—";
  return format(date, "dd.MM.yyyy HH:mm", { locale: nb });
}

export function fmtRelative(d: string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? parseISO(d) : d;
  if (!isValid(date)) return "—";
  return formatDistanceToNow(date, { addSuffix: true, locale: nb });
}
