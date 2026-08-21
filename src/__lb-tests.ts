// Syntetiske tester for Leveranse B-rettingene (ingen produktdata berøres).
import { mapRow } from "@/lib/linkedin/domain-mapping.server";
import {
  normalizeLinkedInProfileUrl,
  exactIdentityMatch,
  possibleDuplicateByName,
  type MatchableContact,
} from "@/lib/linkedin/reconciliation/v2/contract.server";
import { planForThread, supersedePendingProposal, touchThread } from "@/lib/linkedin/reconciliation/threads.server";

let pass = 0,
  fail = 0;
const t = (name: string, ok: boolean, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  ok ? pass++ : fail++;
};

// ---------- Punkt 3: kursmapping ----------
const course = (row: Record<string, string>) => mapRow("course", row)!.domainFields as any;

t(
  "kurs_beskrivelse_uten_url_gir_ingen_content_url",
  course({ "Content Title": "Excel", "Content Description": "Lær Excel raskt" }).content_url === null,
);
t(
  "kurs_gyldig_url_settes",
  course({ "Content Title": "Excel", "Content URL": "https://linkedin.com/learning/excel" }).content_url ===
    "https://linkedin.com/learning/excel",
);
t(
  "kurs_ugyldig_url_verdi_avvises",
  course({ "Content Title": "Excel", "Content URL": "ikke en url" }).content_url === null,
);
t(
  "kurs_manglende_dato_gir_ikke_fullfort",
  course({ "Content Title": "Excel", "Content Last Watched Date": "2025-01-02" }).is_completed === false,
);
t(
  "kurs_ugyldig_dato_gir_ikke_fullfort",
  course({ "Content Title": "Excel", "Completed Date": "tulledato" }).is_completed === false,
);
t(
  "kurs_gyldig_fullfortdato_gir_fullfort",
  course({ "Content Title": "Excel", "Completed Date": "2025-03-04" }).is_completed === true &&
    course({ "Content Title": "Excel", "Completed Date": "2025-03-04" }).completed_on === "2025-03-04",
);
const cert = mapRow("certification", {
  "Name": "AWS SAA",
  "Authority": "Amazon",
  "Started On": "2024-01-01",
  "Finished On": "2027-01-01",
})!.domainFields as any;
t(
  "kurs_og_sertifisering_holdes_atskilt",
  course({ "Content Title": "Excel" }).content_type === "course" && cert.entry_kind === "certification",
  `course=${course({ "Content Title": "Excel" }).content_type}, cert=${cert.entry_kind}`,
);

// ---------- Punkt 2: kanonisk identitet ----------
t(
  "url_normalisering_er_deterministisk",
  normalizeLinkedInProfileUrl("HTTPS://WWW.LinkedIn.com/in/Ola-Nordmann/?utm=1#x") ===
    normalizeLinkedInProfileUrl("linkedin.com/in/ola-nordmann"),
);
const contacts: MatchableContact[] = [
  { id: "c1", displayName: "Ola Nordmann", identityKeys: ["linkedin.com/in/ola-nordmann"] },
  { id: "c2", displayName: "Kari Hansen", identityKeys: [] },
];
t(
  "eksakt_url_gir_identitetsmatch",
  exactIdentityMatch({ profileUrl: "https://www.linkedin.com/in/Ola-Nordmann/" }, contacts)?.id === "c1",
);
t("navn_alene_gir_aldri_identitetsmatch", exactIdentityMatch({ profileUrl: null }, contacts) === null);
t(
  "navn_alene_gir_mulig_duplikat",
  possibleDuplicateByName("Kari Hansen", contacts)[0]?.id === "c2",
);

// ---------- Punkt 1: avstemmingslinje (fake admin-klient) ----------
type Row = Record<string, any>;
function fakeAdmin(db: Record<string, Row[]>) {
  let ids = 0;
  const build = (table: string) => {
    const state: any = { filters: [] as Array<[string, any]>, op: null, payload: null };
    const rows = () => db[table]!.filter((r) => state.filters.every(([k, v]: any) => r[k] === v));
    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => (state.filters.push([k, v]), api),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => {
        if (state.op === "insert") {
          const r = { id: `id${++ids}`, ...state.payload };
          db[table]!.push(r);
          return { data: r, error: null };
        }
        return { data: rows()[0] ?? null, error: null };
      },
      insert: (payload: any) => {
        state.op = "insert";
        state.payload = payload;
        if (Array.isArray(payload)) payload.forEach((p) => db[table]!.push(p));
        return api;
      },
      update: (patch: any) => {
        state.op = "update";
        state.payload = patch;
        return api;
      },
      then: (res: any) => {
        if (state.op === "update") rows().forEach((r) => Object.assign(r, state.payload));
        else if (state.op === "insert" && !Array.isArray(state.payload))
          db[table]!.push({ id: `id${++ids}`, ...state.payload });
        return Promise.resolve({ data: null, error: null }).then(res);
      },
    };
    return api;
  };
  return { from: build } as any;
}

const USER = "u1";
async function threadScenario(previousStatus: string, newHash: string) {
  const db: Record<string, Row[]> = {
    linkedin_reconciliation_threads: [
      {
        id: "t1",
        user_id: USER,
        proposal_domain: "learning",
        thread_key: "learning:excel",
        current_proposal_id: "p1",
        last_source_snapshot_hash: "hashA",
        last_status: previousStatus,
        reopen_count: 0,
      },
    ],
    linkedin_reconciliation_proposals: [
      { id: "p1", user_id: USER, status: previousStatus, superseded_at: null },
    ],
  };
  const admin = fakeAdmin(db);
  const plan = await planForThread(admin, {
    userId: USER,
    domain: "learning",
    threadKey: "learning:excel",
    sourceHash: newHash,
  });
  return { plan, db, admin };
}

{
  const { plan } = await threadScenario("pending_review", "hashA");
  t("reimport_identisk_input_er_idempotent", plan.action === "idempotent", plan.action);
}
{
  const { plan, db, admin } = await threadScenario("dismissed", "hashB");
  t(
    "reimport_endret_kilde_mot_avvist_sak_gir_possible_update",
    plan.action === "supersede" && plan.decided === true,
    JSON.stringify(plan),
  );
  if (plan.action === "supersede") {
    // Avgjort sak: forrige forslag skal IKKE nedgraderes til superseded.
    t(
      "avvist_forslag_beholder_beslutningsstatus",
      db["linkedin_reconciliation_proposals"]![0]!.status === "dismissed",
    );
    await touchThread(admin, {
      threadId: plan.threadId,
      userId: USER,
      proposalId: "p2",
      sourceHash: "hashB",
      status: "pending_review",
      reopened: true,
    });
    t(
      "linjen_teller_gjenapning",
      db["linkedin_reconciliation_threads"]![0]!.reopen_count === 1 &&
        db["linkedin_reconciliation_threads"]![0]!.current_proposal_id === "p2",
    );
  }
}
{
  const { plan } = await threadScenario("promoted", "hashB");
  t("reimport_endret_kilde_mot_promotert_sak_gir_possible_update", plan.action === "supersede" && plan.decided);
}
{
  const { plan, db, admin } = await threadScenario("pending_review", "hashB");
  t("reimport_endret_kilde_mot_ubesluttet_sak_erstatter", plan.action === "supersede" && !plan.decided);
  await supersedePendingProposal(admin, { userId: USER, proposalId: "p1" });
  t(
    "ventende_forslag_settes_til_superseded",
    db["linkedin_reconciliation_proposals"]![0]!.status === "superseded",
  );
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
