// Serveronly: ZIP-porter for LinkedIn-import (kontrakt §8.1–8.3).
// Ingen rå LinkedIn-tekst forlater denne modulen via logger.

import { unzipSync } from "fflate";
import { LINKEDIN_LIMITS } from "./contract";

export type PreflightEntry = {
  archivePath: string;
  bytes: Uint8Array;
  uncompressedBytes: number;
};

export type PreflightError = { code: string; archivePath?: string };

export type PreflightResult =
  | { ok: true; entries: PreflightEntry[]; archiveSha256: string; totalUncompressedBytes: number }
  | { ok: false; error: PreflightError };

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest(
    "SHA-256",
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Avviser path traversal, absolutte stier og backslash-separatorer. */
export function normalizeArchivePath(raw: string): string | null {
  if (!raw || raw.endsWith("/")) return null;
  if (raw.includes("\\")) return null;
  if (raw.startsWith("/")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  const parts = raw.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return null;
  return parts.join("/");
}

export async function runPreflight(archive: Uint8Array): Promise<PreflightResult> {
  if (archive.byteLength > LINKEDIN_LIMITS.maxCompressedBytes) {
    return { ok: false, error: { code: "archive_too_large" } };
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    return { ok: false, error: { code: "invalid_archive" } };
  }

  const rawPaths = Object.keys(files).filter((p) => !p.endsWith("/"));
  if (rawPaths.length > LINKEDIN_LIMITS.maxArchiveEntries) {
    return { ok: false, error: { code: "too_many_entries" } };
  }

  const seen = new Set<string>();
  const entries: PreflightEntry[] = [];
  let total = 0;

  for (const raw of rawPaths) {
    const path = normalizeArchivePath(raw);
    if (!path) return { ok: false, error: { code: "path_traversal_detected" } };
    if (seen.has(path)) return { ok: false, error: { code: "duplicate_archive_path" } };
    seen.add(path);

    const bytes = files[raw]!;
    if (bytes.byteLength > LINKEDIN_LIMITS.maxSingleFileBytes) {
      return { ok: false, error: { code: "file_too_large", archivePath: path } };
    }
    total += bytes.byteLength;
    if (total > LINKEDIN_LIMITS.maxUncompressedTotalBytes) {
      return { ok: false, error: { code: "archive_uncompressed_too_large" } };
    }
    entries.push({ archivePath: path, bytes, uncompressedBytes: bytes.byteLength });
  }

  if (archive.byteLength > 0 && total / archive.byteLength > LINKEDIN_LIMITS.maxCompressionRatio) {
    return { ok: false, error: { code: "compression_ratio_exceeded" } };
  }

  return {
    ok: true,
    entries,
    archiveSha256: await sha256Hex(archive),
    totalUncompressedBytes: total,
  };
}

/** UTF-8-dekoding med strenge feilkoder; ingen stille tegnerstatning. */
export function decodeUtf8Strict(
  bytes: Uint8Array,
): { ok: true; text: string } | { ok: false; code: string } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "invalid_encoding" };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes("\u0000")) return { ok: false, code: "null_byte_detected" };
  return { ok: true, text };
}
