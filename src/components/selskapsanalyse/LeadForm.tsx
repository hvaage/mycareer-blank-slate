import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { submitLead } from "@/lib/leads.functions";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

function buildLinkedinUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v
    .replace(/^\/+|\/+$/g, "")
    .replace(/^(www\.)?linkedin\.com\/in\//i, "");
  return `https://www.linkedin.com/in/${handle}`;
}

export function LeadForm() {
  const submit = useServerFn(submitLead);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const utmRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const utm: Record<string, string> = {};
    UTM_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) utm[k] = v.slice(0, 120);
    });
    utmRef.current = utm;
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setServerError(null);
    setErrors({});
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const payload = {
      firstName: String(fd.get("firstName") || ""),
      email: String(fd.get("email") || ""),
      linkedinUrl: buildLinkedinUrl(String(fd.get("linkedinHandle") || "")),
      role: String(fd.get("role") || ""),
      consentPrivacy: fd.get("consentPrivacy") === "on",
      consentMarketing: fd.get("consentMarketing") === "on",
      company_website: String(fd.get("company_website") || ""),
      utm: utmRef.current,
    };

    try {
      const res = await submit({ data: payload });
      if (res.ok) setDone(true);
    } catch (err) {
      const msg = (err as Error).message || "Noe gikk galt";
      try {
        const parsed = JSON.parse(msg);
        if (Array.isArray(parsed)) {
          const fieldErrors: Record<string, string> = {};
          parsed.forEach(
            (p: { path: (string | number)[]; message: string }) => {
              if (p.path?.[0]) fieldErrors[String(p.path[0])] = p.message;
            }
          );
          setErrors(fieldErrors);
          return;
        }
      } catch {
        /* ikke json */
      }
      setServerError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-md border border-border bg-muted p-5 text-sm text-foreground">
        <p className="font-medium">Takk! Sjekk e-posten din.</p>
        <p className="mt-1.5 text-muted-foreground">
          Vi har sendt deg en bekreftelse med nedlastingslenke til Claude-ferdigheten.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {/* Honeypot */}
      <div aria-hidden className="hidden">
        <label>
          Company website
          <input
            type="text"
            name="company_website"
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <Field
          label="Fornavn *"
          name="firstName"
          error={errors.firstName}
          required
        />
        <Field
          label="Jobb-e-post *"
          name="email"
          type="email"
          error={errors.email}
          required
          autoComplete="email"
        />
      </div>

      <div>
        <label
          htmlFor="f-linkedinHandle"
          className="block text-sm font-medium text-foreground mb-1.5"
        >
          LinkedIn-profil *
        </label>
        <div
          className={`flex h-11 w-full overflow-hidden rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent ${
            errors.linkedinUrl ? "border-destructive" : "border-border"
          }`}
        >
          <span className="flex items-center pl-3 pr-1 text-sm text-muted-foreground select-none whitespace-nowrap">
            linkedin.com/in/
          </span>
          <input
            id="f-linkedinHandle"
            name="linkedinHandle"
            type="text"
            required
            placeholder="ditt-brukernavn"
            aria-invalid={!!errors.linkedinUrl}
            aria-describedby={
              errors.linkedinUrl ? "f-linkedinHandle-err" : "f-linkedinHandle-help"
            }
            className="flex-1 min-w-0 h-full bg-transparent pr-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>
        <p
          id="f-linkedinHandle-help"
          className="mt-1 text-xs text-muted-foreground"
        >
          Bare siste delen av profil-URLen din — f.eks.{" "}
          <span className="text-foreground">kari-nordmann</span>
        </p>
        {errors.linkedinUrl && (
          <p id="f-linkedinHandle-err" className="mt-1 text-xs text-destructive">
            {errors.linkedinUrl}
          </p>
        )}
      </div>

      <Field
        label="Din rolle (valgfritt)"
        name="role"
        placeholder="Account Executive, gründer, jobbsøker…"
        error={errors.role}
      />

      <div className="space-y-3 pt-1">
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="consentPrivacy"
            required
            className="mt-0.5 h-4 w-4 rounded border-border bg-background accent-primary"
          />
          <span>
            Jeg godtar{" "}
            <a
              href="/privacy"
              className="text-foreground underline-offset-2 hover:underline"
            >
              personvernerklæringen
            </a>
            . *
          </span>
        </label>
        {errors.consentPrivacy && (
          <p className="text-xs text-destructive">{errors.consentPrivacy}</p>
        )}
        <label className="flex items-start gap-3 text-sm text-muted-foreground">
          <input
            type="checkbox"
            name="consentMarketing"
            className="mt-0.5 h-4 w-4 rounded border-border bg-background accent-primary"
          />
          <span>
            Send meg en e-post når Karrierenmin lanserer nye verktøy (valgfritt).
          </span>
        </label>
      </div>

      {serverError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full inline-flex h-11 items-center justify-center rounded-md bg-primary px-5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {submitting ? "Sender…" : "Hent Claude-ferdigheten gratis"}
      </button>
      <p className="text-xs text-muted-foreground text-center">
        Gratis. Ingen betaling eller kortinformasjon nødvendig.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  placeholder,
  error,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
}) {
  const id = `f-${name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-foreground mb-1.5"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-err` : undefined}
        className="w-full h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
      />
      {error && (
        <p id={`${id}-err`} className="mt-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
