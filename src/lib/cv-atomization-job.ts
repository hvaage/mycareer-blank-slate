/**
 * Klientlag for den asynkrone CV-analysen.
 *
 * Analysen kjøres som en jobb med planlagte blokker: først ansettelsesforløp,
 * så innhold per rolle, til slutt en samling av kompetanser. Klienten starter
 * jobben og ber om ett steg om gangen, slik at fremdriften er synlig underveis.
 *
 * Modulen viser aldri modellnavn, versjoner eller interne tabellnavn.
 */
import { supabase } from "@/lib/supabase";
import { CV_ATOMIZATION_JOB_LIMITS } from "@/lib/cv-skills-contract";

/**
 * Grensene som gjelder den aktive analysen (jobbruten). Den eldre engangsruten
 * har egne, lavere grenser og brukes ikke i denne brukerreisen — derfor skal
 * UI aldri vise en felles grense for begge.
 */
export const ACTIVE_ANALYSIS_LIMITS = CV_ATOMIZATION_JOB_LIMITS.perJob;

export type AnalysisSelectionItem = { id: string; text: string };

/** Sant når utvalget er større enn det den aktive analysen godtar. */
export function analysisSelectionTooLarge(items: AnalysisSelectionItem[]): boolean {
  const chars = items.reduce((n, item) => n + item.text.length, 0);
  return (
    items.length > ACTIVE_ANALYSIS_LIMITS.maxCandidates ||
    chars > ACTIVE_ANALYSIS_LIMITS.maxChars
  );
}

export type JobBlockProgress = {
  phase: "appointments" | "block_content" | "skill_evidence" | "consolidate";
  block_key: string;
  label: string;
  status: "queued" | "running" | "complete" | "needs_review" | "failed";
  error_code: string | null;
};

export type JobOutcome = {
  status: "complete" | "partial" | "failed" | "cancelled";
  proposalsCreated: number;
  failedBlocks: { label: string }[];
  /** Blokker som ikke ble ferdige (avbrutt eller feilet) — kan startes igjen. */
  unfinishedBlocks: { label: string; status: JobBlockProgress["status"] }[];
  blocks: JobBlockProgress[];
};


export type JobError = { message: string; retryable: boolean };

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Du må være logget inn for å kjøre analysen.",
  not_found: "Vi fant ikke importen.",
  no_candidates: "Det er ingen funn å analysere i denne importen.",
  invalid_candidates: "Utvalget hører ikke til denne importen.",
  too_many_candidates: "Utvalget er for stort til én analyse.",
  input_too_large: "Utvalget er for stort til én analyse.",
  server_misconfigured: "Analysen er ikke tilgjengelig akkurat nå.",
  database_error: "Noe gikk galt. Prøv igjen.",
  network_error: "Vi mistet kontakten. Prøv igjen.",
};

const RETRYABLE = new Set(["database_error", "network_error", "server_misconfigured"]);

async function authedFetch(url: string, init: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error(ERROR_TEXT["unauthorized"]), { retryable: false });
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

function toError(body: Record<string, unknown>, status: number): JobError {
  const code = (body["error"] as { code?: string } | undefined)?.code ?? String(status);
  return {
    message: ERROR_TEXT[code] ?? ERROR_TEXT["database_error"]!,
    retryable: RETRYABLE.has(code) || status >= 500,
  };
}

/** Starter en jobb (eller gjenbruker en identisk kjøring) og returnerer jobb-id. */
export async function startAtomizationJob(args: {
  cvImportId: string;
  candidateIds?: string[];
  regenerate?: boolean;
}): Promise<{ jobId: string } | { error: JobError }> {
  let response: Response;
  try {
    response = await authedFetch("/api/cv/atomization-jobs", {
      method: "POST",
      body: JSON.stringify({
        cvImportId: args.cvImportId,
        ...(args.candidateIds?.length ? { candidateIds: args.candidateIds } : {}),
        ...(args.regenerate ? { regenerate: true } : {}),
      }),
    });
  } catch (err) {
    return { error: { message: (err as Error).message, retryable: false } };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body["ok"] !== true) return { error: toError(body, response.status) };
  return { jobId: body["job_id"] as string };
}

/**
 * Avbryter en pågående analyse server-side. Jobben settes i en terminal
 * tilstand slik at arbeideren ikke gjør flere modellkall. Ferdige deler
 * beholdes; import, fil og analysegrunnlag slettes aldri.
 */
