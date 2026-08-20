// Serveronly: staging av godkjente LinkedIn-kilder.
// Skriver ALDRI til produktdata. Kun linkedin_*-tabellene berøres.

import type { LinkedInPurpose } from "./contract";
import { CONNECTIONS_PARSER_VERSION, LINKEDIN_CONTRACT_VERSION } from "./contract";
import { classifyEntries } from "./classify.server";
import { parseCsvFile, rowToObject, isFormulaInjectionCandidate } from "./csv.server";
import { DOMAIN_TABLES, mapRow } from "./domain-mapping.server";
import { computeSourceIdentityHash } from "./normalize.server";
import { decodeUtf8Strict, runPreflight, sha256Hex, type PreflightEntry } from "./preflight.server";

type AdminClient = {
  from: (table: string) => any;
};

export type StageOutcome = {
  ok: boolean;
  status: string;
  errorCode?: string;
  knownFileCount: number;
  unknownFileCount: number;
  excludedFileCount: number;
  validFileCount: number;
  invalidFileCount: number;
  stagedRecordCount: number;
  excludedReasonCounts: Record<string, number>;
  contentManifestHash: string;
  filePurposeOutcomes: Array<{
    archivePath: string;
    purpose: LinkedInPurpose;
    status: string;
    stagedRecordCount: number;
    errorCode?: string;
  }>;
};

/**
 * Validerer og stager ett arkiv for de valgte formålene.
 * Idempotent på (user_id, source_file, source_identity_hash).
 */
export async function validateAndStageArchive(params: {
  admin: AdminClient;
  userId: string;
  importId: string;
  attemptId: string;
  archive: Uint8Array;
  selectedPurposes: LinkedInPurpose[];
}): Promise<StageOutcome> {
  const { admin, userId, importId, attemptId, archive, selectedPurposes } = params;
  const selected = new Set(selectedPurposes);

  const pre = await runPreflight(archive);
  if (!pre.ok) {
    return emptyOutcome("rejected", pre.error.code);
  }

  const { known, excludedReasonCounts, excludedFileCount, unknownPaths } = classifyEntries(pre.entries);

  // Innholdsmanifest: hash over (sti + filhash), uavhengig av ZIP-pakking.
  const perFileHash = new Map<string, string>();
  for (const { entry } of known) {
    perFileHash.set(entry.archivePath, await sha256Hex(entry.bytes));
  }
  const contentManifestHash = await sha256Hex(
    [...perFileHash.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, h]) => `${p}:${h}`).join("\n"),
  );

  let validFileCount = 0;
  let invalidFileCount = 0;
  let stagedRecordCount = 0;
  const filePurposeOutcomes: StageOutcome["filePurposeOutcomes"] = [];

  for (const { entry, spec } of known) {
    const fileHash = perFileHash.get(entry.archivePath)!;
    const purpose = spec.purpose ?? null;
    const parserVersion =
      /^Connections\.csv$/i.test(entry.archivePath) ? CONNECTIONS_PARSER_VERSION : LINKEDIN_CONTRACT_VERSION;

    // Klasse B: registreres teknisk, men stages aldri i fase 2.
    if (spec.fileClass === "B") {
      const fileId = await upsertFile(admin, {
        importId, userId, archivePath: entry.archivePath, fileClass: "B",
        fileHash, uncompressedBytes: entry.uncompressedBytes, status: "validated", parserVersion,
      });
      validFileCount += 1;
      for (const p of selectedPurposes) {
        await upsertFilePurpose(admin, fileId, userId, p, "deferred", 0, "class_b_deferred");
        filePurposeOutcomes.push({ archivePath: entry.archivePath, purpose: p, status: "deferred", stagedRecordCount: 0 });
      }
      continue;
    }

    // Klasse A uten valgt formål: ingen lesing av innhold.
    if (!purpose || !selected.has(purpose)) {
      const fileId = await upsertFile(admin, {
        importId, userId, archivePath: entry.archivePath, fileClass: "A",
        fileHash, uncompressedBytes: entry.uncompressedBytes, status: "validated", parserVersion,
      });
      validFileCount += 1;
      if (purpose) {
        await upsertFilePurpose(admin, fileId, userId, purpose, "skipped_no_consent", 0, null);
        filePurposeOutcomes.push({
          archivePath: entry.archivePath, purpose, status: "skipped_no_consent", stagedRecordCount: 0,
        });
      }
      continue;
    }

    const parsed = await stageFile({ admin, userId, importId, attemptId, entry, spec, fileHash });
    if (!parsed.ok) {
      invalidFileCount += 1;
      const fileId = await upsertFile(admin, {
        importId, userId, archivePath: entry.archivePath, fileClass: "A",
        fileHash, uncompressedBytes: entry.uncompressedBytes, status: "invalid",
        parserVersion, errorCode: parsed.errorCode,
      });
      await upsertFilePurpose(admin, fileId, userId, purpose, "failed", 0, parsed.errorCode);
      filePurposeOutcomes.push({
        archivePath: entry.archivePath, purpose, status: "failed", stagedRecordCount: 0, errorCode: parsed.errorCode,
      });
      continue;
    }

    validFileCount += 1;
    stagedRecordCount += parsed.stagedCount;
    const fileId = await upsertFile(admin, {
      importId, userId, archivePath: entry.archivePath, fileClass: "A",
      fileHash, uncompressedBytes: entry.uncompressedBytes, status: "validated",
      parserVersion, rowCount: parsed.rowCount, validRowCount: parsed.stagedCount,
      invalidRowCount: parsed.rowCount - parsed.stagedCount,
    });
    await upsertFilePurpose(admin, fileId, userId, purpose, "staged", parsed.stagedCount, null);
    filePurposeOutcomes.push({
      archivePath: entry.archivePath, purpose, status: "staged", stagedRecordCount: parsed.stagedCount,
    });
  }

  const status = invalidFileCount > 0 ? "partially_validated" : "validated";

  return {
    ok: true,
    status,
    knownFileCount: known.length,
    unknownFileCount: unknownPaths.length,
    excludedFileCount,
    validFileCount,
    invalidFileCount,
    stagedRecordCount,
    excludedReasonCounts,
    contentManifestHash,
    filePurposeOutcomes,
  };
}

