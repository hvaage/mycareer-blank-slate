/**
 * Klientlag for KI-analyse av funn fra en CV-import.
 *
 * Ansvar:
 *  - deler et utvalg deterministisk i delbatcher (ingen kandidat i to batcher)
 *  - kjører én delbatch om gangen mot POST /api/cv/propose-cv-atoms
 *  - oversetter alle svar til produkttekst fra den genererte kontrakten
 *
 * Denne modulen definerer ingen egne feil-, readiness- eller verifiseringsstatuser,
 * og eksponerer aldri modellnavn, versjoner, hasher eller interne tabellnavn.
 */
import { supabase } from "@/lib/supabase";
import {
  CV_PROPOSAL_ERROR_CODES,
  CV_PROPOSAL_ERROR_TEXT,
  CV_PROPOSAL_LIMITS,
  CV_PROPOSAL_RETRYABLE_ERROR_CODES,
  type CvProposalErrorCode,
} from "@/lib/cv-skills-contract";

const ENDPOINT = "/api/cv/propose-cv-atoms";

export type AnalysisCandidate = {
  id: string;
  /** Teksten som analyseres. Brukes bare til å beregne størrelsen på delbatchen. */
  text: string;
};

export type AnalysisChunk = {
  index: number;
  candidateIds: string[];
};

export type ChunkOk = {
  ok: true;
  index: number;
  created: number;
  existing: number;
  idempotent: boolean;
};

export type ChunkError = {
  ok: false;
  index: number;
  code: CvProposalErrorCode;
  message: string;
  retryable: boolean;
  /** Sekunder til neste forsøk er tillatt, når serveren oppgir det. */
  retryAfterSeconds: number | null;
};

export type ChunkResult = ChunkOk | ChunkError;

function isKnownCode(value: unknown): value is CvProposalErrorCode {
  return (
    typeof value === "string" &&
    (CV_PROPOSAL_ERROR_CODES as readonly string[]).includes(value)
  );
}

function toErrorCode(status: number, raw: unknown): CvProposalErrorCode {
  if (isKnownCode(raw)) return raw;
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "active_run";
  if (status === 429) return "rate_limited";
  if (status === 504) return "provider_timeout";
  if (status === 502) return "provider_error";
  if (status === 422) return "blocked_validation";
  if (status === 400) return "invalid_body";
  return "database_error";
}

/**
 * Deler utvalget deterministisk. Rekkefølgen er inputrekkefølgen, og hver
 * kandidat havner i nøyaktig én delbatch.
 */
export function planAnalysisChunks(candidates: AnalysisCandidate[]): AnalysisChunk[] {
  const seen = new Set<string>();
  const chunks: AnalysisChunk[] = [];
  let current: string[] = [];
  let chars = 0;

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    const size = candidate.text.length;
    const wouldOverflow =
      current.length >= CV_PROPOSAL_LIMITS.perCall.maxCandidates ||
      (current.length > 0 && chars + size > CV_PROPOSAL_LIMITS.perCall.maxChars);
    if (wouldOverflow) {
      chunks.push({ index: chunks.length, candidateIds: current });
      current = [];
      chars = 0;
    }
    current.push(candidate.id);
    chars += size;
  }
  if (current.length > 0) chunks.push({ index: chunks.length, candidateIds: current });
  return chunks;
}

/** Utvalget er for stort til å kjøres, selv oppdelt. */
export function selectionTooLarge(candidates: AnalysisCandidate[]): boolean {
  const chars = candidates.reduce((n, c) => n + c.text.length, 0);
  return (
    candidates.length > CV_PROPOSAL_LIMITS.perSelection.maxCandidates ||
    chars > CV_PROPOSAL_LIMITS.perSelection.maxChars
  );
}

async function runChunk(args: {
  cvImportId: string;
  chunk: AnalysisChunk;
  regenerate: boolean;
}): Promise<ChunkResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    return {
      ok: false,
      index: args.chunk.index,
      code: "unauthorized",
      message: CV_PROPOSAL_ERROR_TEXT.unauthorized,
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        cvImportId: args.cvImportId,
        candidateIds: args.chunk.candidateIds,
        ...(args.regenerate ? { regenerate: true } : {}),
      }),
    });
  } catch {
    return {
      ok: false,
      index: args.chunk.index,
      code: "network_error",
      message: CV_PROPOSAL_ERROR_TEXT.network_error,
      retryable: true,
      retryAfterSeconds: null,
    };
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  if (response.ok && body["ok"] === true) {
    return {
      ok: true,
      index: args.chunk.index,
      created: Number(body["proposals_created"] ?? 0),
      existing: Number(body["proposals_existing"] ?? body["proposals_skipped"] ?? 0),
      idempotent: body["idempotent"] === true,
    };
  }

  const rawCode = (body["error"] as { code?: unknown } | undefined)?.code;
  const code = toErrorCode(response.status, rawCode);
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : null;
  return {
    ok: false,
    index: args.chunk.index,
    code,
    message: CV_PROPOSAL_ERROR_TEXT[code],
    retryable: (CV_PROPOSAL_RETRYABLE_ERROR_CODES as readonly string[]).includes(code),
    retryAfterSeconds:
      retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
  };
}

/**
 * Kjører delbatchene etter hverandre og rapporterer fremdrift underveis.
 * Stopper ved første feil, slik at brukeren kan prøve igjen fra samme punkt.
 */
export async function runAnalysisChunks(args: {
  cvImportId: string;
  chunks: AnalysisChunk[];
  regenerate?: boolean;
  onProgress?: (done: number, total: number) => void;
}): Promise<{ results: ChunkResult[]; failedAt: number | null }> {
  const results: ChunkResult[] = [];
  for (const chunk of args.chunks) {
    // Regenerering gjelder importen som helhet og bestilles bare på første delbatch.
    const result = await runChunk({
      cvImportId: args.cvImportId,
      chunk,
      regenerate: args.regenerate === true && chunk.index === args.chunks[0]?.index,
    });
    results.push(result);
    args.onProgress?.(results.length, args.chunks.length);
    if (!result.ok) return { results, failedAt: chunk.index };
  }
  return { results, failedAt: null };
}
