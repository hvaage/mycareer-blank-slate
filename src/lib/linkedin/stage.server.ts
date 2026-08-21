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
  /** Sant når alle kjente filer i arkivet er behandlet i denne kjøringen. */
  done: boolean;
  /** Neste filindeks å fortsette fra når tidsbudsjettet ble brukt opp. */
  nextFileIndex: number;
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
 *
 * Kjøringen kan deles opp: `startFileIndex` fortsetter der forrige kjøring
 * slapp, og `timeBudgetMs` stopper kontrollert mellom to filer slik at
 * arbeideren rekker å melde fra før tidsavbrudd.
 */
export async function validateAndStageArchive(params: {
  admin: AdminClient;
  userId: string;
  importId: string;
  attemptId: string;
  archive: Uint8Array;
  selectedPurposes: LinkedInPurpose[];
  startFileIndex?: number;
  timeBudgetMs?: number;
  onProgress?: (progress: {
    fileIndex: number;
    archivePath: string;
    stagedRecordCount: number;
  }) => Promise<boolean | void>;
}): Promise<StageOutcome> {
  const { admin, userId, importId, attemptId, archive, selectedPurposes } = params;
  const startFileIndex = params.startFileIndex ?? 0;
  const deadline = params.timeBudgetMs ? Date.now() + params.timeBudgetMs : null;
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

  // Stabil rekkefølge: gjenopptakelse må treffe samme fil på samme indeks.
  const ordered = [...known].sort((a, b) => a.entry.archivePath.localeCompare(b.entry.archivePath));

  let validFileCount = 0;
  let invalidFileCount = 0;
  let stagedRecordCount = 0;
  let nextFileIndex = startFileIndex;
  let done = true;
  const filePurposeOutcomes: StageOutcome["filePurposeOutcomes"] = [];

  for (let fileIndex = startFileIndex; fileIndex < ordered.length; fileIndex += 1) {
    if (deadline && Date.now() > deadline) {
      done = false;
      nextFileIndex = fileIndex;
      break;
    }

    const { entry, spec } = ordered[fileIndex]!;
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
      nextFileIndex = fileIndex + 1;
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
        await upsertFilePurpose(admin, fileId, userId, purpose, "skipped_no_selected_purpose", 0, null);
        filePurposeOutcomes.push({
          archivePath: entry.archivePath, purpose, status: "skipped_no_selected_purpose", stagedRecordCount: 0,
        });
      }
      nextFileIndex = fileIndex + 1;
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
      nextFileIndex = fileIndex + 1;
      continue;
    }

    validFileCount += 1;
    stagedRecordCount += parsed.stagedCount;
    const fileId = await upsertFile(admin, {
      importId, userId, archivePath: entry.archivePath, fileClass: "A",
      fileHash, uncompressedBytes: entry.uncompressedBytes, status: "validated",
      parserVersion, rowCount: parsed.rowCount, validRowCount: parsed.stagedCount,
      invalidRowCount: parsed.rowCount - parsed.stagedCount,
      skippedRowReasons: parsed.skipReasons,
    });
    await upsertFilePurpose(admin, fileId, userId, purpose, "staged", parsed.stagedCount, null);
    filePurposeOutcomes.push({
      archivePath: entry.archivePath, purpose, status: "staged", stagedRecordCount: parsed.stagedCount,
    });
    nextFileIndex = fileIndex + 1;

    if (params.onProgress) {
      const keepGoing = await params.onProgress({
        fileIndex: nextFileIndex,
        archivePath: entry.archivePath,
        stagedRecordCount,
      });
      if (keepGoing === false) {
        done = false;
        break;
      }
    }
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
    done,
    nextFileIndex,
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
}): Promise<
  | { ok: true; rowCount: number; stagedCount: number; skipReasons: Record<string, number> }
  | { ok: false; errorCode: string }