async function stageFile(params: {
  admin: AdminClient;
  userId: string;
  importId: string;
  attemptId: string;
  entry: PreflightEntry;
  spec: { domain?: string; recordKind?: string; purpose?: LinkedInPurpose; locatorType?: string };
  fileHash: string;
}): Promise<{ ok: true; rowCount: number; stagedCount: number } | { ok: false; errorCode: string }> {
  const { admin, userId, importId, attemptId, entry, spec, fileHash } = params;
  const domain = spec.domain!;
  const recordKind = spec.recordKind!;
  const purpose = spec.purpose!;

  // HTML-artikler: hele filen er én stagingrad med innholdshash som lokator.
  if (spec.locatorType === "html_section") {
    const decoded = decodeUtf8Strict(entry.bytes);
    if (!decoded.ok) return { ok: false, errorCode: decoded.code };
    const title = /<title>([^<]*)<\/title>/i.exec(decoded.text)?.[1]?.trim() ?? null;
    const identityHash = await computeSourceIdentityHash({
      userId, purpose, sourceFile: entry.archivePath, recordKind,
      fields: { title, content_hash: fileHash },
    });
    const ok = await writeStagingRecord(admin, {
      userId, importId, attemptId, domain, recordKind, purpose,
      sourceFile: entry.archivePath, locatorType: "html_section", locator: entry.archivePath,
      contentHash: fileHash, rowNumber: null, rowHash: null, identityHash,
      domainFields: { entry_kind: "article", title, content_url: null, published_at: null, media_kind: "html" },
    });
    return { ok: true, rowCount: 1, stagedCount: ok ? 1 : 0 };
  }

  const parsed = parseCsvFile(entry.archivePath, entry.bytes);
  if (!parsed.ok) return { ok: false, errorCode: parsed.code };

  let stagedCount = 0;
  for (const row of parsed.rows) {
    if (row.values.every((v) => v.trim() === "")) continue;
    const obj = rowToObject(parsed.header, row.values);
    const mapped = mapRow(recordKind, obj);
    if (!mapped) continue;
    if (Object.values(mapped.identityFields).every((v) => v == null)) continue;

    const rowHash = await sha256Hex(JSON.stringify(row.values));
    const identityHash = await computeSourceIdentityHash({
      userId, purpose, sourceFile: entry.archivePath, recordKind, fields: mapped.identityFields,
    });
    const flagged = Object.values(obj).some(isFormulaInjectionCandidate);
    const ok = await writeStagingRecord(admin, {
      userId, importId, attemptId, domain, recordKind, purpose,
      sourceFile: entry.archivePath, locatorType: "csv_row",
      locator: `${entry.archivePath}#${row.rowNumber}`,
      contentHash: null, rowNumber: row.rowNumber, rowHash, identityHash,
      domainFields: mapped.domainFields,
      classification: flagged ? "A" : "A",
    });
    if (ok) stagedCount += 1;
  }
  return { ok: true, rowCount: parsed.rows.length, stagedCount };
}

