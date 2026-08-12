// Delt preflight- og statusmodul for edge-funksjoner.
//
// Formål: fjerne stille degradering.
//   1. Manglende konfigurasjon feiler ved oppstart (503) — aldri halvveis arbeid.
//   2. Preflight-feil etterlater spor: der funksjonen har en kjøringstabell,
//      skrives en failed-rad FØR 503 returneres.
//   3. Delvise feil telles og rapporteres (Tally).
//   4. status skiller ok / partial / failed / empty — og ok = status === "ok".
//
// Trinnene er bevisst delt:
//   - LOGGING-variabler: uten disse kan ingen kjøringsrad skrives i det hele tatt.
//     Da er 503 + console.error eneste kanal, og svaret merkes logged: false.
//   - WORK-variabler: her kan vi skrive en failed-kjøringsrad før vi gir opp.

export type PreflightSpec = {
  /** Variabler som kreves for å kunne logge en kjøringsrad (typisk SUPABASE_URL + service role). */
  logging: string[];
  /** Variabler som kreves for å utføre selve arbeidet. */
  work: string[];
};

export type PreflightResult = {
  /** true bare når alt er på plass. */
  ok: boolean;
  /** Manglende logge-variabler — umuliggjør kjøringsrad. */
  missingLogging: string[];
  /** Manglende arbeids-variabler — kjøringsrad kan skrives før 503. */
  missingWork: string[];
  /** Alle manglende variabler, i rekkefølge. */
  missing: string[];
  /** true når vi mangler logge-variabler og derfor ikke kan etterlate spor i databasen. */
  canLog: boolean;
  /** Leste verdier for de variablene som faktisk finnes. */
  env: Record<string, string>;
};

function readEnv(names: string[], env: Record<string, string>): string[] {
  const missing: string[] = [];
  for (const name of names) {
    const value = Deno.env.get(name) ?? "";
    if (value.trim() === "") missing.push(name);
    else env[name] = value;
  }
  return missing;
}

export function preflight(spec: PreflightSpec): PreflightResult {
  const env: Record<string, string> = {};
  const missingLogging = readEnv(spec.logging, env);
  const missingWork = readEnv(spec.work, env);
  return {
    ok: missingLogging.length === 0 && missingWork.length === 0,
    missingLogging,
    missingWork,
    missing: [...missingLogging, ...missingWork],
    canLog: missingLogging.length === 0,
    env,
  };
}

/** Standard feilkropp for preflight-avvisning. HTTP 503 — tjenesten er ikke konfigurert. */
export function preflightFailureBody(
  fnName: string,
  result: PreflightResult,
  extra: { logged: boolean; run_id?: string | null; log_error?: string | null } = { logged: false },
) {
  return {
    ok: false,
    status: "failed" as const,
    error: "missing_configuration",
    error_summary: `missing_configuration: ${result.missing.join(", ")}`,
    function: fnName,
    missing: result.missing,
    missing_logging: result.missingLogging,
    missing_work: result.missingWork,
    // logged: false betyr at fraværet av en kjøringsrad IKKE betyr fravær av kjøring.
    logged: extra.logged,
    run_id: extra.run_id ?? null,
    log_error: extra.log_error ?? null,
  };
}

/** Skriver konsollspor for preflight-feil. Alltid kalt — også når databaselogging er mulig. */
export function logPreflightFailure(fnName: string, result: PreflightResult): void {
  console.error(
    `[${fnName}] preflight failed: missing_configuration`,
    JSON.stringify({
      missing_logging: result.missingLogging,
      missing_work: result.missingWork,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tally — delvise feil skal telles, ikke forsvinne.
// ---------------------------------------------------------------------------

export type RunStatus = "ok" | "empty" | "partial" | "failed";

export type TallySnapshot = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  status: RunStatus;
  /** ok = status === "ok". Aldri status !== "failed". */
  ok: boolean;
  failures: { key: string; reason: string }[];
  failure_reasons: Record<string, number>;
};

export class Tally {
  attempted = 0;
  succeeded = 0;
  failed = 0;
  skipped = 0;
  /** Satt når hele kjøringen er ugyldig uansett tellinger (f.eks. kilde-RPC feilet). */
  fatal: string | null = null;
  private readonly failures: { key: string; reason: string }[] = [];
  private readonly reasonCounts: Record<string, number> = {};

  constructor(private readonly label: string, private readonly maxFailures = 50) {}

  attempt(n = 1): void {
    this.attempted += n;
  }

  succeed(n = 1): void {
    this.succeeded += n;
  }

  skip(n = 1): void {
    this.skipped += n;
  }

  /** Registrer en feil med årsak. Ingen tomme catch — årsaken skal alltid hit. */
  fail(key: string, reason: unknown, code = "error"): void {
    this.failed += 1;
    const text = reason instanceof Error ? reason.message : String(reason ?? "unknown");
    if (this.failures.length < this.maxFailures) this.failures.push({ key, reason: text });
    this.reasonCounts[code] = (this.reasonCounts[code] ?? 0) + 1;
    console.error(`[${this.label}] failure`, JSON.stringify({ key, code, reason: text }));
  }

  /** Uopprettelig feil for hele kjøringen. */
  abort(reason: unknown): void {
    const text = reason instanceof Error ? reason.message : String(reason ?? "unknown");
    this.fatal = text;
    console.error(`[${this.label}] fatal`, JSON.stringify({ reason: text }));
  }

  get status(): RunStatus {
    if (this.fatal) return "failed";
    if (this.failed > 0 && this.succeeded === 0) return "failed";
    if (this.failed > 0) return "partial";
    // Tomt resultat skilles fra vellykket resultat med innhold.
    if (this.attempted === 0) return "empty";
    return "ok";
  }

  snapshot(): TallySnapshot {
    const status = this.status;
    return {
      attempted: this.attempted,
      succeeded: this.succeeded,
      failed: this.failed,
      skipped: this.skipped,
      status,
      ok: status === "ok",
      failures: this.failures,
      failure_reasons: this.reasonCounts,
    };
  }

  /** Kort tekst egnet for error_summary-kolonner. null når ingenting feilet. */
  errorSummary(): string | null {
    if (this.fatal) return `system_error: ${this.fatal}`;
    if (this.failed === 0) return null;
    const parts = Object.entries(this.reasonCounts).map(([code, n]) => `${code}=${n}`);
    return `partial_failure: ${this.failed}/${this.attempted} (${parts.join(", ")})`;
  }
}

/** Kombiner flere delstatuser til én kjøringsstatus. */
export function combineStatus(statuses: RunStatus[]): RunStatus {
  if (statuses.length === 0) return "empty";
  if (statuses.includes("failed") && statuses.every((s) => s === "failed" || s === "empty")) {
    return "failed";
  }
  if (statuses.some((s) => s === "failed" || s === "partial")) return "partial";
  if (statuses.every((s) => s === "empty")) return "empty";
  return "ok";
}
