// Engangsskript: fjern utdaterte nettverks-stagingrader (gammel identitetsmodell)
// og bygg batchen på nytt.
import { createClient } from "@supabase/supabase-js";
import { runNetworkReconciliationV2 } from "../src/lib/linkedin/reconciliation/v2/engine.server";

const IMPORT_ID = "886529ce-edff-49c1-9dc4-a24e6e617f0b";
const USER_ID = "8103b452-0a27-46b0-a204-e2d9db34ec22";
const CUTOFF = process.env.CUTOFF!; // ISO-tid for starten av ny staging

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let removed = 0;
for (;;) {
  const { data, error } = await admin
    .from("linkedin_staging_records")
    .select("id")
    .eq("user_id", USER_ID)
    .eq("staging_domain", "network")
    .lt("last_seen_at", CUTOFF)
    .order("id")
    .limit(200);
  if (error) throw error;
  if (!data || data.length === 0) break;
  const ids = data.map((r: any) => r.id);
  const del = await admin.from("linkedin_staging_records").delete().in("id", ids);
  if (del.error) throw del.error;
  removed += ids.length;
}
console.log("removed stale network staging rows", removed);

await admin
  .from("linkedin_network_reconciliation_batches")
  .update({ status: "superseded" })
  .eq("user_id", USER_ID)
  .in("status", ["ready", "preparing"]);

const rec = await runNetworkReconciliationV2(admin as never, { userId: USER_ID, importId: IMPORT_ID });
console.log("reconciliation", JSON.stringify(rec, null, 2));

for (const t of ["network_contacts", "network_contact_identities", "network_contact_company_relations", "next_steps"]) {
  const { count } = await admin.from(t).select("id", { count: "exact", head: true });
  console.log("product", t, count);
}