export async function cancelAtomizationJob(jobId: string): Promise<{ ok: true } | { error: JobError }> {
  let response: Response;
  try {
    response = await authedFetch(`/api/cv/atomization-jobs/${jobId}`, { method: "DELETE" });
  } catch {
    return { error: { message: ERROR_TEXT["network_error"]!, retryable: true } };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body["ok"] !== true) return { error: toError(body, response.status) };
  return { ok: true };
}

/** Starter en avbrutt eller delvis jobb igjen. Ferdige deler kjøres ikke på nytt. */
export async function resumeAtomizationJob(jobId: string): Promise<{ ok: true } | { error: JobError }> {
  let response: Response;
  try {
    response = await authedFetch(`/api/cv/atomization-jobs/${jobId}`, {
      method: "POST",
      body: JSON.stringify({ resume: true }),
    });
  } catch {
    return { error: { message: ERROR_TEXT["network_error"]!, retryable: true } };
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || body["ok"] !== true) return { error: toError(body, response.status) };
  return { ok: true };
}


/**
 * Følger jobben med rene lesekall. Selve analysen kjøres av en bakgrunns-
 * tjeneste, ikke av nettleseren: statuskallene skriver aldri, og analysen
 * fortsetter selv om siden lukkes eller lastes på nytt. Har jobben stått
 * stille en stund, sendes ett vekkesignal (ingen analyse i selve kallet).
 */
export async function followAtomizationJob(args: {
  jobId: string;
  onProgress?: (blocks: JobBlockProgress[]) => void;
  onStatus?: (status: { stalled: boolean; jobStatus: string }) => void;
  pollMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<{ outcome: JobOutcome } | { error: JobError }> {
  const pollMs = args.pollMs ?? 2_500;
  const deadline = Date.now() + (args.timeoutMs ?? 15 * 60_000);
  let lastResumeAt = 0;

  while (Date.now() < deadline) {
    if (args.signal?.aborted) return { error: { message: "Avbrutt.", retryable: true } };
    let response: Response;
    try {
      response = await authedFetch(`/api/cv/atomization-jobs/${args.jobId}`, { method: "GET" });
    } catch {
      return { error: { message: ERROR_TEXT["network_error"]!, retryable: true } };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || body["ok"] !== true) return { error: toError(body, response.status) };

    if (Array.isArray(body["blocks"])) {
      args.onProgress?.(body["blocks"] as JobBlockProgress[]);
    }
    const jobStatus = String(body["job_status"] ?? "queued");
    args.onStatus?.({ stalled: body["stalled"] === true, jobStatus });

    if (body["done"] === true) {
      const job = (body["job"] ?? {}) as Record<string, unknown>;
      const metrics = (job["metrics"] ?? {}) as Record<string, unknown>;
      const failed = (metrics["failed_blocks"] as { label?: string }[] | undefined) ?? [];
      const blocks = (Array.isArray(body["blocks"]) ? body["blocks"] : []) as JobBlockProgress[];
      const unfinished = blocks
        .filter((b) => b.status === "queued" || b.status === "running" || b.status === "failed")
        .map((b) => ({ label: b.label, status: b.status }));
      return {
        outcome: {
          status: (jobStatus as JobOutcome["status"]) ?? "complete",
          proposalsCreated: Number(metrics["proposals_created"] ?? 0),
          failedBlocks:
            failed.length > 0
              ? failed.map((b) => ({ label: b.label ?? "Ukjent del" }))
              : blocks.filter((b) => b.status === "failed").map((b) => ({ label: b.label })),
          unfinishedBlocks: unfinished,
          blocks,
        },
      };
    }


    // Gjenopptakelse: ett signal per 60 sekunder, aldri modellarbeid herfra.
    if (body["resumable"] === true && Date.now() - lastResumeAt > 60_000) {
      lastResumeAt = Date.now();
      try {
        await authedFetch(`/api/cv/atomization-jobs/${args.jobId}`, { method: "POST" });
      } catch {
        // Bakgrunnstjenesten plukker jobben opp uansett.
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return {
    error: {
      message: "Analysen tar lengre tid enn vanlig. Den fortsetter i bakgrunnen — kom tilbake litt senere.",
      retryable: true,
    },
  };
}


export function jobProgressPercent(blocks: JobBlockProgress[]): number {
  if (blocks.length === 0) return 0;
  const done = blocks.filter((b) => b.status !== "queued" && b.status !== "running").length;
  return Math.round((done / blocks.length) * 100);
}
