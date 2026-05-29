// deno-lint-ignore-file no-explicit-any
// Parse an uploaded CV (PDF or DOCX) using the configured AI provider and store the structured
// output in cv_imports.raw_parsed_data. No atom conversion in this sprint.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import mammoth from "https://esm.sh/mammoth@1.6.0";
import { SYSTEM_PROMPT_PARSE_CV, USER_PROMPT_PARSE_CV } from "./parse-prompt.ts";
import { validateParsedCv } from "./schema.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

type SourceFormat = "pdf" | "docx";

interface RequestBody {
  file_path?: string;
  source_format?: SourceFormat;
  import_id?: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Shared AI call + DB finalize (after file is in memory). */
async function parseCvPipeline(
  supabase: any,
  userId: string,
  importId: string,
  fileBuffer: ArrayBuffer,
  sourceFormat: SourceFormat,
): Promise<Response> {
  const markFailed = async (errorMessage: string) => {
    await supabase
      .from("cv_imports")
      .update({
        status: "failed",
        error_message: errorMessage.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("user_id", userId);
  };

  try {
    if (fileBuffer.byteLength > MAX_FILE_BYTES) {
      await markFailed(`file_too_large: ${fileBuffer.byteLength} bytes`);
      return jsonError(
        "file_too_large",
        "Filen er for stor (maks 10 MB).",
        413,
        importId,
      );
    }

    let contentBlocks: any[];
    if (sourceFormat === "pdf") {
      const base64Pdf = chunkedBase64(fileBuffer);
      contentBlocks = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
        },
        { type: "text", text: USER_PROMPT_PARSE_CV },
      ];
    } else {
      let text: string;
      try {
        const result = await mammoth.extractRawText({
          buffer: new Uint8Array(fileBuffer),
        });
        text = result.value ?? "";
      } catch (e) {
        await markFailed(
          `docx_parse_error: ${e instanceof Error ? e.message : String(e)}`,
        );
        return jsonError(
          "docx_parse_error",
          "Kunne ikke lese DOCX-filen.",
          422,
          importId,
        );
      }
      if (!text.trim()) {
        await markFailed("docx_parse_error: empty text extracted");
        return jsonError(
          "docx_parse_error",
          "DOCX-filen inneholdt ingen tekst.",
          422,
          importId,
        );
      }
      contentBlocks = [
        {
          type: "text",
          text: `Innhold fra CV-dokumentet:\n\n${text}\n\n${USER_PROMPT_PARSE_CV}`,
        },
      ];
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      await markFailed("ANTHROPIC_API_KEY missing");
      return jsonError(
        "claude_api_error",
        "Server-konfigurasjon mangler.",
        500,
        importId,
      );
    }

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT_PARSE_CV,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("parse-uploaded-cv AI HTTP error", aiRes.status, t);
      await markFailed(`claude_api_error ${aiRes.status}: ${t.slice(0, 500)}`);
      return jsonError(
        "claude_api_error",
        "AI-tjenesten returnerte en feil. Prøv igjen om litt, eller bruk en mindre fil.",
        502,
        importId,
      );
    }

    const aiJson = await aiRes.json();
    const fullText: string = (Array.isArray(aiJson?.content) ? aiJson.content : [])
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("\n")
      .trim();

    if (!fullText) {
      await markFailed("claude returned empty text");
      return jsonError(
        "parsing_failed",
        "AI-tjenesten returnerte tomt svar.",
        500,
        importId,
      );
    }

    let parsedRaw: unknown;
    try {
      parsedRaw = extractJson(fullText);
    } catch (e) {
      await markFailed(
        `parsing_failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      return jsonError(
        "parsing_failed",
        "Kunne ikke tolke AI-svaret som JSON.",
        500,
        importId,
      );
    }

    let parsed;
    try {
      parsed = validateParsedCv(parsedRaw);
    } catch (e) {
      await markFailed(
        `schema_invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
      return jsonError(
        "schema_invalid",
        `Skjema-validering feilet: ${
          e instanceof Error ? e.message : String(e)
        }`,
        500,
        importId,
      );
    }

    const { error: updateError } = await supabase
      .from("cv_imports")
      .update({
        raw_parsed_data: parsed as any,
        atoms_created_count: 0,
        status: "parsed",
        parsed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("user_id", userId);

    if (updateError) {
      console.error("Failed to update cv_imports:", updateError);
      await markFailed(`database_error: ${updateError.message}`);
      return jsonError(
        "database_error",
        "Kunne ikke lagre parsed data.",
        500,
        importId,
      );
    }

    const atoms_preview_count =
      (parsed.experience?.length ?? 0) +
      (parsed.education?.length ?? 0) +
      (parsed.skills?.length ?? 0) +
      (parsed.languages?.length ?? 0) +
      (parsed.certifications?.length ?? 0);

    return jsonResponse({ import_id: importId, status: "parsed", atoms_preview_count });
  } catch (e) {
    console.error("Unexpected error in parseCvPipeline:", e);
    await markFailed(
      `unexpected: ${e instanceof Error ? e.message : String(e)}`,
    );
    return jsonError(
      "internal_error",
      "Uventet feil under parsing.",
      500,
      importId,
    );
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonError(
  error: string,
  message: string,
  status: number,
  import_id: string | null = null,
): Response {
  return jsonResponse({ error, message, import_id }, status);
}

function chunkedBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Small chunks — String.fromCharCode.apply with large arrays can exceed engine stack limits
  // and appear as a hung edge function on big PDFs.
  const CHUNK = 1024;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length);
    let part = "";
    for (let j = i; j < end; j++) part += String.fromCharCode(bytes[j]!);
    binary += part;
  }
  return btoa(binary);
}

function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(candidate.slice(first, last + 1));
    }
    throw new Error("Kunne ikke finne gyldig JSON i AI-svaret");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return jsonError("method_not_allowed", "Bruk POST.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonError("unauthorized", "Du må være innlogget.", 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError("unauthorized", "Du må være innlogget.", 401);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid_input", "Kunne ikke lese JSON-body.", 400);
  }

  const importIdParam =
    typeof body.import_id === "string" && UUID_RE.test(body.import_id.trim())
      ? body.import_id.trim()
      : null;

  // ----- Mode A: parse existing import (upload already done, row status pending/failed) -----
  if (importIdParam) {
    const { data: row, error: fetchErr } = await supabase
      .from("cv_imports")
      .select("*")
      .eq("id", importIdParam)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchErr || !row) {
      return jsonError("not_found", "Fant ikke import-raden.", 404, importIdParam);
    }

    const st = String(row.status ?? "");
    if (st !== "pending" && st !== "failed") {
      return jsonError(
        "invalid_status",
        `Kan ikke starte analyse — forventet status «pending» eller «failed», fikk «${st}».`,
        400,
        importIdParam,
      );
    }

    const rawPath = row.source_file_path as string | null;
    if (!rawPath) {
      return jsonError("invalid_input", "Import-raden mangler lagret filsti.", 400, importIdParam);
    }

    const normalizedPath = rawPath.replace(/^cv-uploads\//, "");
    const firstSeg = normalizedPath.split("/")[0];
    if (firstSeg !== user.id) {
      return jsonError("forbidden_path", "Du har ikke tilgang til denne filen.", 403, importIdParam);
    }

    const importType = row.import_type as string;
    const sourceFormat: SourceFormat = importType === "old_cv_pdf" ? "pdf" : "docx";

    const { error: procErr } = await supabase
      .from("cv_imports")
      .update({
        status: "processing",
        error_message: null,
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", importIdParam)
      .eq("user_id", user.id);

    if (procErr) {
      console.error("cv_imports processing update failed:", procErr);
      return jsonError("database_error", "Kunne ikke sette status til behandling.", 500, importIdParam);
    }

    const { data: fileData, error: downloadError } = await supabase.storage
      .from("cv-uploads")
      .download(normalizedPath);

    if (downloadError || !fileData) {
      await supabase
        .from("cv_imports")
        .update({
          status: "failed",
          error_message: `file_not_found: ${downloadError?.message ?? "unknown"}`.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", importIdParam)
        .eq("user_id", user.id);
      return jsonError(
        "file_not_found",
        "Filen ble ikke funnet i Storage.",
        404,
        importIdParam,
      );
    }

    const fileBuffer = await fileData.arrayBuffer();
    return await parseCvPipeline(supabase, user.id, importIdParam, fileBuffer, sourceFormat);
  }

  // ----- Mode B: legacy — file_path + source_format (creates cv_import row in processing) -----
  const { file_path, source_format } = body;
  if (typeof file_path !== "string" || !file_path) {
    return jsonError(
      "invalid_input",
      "Send import_id (UUID) etter opplasting, eller file_path + source_format.",
      400,
    );
  }
  if (source_format !== "pdf" && source_format !== "docx") {
    return jsonError("invalid_input", "source_format må være 'pdf' eller 'docx'.", 400);
  }

  // Normalize: accept both "cv-uploads/<uid>/..." and "<uid>/..."
  const normalizedPath = file_path.replace(/^cv-uploads\//, "");
  const firstSegment = normalizedPath.split("/")[0];
  if (firstSegment !== user.id) {
    return jsonError(
      "forbidden_path",
      "Du har ikke tilgang til denne filen.",
      403,
    );
  }

  const filename = normalizedPath.split("/").pop() ?? "unknown";
  const importType = source_format === "pdf" ? "old_cv_pdf" : "old_cv_docx";

  const { data: importRow, error: insertError } = await supabase
    .from("cv_imports")
    .insert({
      user_id: user.id,
      import_type: importType,
      source_filename: filename,
      source_file_path: normalizedPath,
      status: "processing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insertError || !importRow) {
    console.error("Failed to create cv_imports row:", insertError);
    return jsonError(
      "database_error",
      "Kunne ikke opprette import-rad.",
      500,
    );
  }

  const import_id: string = importRow.id;

  const { data: fileData, error: downloadError } = await supabase.storage
    .from("cv-uploads")
    .download(normalizedPath);

  if (downloadError || !fileData) {
    await supabase
      .from("cv_imports")
      .update({
        status: "failed",
        error_message: `file_not_found: ${downloadError?.message ?? "unknown"}`.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", import_id)
      .eq("user_id", user.id);
    return jsonError(
      "file_not_found",
      "Filen ble ikke funnet i Storage.",
      404,
      import_id,
    );
  }

  const fileBuffer = await fileData.arrayBuffer();
  return await parseCvPipeline(supabase, user.id, import_id, fileBuffer, source_format);
});