> {
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
    return { ok: true, rowCount: 1, stagedCount: ok ? 1 : 0, skipReasons: ok ? {} : { write_deduplicated: 1 } };
  }

  const parsed = parseCsvFile(entry.archivePath, entry.bytes);
  if (!parsed.ok) return { ok: false, errorCode: parsed.code };

  // Hver rad som ikke stages får en eksplisitt årsakskode.
  const skipReasons: Record<string, number> = {};
  const bump = (code: string) => {
    skipReasons[code] = (skipReasons[code] ?? 0) + 1;
  };

  const isEndorsement = domain === "recommendation" && recordKind.startsWith("endorsement_");

  if (isEndorsement) {
    const endorsementRows: Array<{
      userId: string; importId: string; sourceFile: string; rowNumber: number; rowHash: string;
      direction: "received_for_user_skill" | "given_by_user_to_other";
      skillSourceLabel: string | null; skillCanonicalKey: string | null;
      endorserIdentityHash: string | null; observedAt: string | null;
    }> = [];
    for (const row of parsed.rows) {
      if (row.values.every((v) => v.trim() === "")) {
        bump("empty_row");
        continue;
      }
      const obj = rowToObject(parsed.header, row.values);
      const mapped = mapRow(recordKind, obj);
      if (!mapped) {
        bump("unmapped_record_kind");
        continue;
      }
      if (Object.values(mapped.identityFields).every((v) => v == null)) {
        bump("no_identity_fields");
        continue;
      }

      const rowHash = await sha256Hex(JSON.stringify(row.values));
      const f = mapped.domainFields as Record<string, unknown>;
      endorsementRows.push({
        userId, importId, sourceFile: entry.archivePath, rowNumber: row.rowNumber, rowHash,
        direction: recordKind === "endorsement_received" ? "received_for_user_skill" : "given_by_user_to_other",
        skillSourceLabel: (f.skill_source_label as string | null) ?? null,
        skillCanonicalKey: (f.skill_canonical_key as string | null) ?? null,
        endorserIdentityHash: (f.endorser_identity_hash as string | null) ?? null,
        observedAt: (f.observed_at as string | null) ?? null,
      });
    }
    try {
      const stagedCount = await writeEndorsementStagingRecords(admin, endorsementRows);
      if (endorsementRows.length > stagedCount) {
        skipReasons["source_duplicate_identity"] = endorsementRows.length - stagedCount;
      }
      return { ok: true, rowCount: parsed.rows.length, stagedCount, skipReasons };
    } catch (error) {
      return { ok: false, errorCode: error instanceof StagingError ? error.code : "staging_write_failed" };
    }
  }

  const pending: StagingInput[] = [];
  for (const row of parsed.rows) {
    if (row.values.every((v) => v.trim() === "")) {
      bump("empty_row");
      continue;
    }
    const obj = rowToObject(parsed.header, row.values);
    const mapped = mapRow(recordKind, obj);
    if (!mapped) {
      bump("unmapped_record_kind");
      continue;
    }
    if (Object.values(mapped.identityFields).every((v) => v == null)) {
      bump("no_identity_fields");
      continue;
    }

    const rowHash = await sha256Hex(JSON.stringify(row.values));
    const identityHash = await computeSourceIdentityHash({
      userId, purpose, sourceFile: entry.archivePath, recordKind, fields: mapped.identityFields,
    });
    pending.push({
      userId, importId, attemptId, domain, recordKind, purpose,
      sourceFile: entry.archivePath, locatorType: "csv_row",
      locator: `${entry.archivePath}#${row.rowNumber}`,
      contentHash: null, rowNumber: row.rowNumber, rowHash, identityHash,
      domainFields: mapped.domainFields,
    });
  }

  try {
    const stagedCount = await writeStagingRecords(admin, pending);
    if (pending.length > stagedCount) {
      skipReasons["source_duplicate_identity"] = pending.length - stagedCount;
    }
    return { ok: true, rowCount: parsed.rows.length, stagedCount, skipReasons };
  } catch (error) {
    return { ok: false, errorCode: error instanceof StagingError ? error.code : "staging_write_failed" };
  }
}


