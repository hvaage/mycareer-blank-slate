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

export type JobBlockProgress = {
  phase: "appointments" | "block_content" | "consolidate";
  block_key: string;
  label: string;
  status: "queued" | "running" | "complete" | "needs_review" | "failed";
  error_code: string | null;
};

export type JobOutcome = {
  status: "complete" | "partial" | "failed";
  proposalsCreated: number;
  failedBlocks: { label: string }[];
};

export type JobError = { message: string; retryable: boolean };

const ERROR_TEXT: Record<string, string> = {
  unauthorized: "Du må være logget inn for å kjøre analysen.",
  not_found: "Vi fant ikke importen.",
  no_candidates: "Det er ingen funn å analysere i denne importen.",
  invalid_candidates: "Utvalget hører ikke til denne importen.",
  too_many_candidates: "Utvalget er for stort til én analyse.",
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
 * Kjører jobben videre steg for steg til den er ferdig. Hvert steg gjør et
 * begrenset antall samtidige kall på serveren, og gir oppdatert blokkstatus.
 */
export async function runAtomizationJob(args: {
  jobId: string;
  onProgress?: (blocks: JobBlockProgress[]) => void;
  maxSteps?: number;
}): Promise<{ outcome: JobOutcome } | { error: JobError }> {
  const maxSteps = args.maxSteps ?? 40;
  for (let step = 0; step < maxSteps; step += 1) {
    let response: Response;
    try {
      response = await authedFetch(`/api/cv/atomization-jobs/${args.jobId}`, { method: "POST" });
    } catch {
      return { error: { message: ERROR_TEXT["network_error"]!, retryable: true } };
    }
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || body["ok"] !== true) return { error: toError(body, response.status) };

    if (Array.isArray(body["blocks"])) {
      args.onProgress?.(body["blocks"] as JobBlockProgress[]);
    }
    if (body["done"] === true) {
      return {
        outcome: {
          status: (body["job_status"] as JobOutcome["status"]) ?? "complete",
          proposalsCreated: Number(body["proposals_created"] ?? 0),
          failedBlocks: ((body["failed_blocks"] as { label?: string }[] | undefined) ?? []).map(
            (b) => ({ label: b.label ?? "Ukjent del" }),
          ),
        },
      };
    }
  }
  return { error: { message: "Analysen tok for lang tid. Prøv igjen.", retryable: true } };
}

export function jobProgressPercent(blocks: JobBlockProgress[]): number {
  if (blocks.length === 0) return 0;
  const done = blocks.filter((b) => b.status !== "queued" && b.status !== "running").length;
  return Math.round((done / blocks.length) * 100);
}
