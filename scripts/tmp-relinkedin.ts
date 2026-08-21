// Engangsskript: kontrollert ny staging + ny nettverksbatch for én import.
import { createClient } from "@supabase/supabase-js";
import { validateAndStageArchive } from "../src/lib/linkedin/stage.server";
import { runNetworkReconciliationV2 } from "../src/lib/linkedin/reconciliation/v2/engine.server";

const IMPORT_ID = "886529ce-edff-49c1-9dc4-a24e6e617f0b";
const USER_ID = "8103b452-0a27-46b0-a204-e2d9db34ec22";

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: imp } = await admin
  .from("linkedin_imports")
  .select("id, archive_storage_path")
  .eq("id", IMPORT_ID)
  .single();

const { data: purposeRows } = await admin
  .from("linkedin_import_purposes")
  .select("purpose")
  .eq("linkedin_import_id", IMPORT_ID);
const purposes = [...new Set((purposeRows ?? []).map((p: any) => p.purpose))];
console.log("purposes", purposes);

// 1) Supersede gjeldende batch(er).
await admin
  .from("linkedin_network_reconciliation_batches")
  .update({ status: "superseded" })
  .eq("user_id", USER_ID)
  .in("status", ["ready", "preparing"]);

// 2) Slett nettverksstaging for importen (identitetsmodellen er endret).
const { error: delErr } = await admin
  .from("linkedin_staging_records")
  .delete()
  .eq("user_id", USER_ID)
  .eq("staging_domain", "network");
console.log("deleted network staging", delErr?.message ?? "ok");

// 3) Ny staging fra eksisterende arkiv.
const dl = await admin.storage.from("linkedin-imports").download(imp!.archive_storage_path!);
if (dl.error) throw dl.error;
const archive = new Uint8Array(await dl.data!.arrayBuffer());

const outcome = await validateAndStageArchive({
  admin: admin as never,
  userId: USER_ID,
  importId: IMPORT_ID,
  attemptId: crypto.randomUUID(),
  archive,
  selectedPurposes: purposes as never,
});
console.log("staging", JSON.stringify({
  ok: outcome.ok, done: outcome.done, staged: outcome.stagedRecordCount,
  valid: outcome.validFileCount, invalid: outcome.invalidFileCount,
}));

const { data: files } = await admin
  .from("linkedin_import_files")
  .select("archive_path, row_count, valid_row_count, invalid_row_count, skipped_row_reasons")
  .eq("linkedin_import_id", IMPORT_ID)
  .in("archive_path", ["Connections.csv"]);
console.log("connections file", JSON.stringify(files, null, 2));

// 4) Ny batch.
const rec = await runNetworkReconciliationV2(admin as never, { userId: USER_ID, importId: IMPORT_ID });
console.log("reconciliation", JSON.stringify(rec, null, 2));

// 5) Produktdata etter.
for (const t of ["network_contacts", "network_contact_identities", "network_contact_company_relations", "next_steps"]) {
  const { count } = await admin.from(t).select("id", { count: "exact", head: true });
  console.log("product", t, count);
}