/** Databasefeil i stagingskrivingen skal aldri gi stille datatap. */
export class StagingError extends Error {
  constructor(public code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "StagingError";
  }
}

/**
 * Endorsements holdes utenfor anbefalings-domenetabellen (produktkontrakt v1.1):
 * skrives til linkedin_endorsement_staging, idempotent per (user_id, linkedin_import_id, source_row_hash).
 */
async function writeEndorsementStagingRecords(
  admin: AdminClient,
  rows: Array<{
    userId: string; importId: string; sourceFile: string; rowNumber: number; rowHash: string;
    direction: "received_for_user_skill" | "given_by_user_to_other";
    skillSourceLabel: string | null; skillCanonicalKey: string | null;
    endorserIdentityHash: string | null; observedAt: string | null;
  }>,
): Promise<number> {
  if (rows.length === 0) return 0;
  let staged = 0;
  for (const part of chunked(rows)) {
    const { error } = await admin
      .from("linkedin_endorsement_staging")
      .upsert(
        part.map((r) => ({
          user_id: r.userId,
          linkedin_import_id: r.importId,
          source_file: r.sourceFile,
          source_row_number: r.rowNumber,
          source_row_hash: r.rowHash,
          source_classification: "A",
          direction: r.direction,
          skill_source_label: r.skillSourceLabel,
          skill_canonical_key: r.skillCanonicalKey,
          endorser_identity_hash: r.endorserIdentityHash,
          observed_at: r.observedAt,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: "user_id,linkedin_import_id,source_row_hash" },
      );
    if (error) throw new StagingError("endorsement_staging_write_failed", error.message);
    staged += part.length;
  }
  return staged;
}

type StagingInput = {
  userId: string; importId: string; attemptId: string; domain: string; recordKind: string;
  purpose: LinkedInPurpose; sourceFile: string; locatorType: string; locator: string;
  contentHash: string | null; rowNumber: number | null; rowHash: string | null;
  identityHash: string; domainFields: Record<string, unknown>; classification?: string;
};

/** Skrivebatch. Holdes lav nok til at ingen forespørsel avvises på størrelse. */
const CHUNK = 200;
/** Oppslag via `in()` bruker 64-tegns hasher eller UUID-er: hold URL-en kort. */
const LOOKUP_CHUNK = 100;

function chunked<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function writeStagingRecord(admin: AdminClient, r: StagingInput): Promise<boolean> {
  return (await writeStagingRecords(admin, [r])) > 0;
}

/**
 * Batchet staging, idempotent på (user_id, source_file, source_identity_hash).
 *
 * Tapsfri kontrakt:
 *  - alle oppslag chunkes slik at `in()`-URL-en aldri sprenger grensen,
 *  - enhver databasefeil kastes som StagingError (filen markeres `failed`),
 *  - ingen rad forkastes stille fordi en batch feilet.
 */
async function writeStagingRecords(admin: AdminClient, records: StagingInput[]): Promise<number> {
  if (records.length === 0) return 0;

  // Dedupliser innenfor samme fil.
  const byHash = new Map<string, StagingInput>();
  for (const r of records) if (!byHash.has(r.identityHash)) byHash.set(r.identityHash, r);
  const unique = [...byHash.values()];
  const { userId, sourceFile, importId, attemptId, domain, purpose } = unique[0]!;

  const idByHash = new Map<string, string>();

  const resolveIds = async (hashes: string[]) => {
    for (const part of chunked(hashes, LOOKUP_CHUNK)) {
      const { data, error } = await admin
        .from("linkedin_staging_records")
        .select("id, source_identity_hash")
        .eq("user_id", userId)
        .eq("source_file", sourceFile)
        .in("source_identity_hash", part);
      if (error) throw new StagingError("staging_lookup_failed", error.message);
      for (const row of data ?? []) idByHash.set(row.source_identity_hash as string, row.id as string);
    }
  };

  // 1) Allerede stagede rader.
  await resolveIds(unique.map((r) => r.identityHash));

  // 2) Oppdater last_seen for de som finnes fra før.
  for (const part of chunked([...idByHash.values()], LOOKUP_CHUNK)) {
    const { error } = await admin
      .from("linkedin_staging_records")
      .update({ last_linkedin_import_id: importId, last_seen_at: new Date().toISOString() })
      .in("id", part);
    if (error) throw new StagingError("staging_last_seen_failed", error.message);
  }

  // 3) Sett inn nye rader. Konflikt ignoreres, id-ene hentes etterpå.
  const fresh = unique.filter((r) => !idByHash.has(r.identityHash));
  for (const part of chunked(fresh)) {
    const { data, error } = await admin
      .from("linkedin_staging_records")
      .upsert(
        part.map((r) => ({
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
        })),
        { onConflict: "user_id,source_file,source_identity_hash", ignoreDuplicates: true },
      )
      .select("id, source_identity_hash");
    if (error) throw new StagingError("staging_insert_failed", error.message);
    for (const row of data ?? []) idByHash.set(row.source_identity_hash as string, row.id as string);
  }

  // 3b) Hent id for rader som ble ignorert som duplikat i upserten.
  const unresolved = unique.filter((r) => !idByHash.has(r.identityHash)).map((r) => r.identityHash);
  if (unresolved.length > 0) await resolveIds(unresolved);
  if (unique.some((r) => !idByHash.has(r.identityHash))) {
    throw new StagingError("staging_row_missing_after_insert");
  }

  // 4) Domenerader: sett inn kun for stagingrader som mangler dem.
  const table = DOMAIN_TABLES[domain as keyof typeof DOMAIN_TABLES];
  const allIds = unique.map((r) => idByHash.get(r.identityHash)!);
  const haveDomainRow = new Set<string>();
  for (const part of chunked(allIds, LOOKUP_CHUNK)) {
    const { data, error } = await admin.from(table).select("staging_record_id").in("staging_record_id", part);
    if (error) throw new StagingError("staging_domain_lookup_failed", error.message);
    for (const row of data ?? []) haveDomainRow.add(row.staging_record_id as string);
  }
  const domainRows = unique
    .filter((r) => !haveDomainRow.has(idByHash.get(r.identityHash)!))
    .map((r) => ({ staging_record_id: idByHash.get(r.identityHash)!, user_id: r.userId, ...r.domainFields }));
  for (const part of chunked(domainRows)) {
    const { error } = await admin.from(table).insert(part);
    if (error) throw new StagingError("staging_domain_insert_failed", error.message);
  }

  // 5) Koble stagingrader til dette importforsøket.
  for (const part of chunked(unique)) {
    const { error } = await admin.from("linkedin_import_stage_records").upsert(
      part.map((r) => ({
        linkedin_import_id: importId,
        attempt_id: attemptId,
        user_id: userId,
        staging_record_id: idByHash.get(r.identityHash)!,
        staging_domain: domain,
        purpose,
        source_identity_hash: r.identityHash,
      })),
      { onConflict: "linkedin_import_id,attempt_id,staging_record_id" },
    );
    if (error) throw new StagingError("staging_link_failed", error.message);
  }

  return unique.length;
}



async function upsertFile(
  admin: AdminClient,
  f: {
    importId: string; userId: string; archivePath: string; fileClass: "A" | "B";
    fileHash: string; uncompressedBytes: number; status: string; parserVersion: string;
    errorCode?: string; rowCount?: number; validRowCount?: number; invalidRowCount?: number;
    skippedRowReasons?: Record<string, number>;
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
        skipped_row_reasons: f.skippedRowReasons ?? null,
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
    done: true,
    nextFileIndex: 0,
    filePurposeOutcomes: [],

  };
}