async function writeStagingRecord(
  admin: AdminClient,
  r: {
    userId: string; importId: string; attemptId: string; domain: string; recordKind: string;
    purpose: LinkedInPurpose; sourceFile: string; locatorType: string; locator: string;
    contentHash: string | null; rowNumber: number | null; rowHash: string | null;
    identityHash: string; domainFields: Record<string, unknown>; classification?: string;
  },
): Promise<boolean> {
  // Idempotens: identisk innhold oppdaterer kun last_*; endret innhold gir ny rad.
  const { data: existing } = await admin
    .from("linkedin_staging_records")
    .select("id")
    .eq("user_id", r.userId)
    .eq("source_file", r.sourceFile)
    .eq("source_identity_hash", r.identityHash)
    .maybeSingle();

  let stagingId: string | null = existing?.id ?? null;

  if (stagingId) {
    await admin
      .from("linkedin_staging_records")
      .update({ last_linkedin_import_id: r.importId, last_seen_at: new Date().toISOString() })
      .eq("id", stagingId);
  } else {
    const { data, error } = await admin
      .from("linkedin_staging_records")
      .insert({
        user_id: r.userId,
        staging_domain: r.domain,
        record_kind: r.recordKind,
        purpose: r.purpose,
        source_file: r.sourceFile,
        source_locator_type: r.locatorType,
        source_locator: r.locator,
        source_row_number: r.rowNumber,
        source_row_hash: r.rowHash,
        source_content_hash: r.contentHash,
        source_recorded_at: new Date().toISOString(),
        source_classification: r.classification ?? "A",
        source_identity_hash: r.identityHash,
        first_linkedin_import_id: r.importId,
        last_linkedin_import_id: r.importId,
      })
      .select("id")
      .single();
    if (error || !data) return false;
    stagingId = data.id as string;

    const table = DOMAIN_TABLES[r.domain as keyof typeof DOMAIN_TABLES];
    const { error: domainError } = await admin
      .from(table)
      .insert({ staging_record_id: stagingId, user_id: r.userId, ...r.domainFields });
    if (domainError) {
      await admin.from("linkedin_staging_records").delete().eq("id", stagingId);
      return false;
    }
  }

  await admin.from("linkedin_import_stage_records").upsert(
    {
      linkedin_import_id: r.importId,
      attempt_id: r.attemptId,
      user_id: r.userId,
      staging_record_id: stagingId,
      staging_domain: r.domain,
      purpose: r.purpose,
      source_identity_hash: r.identityHash,
    },
    { onConflict: "linkedin_import_id,attempt_id,staging_record_id" },
  );
  return true;
}

async function upsertFile(
  admin: AdminClient,
  f: {
    importId: string; userId: string; archivePath: string; fileClass: "A" | "B";
    fileHash: string; uncompressedBytes: number; status: string; parserVersion: string;
    errorCode?: string; rowCount?: number; validRowCount?: number; invalidRowCount?: number;
  },
): Promise<string> {
  const { data } = await admin
    .from("linkedin_import_files")
    .upsert(
      {
        linkedin_import_id: f.importId,
        user_id: f.userId,
        archive_path: f.archivePath,
        file_class: f.fileClass,
        file_hash: f.fileHash,
        uncompressed_bytes: f.uncompressedBytes,
        status: f.status,
        parser_version: f.parserVersion,
        error_code: f.errorCode ?? null,
        row_count: f.rowCount ?? null,
        valid_row_count: f.validRowCount ?? null,
        invalid_row_count: f.invalidRowCount ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "linkedin_import_id,archive_path" },
    )
    .select("id")
    .single();
  return data!.id as string;
}

async function upsertFilePurpose(
  admin: AdminClient,
  fileId: string,
  userId: string,
  purpose: LinkedInPurpose,
  status: string,
  stagedRecordCount: number,
  errorCode: string | null,
) {
  await admin.from("linkedin_import_file_purposes").upsert(
    {
      linkedin_import_file_id: fileId,
      user_id: userId,
      purpose,
      status,
      staged_record_count: stagedRecordCount,
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "linkedin_import_file_id,purpose" },
  );
}

function emptyOutcome(status: string, errorCode: string): StageOutcome {
  return {
    ok: false,
    status,
    errorCode,
    knownFileCount: 0,
    unknownFileCount: 0,
    excludedFileCount: 0,
    validFileCount: 0,
    invalidFileCount: 0,
    stagedRecordCount: 0,
    excludedReasonCounts: {},
    contentManifestHash: "",
    filePurposeOutcomes: [],
  };
}
